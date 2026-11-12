import "server-only";

import { prisma } from "@/lib/db";
import { getInstanceSettings } from "@/lib/instanceSettings";
import { resolveLimits } from "@/lib/limits";
import { isModuleEnabled, TOGGLEABLE_MODULES } from "@/lib/modules";
import { nearLimitOrganisations, nearLimits, topOrganisations, type DashboardWindow } from "./compute";
import type { ModuleAdoption, OrgSort, OrgStatusKey, OrgUsageRow, OrgUsageView } from "./types";

/** The instance defaults `getEffectiveLimits` reads; resolved here in one query for every organisation. */
const DEFAULT_KEYS = [
  "limits.maxMembers", "limits.maxGuests", "limits.maxProjects", "limits.maxStorageBytes", "limits.maxFileBytes",
  "limits.maxApiTokens", "limits.maxWebhooks", "limits.assistantMonthlyTokens", "limits.monthlyEmailCap", "modules.disabledByDefault",
] as const;

type Sum = { workspaceId: string; total: bigint | number };

/** Same rule as `workspaceUsage` (lib/limits/usage.ts), grouped for every organisation at once. */
function storageByWorkspace() {
  return prisma.$queryRaw<Sum[]>`
    SELECT s."workspaceId", SUM(s.t)::bigint AS total FROM (
      SELECT f."workspaceId", SUM(f."size")::bigint AS t FROM "FileObject" f GROUP BY 1
      UNION ALL
      SELECT f."workspaceId", SUM(v."size")::bigint FROM "FileVersion" v JOIN "FileObject" f ON f."id" = v."fileId"
      WHERE v."storageKey" <> f."storageKey" GROUP BY 1
    ) s GROUP BY 1`;
}

function assistantByWorkspace(since: Date) {
  return prisma.$queryRaw<Sum[]>`
    SELECT c."workspaceId", COALESCE(SUM(COALESCE(m."tokensIn", 0) + COALESCE(m."tokensOut", 0)), 0)::bigint AS total
    FROM "AssistantMessage" m JOIN "AssistantConversation" c ON c."id" = m."conversationId"
    WHERE m."createdAt" >= ${since}::timestamp GROUP BY 1`;
}

const toMap = (rows: Array<{ workspaceId: string; n: number }>) => new Map(rows.map((row) => [row.workspaceId, row.n]));

/** Every non-archived organisation's usage and limits from a fixed number of grouped queries (no per-organisation reads). */
export async function loadOrgUsageRows(w: DashboardWindow): Promise<{ rows: OrgUsageRow[]; modules: Map<string, { disabledModules: string[]; enabledModules: string[] }> }> {
  const [workspaces, overrides, defaults, memberships, projects, tasks, emails, storage, assistant] = await Promise.all([
    prisma.workspace.findMany({ where: { archivedAt: null }, select: { id: true, name: true, slug: true, status: true } }),
    prisma.workspaceLimits.findMany(),
    getInstanceSettings(DEFAULT_KEYS),
    prisma.membership.groupBy({ by: ["workspaceId", "role"], where: { status: "ACTIVE" }, _count: { _all: true } }),
    prisma.project.groupBy({ by: ["workspaceId"], where: { status: { not: "ARCHIVED" } }, _count: { _all: true } }),
    prisma.task.groupBy({ by: ["workspaceId"], where: { createdAt: { gte: w.since } }, _count: { _all: true } }),
    prisma.campaignMessage.groupBy({ by: ["workspaceId"], where: { status: "SENT", sentAt: { gte: w.monthStart } }, _count: { _all: true } }),
    storageByWorkspace(),
    assistantByWorkspace(w.monthStart),
  ]);
  const members = new Map<string, { members: number; guests: number }>();
  for (const row of memberships) {
    const entry = members.get(row.workspaceId) ?? { members: 0, guests: 0 };
    if (row.role === "GUEST") entry.guests += row._count._all;
    else entry.members += row._count._all;
    members.set(row.workspaceId, entry);
  }
  const projectCount = toMap(projects.map((row) => ({ workspaceId: row.workspaceId, n: row._count._all })));
  const taskCount = toMap(tasks.map((row) => ({ workspaceId: row.workspaceId, n: row._count._all })));
  const emailCount = toMap(emails.map((row) => ({ workspaceId: row.workspaceId, n: row._count._all })));
  const storageBytes = toMap(storage.map((row) => ({ workspaceId: row.workspaceId, n: Number(row.total) })));
  const assistantUsed = toMap(assistant.map((row) => ({ workspaceId: row.workspaceId, n: Number(row.total) })));
  const overrideById = new Map(overrides.map((row) => [row.workspaceId, row]));
  const modules = new Map<string, { disabledModules: string[]; enabledModules: string[] }>();
  const rows = workspaces.map((workspace): OrgUsageRow => {
    const limits = resolveLimits(overrideById.get(workspace.id) ?? null, defaults);
    if (workspace.status === "ACTIVE") modules.set(workspace.id, { disabledModules: limits.disabledModules, enabledModules: limits.enabledModules });
    const usage = {
      members: members.get(workspace.id)?.members ?? 0,
      guests: members.get(workspace.id)?.guests ?? 0,
      projects: projectCount.get(workspace.id) ?? 0,
      storageBytes: storageBytes.get(workspace.id) ?? 0,
      tasks: taskCount.get(workspace.id) ?? 0,
      emailsMonth: emailCount.get(workspace.id) ?? 0,
      assistantMonth: assistantUsed.get(workspace.id) ?? 0,
    };
    return { id: workspace.id, name: workspace.name, slug: workspace.slug, status: workspace.status as OrgStatusKey, plan: limits.plan, ...usage, near: nearLimits(usage, limits) };
  });
  return { rows, modules };
}

/** How many live organisations have each switchable module on. */
export function moduleAdoption(settings: Iterable<{ disabledModules: string[]; enabledModules: string[] }>): ModuleAdoption[] {
  const list = [...settings];
  return TOGGLEABLE_MODULES.map((module) => {
    const on = list.filter((entry) => isModuleEnabled(entry, module.key)).length;
    return { key: module.key, label: module.label, on, off: list.length - on, optIn: Boolean(module.optIn) };
  });
}

export type OrgUsageData = Awaited<ReturnType<typeof loadOrgUsageRows>>;

/** The ranked and flagged slices the page shows; cheap, so it runs per request on cached rows. */
export function summariseOrgUsage({ rows, modules }: OrgUsageData, sort: OrgSort): OrgUsageView {
  const flagged = rows.filter((row) => row.near.length > 0 && row.status === "ACTIVE");
  return {
    sort,
    top: topOrganisations(rows, sort),
    nearLimit: nearLimitOrganisations(flagged),
    nearLimitTotal: flagged.length,
    activeOrgs: modules.size,
    adoption: moduleAdoption(modules.values()),
  };
}
