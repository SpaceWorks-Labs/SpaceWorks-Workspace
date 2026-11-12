import "server-only";
import { workspacesWithoutModule } from "@/lib/modules-server";
import { prisma } from "@/lib/db";
import { dispatch } from "@/lib/notify";
import { projectViewerIds } from "@/lib/tasks/access";
import { nextUpdateDue } from "@/lib/projects/plusLogic";

/** One personal prompt per due update, claimed with the project row lock across worker replicas. */
export async function sendProjectUpdateReminders(now = new Date()): Promise<number> {
  const off = await workspacesWithoutModule("projects");
  let cursor: string | undefined;
  let sent = 0;
  for (;;) {
    const projects = await prisma.project.findMany({ where: { status: "ACTIVE", ownerId: { not: null }, workspace: { status: "ACTIVE", archivedAt: null }, workspaceId: { notIn: off } }, select: { id: true, workspaceId: true }, orderBy: { id: "asc" }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    if (!projects.length) break;
    for (const item of projects) {
      const result = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "Project" WHERE id=${item.id} AND "workspaceId"=${item.workspaceId} FOR UPDATE`;
        const project = await tx.project.findFirst({ where: { workspaceId: item.workspaceId, id: item.id, status: "ACTIVE", workspace: { status: "ACTIVE", archivedAt: null } }, include: { workspace: true, statusUpdates: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 } } });
        if (!project?.ownerId) return null;
        const due = nextUpdateDue(project.statusUpdates[0]?.createdAt ?? project.createdAt, project.workspace.timezone);
        if (due > now) return null;
        const member = await tx.membership.findFirst({ where: { workspaceId: item.workspaceId, userId: project.ownerId, status: "ACTIVE", role: { in: ["OWNER", "ADMIN", "MEMBER"] }, user: { disabledAt: null } } });
        if (!member || !(await projectViewerIds(item.workspaceId, project, tx)).has(member.userId)) return null;
        const dedupeKey = `project.update_due:${item.id}:${project.ownerId}:${due.toISOString()}`;
        if (await tx.notificationEventRecord.findFirst({ where: { workspaceId: item.workspaceId, dedupeKey } })) return null;
        return dispatch(item.workspaceId, { type: "project.update_due", title: `Weekly update due: ${project.name}`.slice(0, 150), body: "Share progress, blockers and next steps with your team.", url: `/w/${project.workspace.slug}/projects/${project.key}/updates`, recipients: [project.ownerId], resource: { type: "project", id: project.id }, scope: { projectId: project.id }, dedupeKey, data: { projectId: project.id, dueAt: due.toISOString() } }, { tx, now });
      });
      if (result) { await result.afterCommit(); sent++; }
    }
    cursor = projects.at(-1)!.id;
  }
  return sent;
}
export async function run(now: Date) { await sendProjectUpdateReminders(now); }
