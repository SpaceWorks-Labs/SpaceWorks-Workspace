import "server-only";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { findDownloadableFile } from "@/lib/files";
import { canAccessResource } from "@/lib/search/query";
import { disabledEntityTypes } from "@/lib/search/entityModules";
import { getWorkspaceModules } from "@/lib/limits/modules";
import { canViewFinance, hasRoleAtLeast } from "@/lib/roles";
import { userTeamIds } from "@/lib/teamAccess";
import { hasScope, type ApiScope } from "@/lib/apiTokens/scopes";
import type { Principal } from "@/lib/assistant/principal";
import { channelWhere, clip, hiddenTeamsFor } from "@/lib/assistant/tools/access";
import { defineTool, plural } from "@/lib/assistant/tools/types";

/* ───────────── Global search (SearchDocument, filtered at query time) ───────────── */

const TOKEN_SCOPE_BY_TYPE: Record<string, ApiScope> = {
  task: "read:tasks",
  project: "read:tasks",
  doc: "read:docs",
  message: "read:chat",
  channel: "read:chat",
  member: "read:members",
  team: "read:members",
  event: "read:members",
  announcement: "read:members",
};
const GUEST_TYPES = new Set(["task", "project", "doc", "message", "channel", "announcement", "event", "meeting", "member", "team", "note"]);
const FINANCE_TYPES = new Set(["ledger", "ledger_entry", "invoice", "budget", "purchase_request", "reimbursement", "expense"]);
const NEVER_TYPES = (type: string) => type.startsWith("finance_pay") || type.startsWith("vault") || type === "emergency_contact";

export type SearchHit = {
  entityType: string;
  entityId: string;
  title: string;
  body: string;
  url: string;
  visibility: "PRIVATE" | "TEAM" | "WORKSPACE";
  teamId: string | null;
  channelId: string | null;
  ownerId: string | null;
};

/** Pure access filter for search hits (unit-tested). */
export function filterSearchHits(
  hits: SearchHit[],
  principal: Pick<Principal, "kind" | "userId" | "role" | "scopes" | "workspace">,
  access: { hiddenTeams: Set<string>; myTeams: Set<string>; readableChannels: Set<string>; adminOnlyDocs: Set<string> },
): SearchHit[] {
  const admin = hasRoleAtLeast(principal.role, "ADMIN") && principal.kind === "user";
  const finance = canViewFinance(principal, principal.workspace);
  return hits.filter((hit) => {
    if (NEVER_TYPES(hit.entityType)) return false;
    if (["funding", "governance"].includes(hit.entityType) && !admin) return false;
    if (hit.entityType === "product_ops" && principal.kind !== "user") return false;
    if (hit.entityType === "recurring_cost" && principal.kind !== "user") return false;
    if (hit.entityType === "money_control" && principal.kind !== "user") return false;
    if (hit.entityType === "calendar_entry" && (principal.kind !== "user" || (hit.visibility === "PRIVATE" && hit.ownerId !== principal.userId))) return false;
    if (hit.entityType === "note" && (principal.kind !== "user" || hit.ownerId !== principal.userId)) return false;
    if (principal.kind === "token") {
      const scope = TOKEN_SCOPE_BY_TYPE[hit.entityType];
      if (!scope || !hasScope(principal.scopes ?? [], scope)) return false;
    }
    if (principal.role === "GUEST" && !GUEST_TYPES.has(hit.entityType)) return false;
    if ((FINANCE_TYPES.has(hit.entityType) || hit.entityType.startsWith("finance_")) && !finance) return false;
    if (hit.teamId && access.hiddenTeams.has(hit.teamId)) return false;
    if (hit.channelId && !access.readableChannels.has(hit.channelId)) return false;
    if (hit.entityType === "doc" && !admin && access.adminOnlyDocs.has(hit.entityId)) return false;
    if (hit.visibility === "PRIVATE" && !admin && hit.ownerId !== principal.userId) return false;
    if (hit.visibility === "TEAM" && !admin && !(hit.teamId && access.myTeams.has(hit.teamId))) return false;
    return true;
  });
}

