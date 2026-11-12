import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hasRoleAtLeast } from "@/lib/roles";
import { hiddenTeamIds, teamScopeFilter } from "@/lib/teamAccess";
import { canUsePrivateChannels, type Principal } from "@/lib/assistant/principal";
import { actorFromPrincipal } from "@/lib/assistant/tools/tasks/actor";
import { visibleTaskWhere } from "@/lib/tasks/access";

/**
 * Record-level visibility for assistant tools. Mirrors the product rules:
 * private teams hide their projects and channels, guests only chat in
 * channels they were added to, direct messages are never readable through the
 * assistant, admin-only docs need ADMIN.
 */

export async function hiddenTeamsFor(principal: Principal): Promise<string[]> {
  if (principal.kind === "job") {
    const rows = await prisma.team.findMany({ where: { workspaceId: principal.workspace.id, visibility: "PRIVATE" }, select: { id: true } });
    return rows.map((row) => row.id);
  }
  return hiddenTeamIds(principal.workspace.id, { userId: principal.userId, role: principal.role });
}

/** Prisma filter for projects this principal can see. */
export async function projectWhere(principal: Principal): Promise<Prisma.ProjectWhereInput> {
  const hidden = await hiddenTeamsFor(principal);
  return { workspaceId: principal.workspace.id, ...teamScopeFilter(hidden) };
}

/**
 * Prisma filter for tasks the principal can read: the product's own
 * `visibleTaskWhere` (lib/tasks/access: tasks of visible projects, loose tasks
 * for members, guests only their own), minus archived tasks. Jobs also lose
 * every private team's tasks because their answer is posted where others read.
 */
export async function taskWhere(principal: Principal): Promise<Prisma.TaskWhereInput> {
  const visible = await visibleTaskWhere(actorFromPrincipal(principal));
  const and: Prisma.TaskWhereInput[] = [visible, { archivedAt: null }];
  if (principal.kind === "job") and.push({ OR: [{ projectId: null }, { project: { ...teamScopeFilter(await hiddenTeamsFor(principal)) } }] });
  return { AND: and };
}

/** Channels (never DMs) the principal may read. */
export async function channelWhere(principal: Principal): Promise<Prisma.ChannelWhereInput> {
  const hidden = await hiddenTeamsFor(principal);
  const base: Prisma.ChannelWhereInput = { workspaceId: principal.workspace.id, archivedAt: null, ...teamScopeFilter(hidden) };
  const member: Prisma.ChannelWhereInput = { members: { some: { userId: principal.userId } } };
  if (!canUsePrivateChannels(principal)) return { ...base, kind: "PUBLIC" };
  if (!hasRoleAtLeast(principal.role, "MEMBER")) return { ...base, kind: { in: ["PUBLIC", "PRIVATE"] }, ...member };
  return { ...base, AND: [{ OR: [{ kind: "PUBLIC" }, { kind: "PRIVATE", ...member }] }] };
}

/** Docs the principal may read (admin-only docs: signed-in admins only, never tokens or jobs). */
export function docWhere(principal: Principal): Prisma.DocWhereInput {
  return {
    workspaceId: principal.workspace.id,
    archivedAt: null,
    ...(hasRoleAtLeast(principal.role, "ADMIN") && principal.kind === "user" ? {} : { visibility: "WORKSPACE" }),
  };
}

/** Find a channel by id or slug (with or without "#") inside the principal's reach. */
export async function findChannel(principal: Principal, ref: string) {
  const slug = ref.replace(/^#/, "").trim().toLowerCase();
  return prisma.channel.findFirst({
    where: { AND: [await channelWhere(principal), { OR: [{ id: ref.trim() }, { slug }] }] },
    select: { id: true, name: true, slug: true, kind: true, topic: true },
  });
}

/** Plain text from sanitised HTML (task descriptions, doc renders). */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<(br|\/p|\/li|\/h[1-6]|\/div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Plain text → sanitised HTML paragraphs (what task descriptions and docs store). */
export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** Display names for a set of user ids ("Former member" when gone). */
export async function userNames(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const rows = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, email: true } });
  return new Map(rows.map((row) => [row.id, row.name ?? row.email.split("@")[0]!]));
}
