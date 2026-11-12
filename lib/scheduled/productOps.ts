import "server-only";
import { workspacesWithoutModule } from "@/lib/modules-server";
import { prisma } from "@/lib/db";
import { dispatch } from "@/lib/notify";
import { hiddenTeamIds } from "@/lib/teamAccess";
import { sectionFor } from "@/lib/productOps/schema";
export async function run(now = new Date()) {
  const off = await workspacesWithoutModule("projects");
 let cursor: string | undefined;
 for (;;) {
  const workspaces = await prisma.workspace.findMany({ where: { status: "ACTIVE", archivedAt: null, id: { notIn: off } }, select: { id: true, slug: true, timezone: true }, orderBy: { id: "asc" }, take: 50, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
  if (!workspaces.length) break;
  for (const workspace of workspaces) {
   const results = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${workspace.id} FOR NO KEY UPDATE`;
    if (!await tx.workspace.findFirst({ where: { id: workspace.id, status: "ACTIVE", archivedAt: null } })) return [];
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: workspace.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    const records = await tx.productRecord.findMany({ where: { workspaceId: workspace.id, archivedAt: null, dueOn: { not: null }, status: { notIn: ["DONE", "SHIPPED", "CLOSED", "RESOLVED", "PASSED", "PASS", "FAIL", "COMPLETE", "APPLIED", "ROLLED_BACK", "READY"] } }, orderBy: { id: "asc" } });
    const members = await tx.membership.findMany({ where: { workspaceId: workspace.id, status: "ACTIVE", role: { not: "GUEST" }, user: { disabledAt: null } }, select: { userId: true, role: true } });
    const events: Awaited<ReturnType<typeof dispatch>>[] = [];
    for (const row of records) {
     const date = row.dueOn!.toISOString().slice(0, 10), days = Math.round((new Date(date).getTime() - new Date(today).getTime()) / 86400000);
     if (days > row.reminderDays) continue;
     let candidates = row.ownerId ? members.filter(m => m.userId === row.ownerId) : members.filter(m => ["ADMIN", "OWNER"].includes(m.role));
     if (row.kind === "ESTIMATE") candidates = candidates.filter(m => ["ADMIN", "OWNER"].includes(m.role));
     const recipients: string[] = [];
     for (const m of candidates) {
      const project = row.projectId ? await tx.project.findFirst({ where: { workspaceId: workspace.id, id: row.projectId, status: { not: "ARCHIVED" } }, select: { teamId: true } }) : null;
      if (row.projectId && !project) continue;
      if (project?.teamId && (await hiddenTeamIds(workspace.id, { userId: m.userId, role: m.role })).includes(project.teamId)) continue;
      recipients.push(m.userId);
     }
     if (!recipients.length) continue;
     const key = `product-ops:${row.id}:${date}:${days < 0 ? "overdue" : "due"}`;
     if (await tx.notificationEventRecord.findFirst({ where: { workspaceId: workspace.id, dedupeKey: key } })) continue;
     events.push(await dispatch(workspace.id, { type: row.kind === "ESTIMATE" ? "product_ops.estimate_due" : "product_ops.reminder", title: `Product item ${days < 0 ? "overdue" : "due soon"}`, body: "Review the saved record and update its next step.", url: `/w/${workspace.slug}/product-ops/${sectionFor(row.kind)}?edit=${row.id}`, recipients, resource: { type: "product_ops", id: row.id }, useWorkspaceRules: false, dedupeKey: key, data: { recordId: row.id, dueOn: date } }, { tx, now }));
    }
    return events;
   }, { timeout: 30000 });
   for (const event of results) await event.afterCommit();
  }
  cursor = workspaces.at(-1)!.id;
 }
}