export const searchWorkspace = defineTool({
  name: "sw_search_workspace",
  title: "Search",
  description: "Full-text search across the workspace (tasks, docs, messages, meetings, contacts and more), limited to what the caller can see.",
  input: z.object({
    query: z.string().trim().min(1).max(200),
    types: z.array(z.string().trim().max(40)).max(10).optional().describe('Only these entity types, e.g. ["task","doc"].'),
    limit: z.number().int().min(1).max(30).default(10),
  }),
  write: false,
  // Tokens may search with any read scope; hits are limited to the entity types their scopes cover.
  scope: ["read:tasks", "read:docs", "read:chat", "read:members"],
  minRole: "GUEST",
  async run(ctx, input) {
    const { principal } = ctx;
    const like = `%${input.query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const raw = await prisma.$queryRaw<SearchHit[]>`
      SELECT "entityType", "entityId", "title", "body", "url", "visibility"::text AS "visibility", "teamId", "channelId", "ownerId"
      FROM "SearchDocument"
      WHERE "workspaceId" = ${principal.workspace.id}
        AND ("searchVector" @@ websearch_to_tsquery('simple', ${input.query}) OR "title" ILIKE ${like})
      ORDER BY ts_rank("searchVector", websearch_to_tsquery('simple', ${input.query})) DESC, "updatedAt" DESC
      LIMIT 200`;
    const off = new Set(disabledEntityTypes(await getWorkspaceModules(principal.workspace.id)));
    const typed = (input.types?.length ? raw.filter((hit) => input.types!.includes(hit.entityType)) : raw).filter((hit) => !off.has(hit.entityType));
    const docIds = typed.filter((h) => h.entityType === "doc").map((h) => h.entityId);
    const channelIds = [...new Set(typed.map((h) => h.channelId).filter((id): id is string => Boolean(id)))];
    const [hidden, mine, readable, adminDocs] = await Promise.all([
      hiddenTeamsFor(principal),
      principal.kind === "job" ? Promise.resolve([]) : userTeamIds(principal.workspace.id, principal.userId),
      channelIds.length
        ? prisma.channel.findMany({ where: { AND: [await channelWhere(principal), { id: { in: channelIds } }] }, select: { id: true } })
        : Promise.resolve([]),
      docIds.length ? prisma.doc.findMany({ where: { workspaceId: principal.workspace.id, id: { in: docIds }, OR: [{ visibility: "ADMINS" }, { archivedAt: { not: null } }] }, select: { id: true } }) : Promise.resolve([]),
    ]);
    const filtered = filterSearchHits(typed, principal, {
      hiddenTeams: new Set(hidden),
      myTeams: new Set(mine),
      readableChannels: new Set(readable.map((c) => c.id)),
      adminOnlyDocs: new Set(adminDocs.map((d) => d.id)),
    });
    // Index metadata can outlive a file's links or a note's source record.
    // Authorise the live source before returning any indexed title or body.
    const live = await Promise.all(filtered.map(async (hit) => {
      if (hit.entityType === "product_ops") return principal.kind === "user" && await canAccessResource({ workspaceId: principal.workspace.id, userId: principal.userId, role: principal.role }, "product_ops", hit.entityId);
      if (hit.entityType === "recurring_cost") return principal.kind === "user" && await canAccessResource({workspaceId:principal.workspace.id,userId:principal.userId,role:principal.role}, "recurring_cost",hit.entityId);
      if (hit.entityType === "money_control") return principal.kind === "user" && await canAccessResource({workspaceId:principal.workspace.id,userId:principal.userId,role:principal.role}, "money_control",hit.entityId);
      if (["funding", "governance"].includes(hit.entityType)) return principal.kind === "user" && await canAccessResource({ workspaceId: principal.workspace.id, userId: principal.userId, role: principal.role }, hit.entityType, hit.entityId);
      if (hit.entityType === "note") return Boolean(await prisma.personalNote.findFirst({ where: { id: hit.entityId, workspaceId: principal.workspace.id, userId: principal.userId, archivedAt: null }, select: { id: true } }));
      if (hit.entityType === "member") return Boolean(await prisma.memberProfile.findFirst({ where: { id: hit.entityId, workspaceId: principal.workspace.id, user: { disabledAt: null, memberships: { some: { workspaceId: principal.workspace.id, status: "ACTIVE" } } } }, select: { id: true } }));
      if (hit.entityType === "team") return Boolean(await prisma.team.findFirst({ where: { id: hit.entityId, workspaceId: principal.workspace.id, archivedAt: null, ...(principal.kind === "user" && hasRoleAtLeast(principal.role, "ADMIN") ? {} : { OR: [{ visibility: "PUBLIC" }, { members: { some: { userId: principal.userId } } }] }) }, select: { id: true } }));
      if (hit.entityType === "calendar_entry") {
        if (principal.kind !== "user") return false;
        const { entryWhere } = await import("@/lib/calendar/access");
        return Boolean(await prisma.calendarEntry.findFirst({ where: { AND: [await entryWhere({ user: { id: principal.userId, name: null }, workspace: principal.workspace, membership: { role: principal.role } }), { id: hit.entityId }] }, select: { id: true } }));
      }
      if (hit.entityType !== "file") return true;
      // Jobs post to shared destinations and must not recover private files
      // using their creator's broader download rights.
      if (principal.kind !== "user") return false;
      const file = await findDownloadableFile(hit.entityId, principal.userId);
      return file?.workspaceId === principal.workspace.id;
    }));
    const hits = filtered.filter((_, index) => live[index]).slice(0, input.limit);
    return {
      summary: `Found ${plural(hits.length, "result")} for “${clip(input.query, 40)}”`,
      data: { results: hits.map((h) => ({ type: h.entityType, id: h.entityId, title: h.title, snippet: clip(h.body, 300), url: h.url })) },
    };
  },
});
