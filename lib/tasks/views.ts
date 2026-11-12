import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { actionError, NOT_ALLOWED, validationError, type ActionResult } from "@/lib/actionResult";
import { hasRoleAtLeast } from "@/lib/roles";
import { canEditTasks, visibleProjectWhere, type TaskActor } from "@/lib/tasks/access";
import { deserializeQuery, serializeQuery } from "@/lib/tasks/rememberedQuery";
import { projectKeySchema } from "@/lib/tasks/schemas";

/**
 * Saved task views: the board's view, filters, sort and grouping under a
 * name, per project, on the shared `SavedView` model (`entityType: "task"`).
 * Private to their owner, or shared with the whole workspace (members and up
 * share). Everyone who can see the project sees its shared views.
 */

export const MAX_TASK_VIEWS = 30;
const ENTITY = "task";

export type TaskViewDTO = { id: string; name: string; /** Owned by the viewer. */ mine: boolean; shared: boolean; /** `serializeQuery` JSON of the view. */ state: string };

const saveSchema = z.object({
  projectKey: projectKeySchema,
  name: z.string().trim().min(1, "Name the view.").max(60, "Keep the name under 60 characters."),
  state: z.string().max(4000),
  shared: z.boolean().default(false),
});

type Stored = { projectKey: string; view: string; filters: unknown; sort: string; dir: string; groupBy: string };

const toState = (query: unknown): string | null => {
  if (!query || typeof query !== "object") return null;
  const stored = query as Partial<Stored>;
  const parsed = deserializeQuery(JSON.stringify({ view: stored.view, filters: stored.filters, sort: stored.sort, dir: stored.dir, group: stored.groupBy }));
  return parsed ? serializeQuery(parsed) : null;
};

async function visibleProject(actor: TaskActor, key: string) {
  return prisma.project.findFirst({ where: { AND: [await visibleProjectWhere(actor), { key }] }, select: { id: true, key: true } });
}

export async function listTaskViews(actor: TaskActor, projectKey: string): Promise<TaskViewDTO[]> {
  const key = projectKeySchema.safeParse(projectKey);
  if (!key.success || !(await visibleProject(actor, key.data))) return [];
  const rows = await prisma.savedView.findMany({
    where: { workspaceId: actor.workspace.id, entityType: ENTITY, query: { path: ["projectKey"], equals: key.data }, OR: [{ ownerId: actor.user.id }, { shared: "WORKSPACE" }] },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 100,
  });
  return rows.flatMap((row) => {
    const state = toState(row.query);
    return state ? [{ id: row.id, name: row.name, mine: row.ownerId === actor.user.id, shared: row.shared === "WORKSPACE", state }] : [];
  });
}

export async function saveTaskView(actor: TaskActor, input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { projectKey, name, shared } = parsed.data;
  if (shared && !canEditTasks(actor)) return actionError("Guests can save personal views.");
  const project = await visibleProject(actor, projectKey);
  if (!project) return actionError(NOT_ALLOWED);
  let state: ReturnType<typeof deserializeQuery> = null;
  try {
    state = deserializeQuery(parsed.data.state);
  } catch {
    state = null;
  }
  if (!state) return actionError("Couldn't read that view. Reload and try again.");
  const query = { projectKey, view: state.view, filters: state.filters, sort: state.sort, dir: state.dir, groupBy: state.group };
  const where = { workspaceId: actor.workspace.id, entityType: ENTITY, ownerId: actor.user.id, query: { path: ["projectKey"], equals: projectKey } };
  const existing = await prisma.savedView.findFirst({ where: { ...where, name: { equals: name, mode: "insensitive" } }, select: { id: true } });
  if (!existing && (await prisma.savedView.count({ where })) >= MAX_TASK_VIEWS) return actionError(`You can keep up to ${MAX_TASK_VIEWS} views on a project. Remove one first.`);
  const data = { name, query, layout: state.view === "list" ? "LIST" : "BOARD", shared: shared ? ("WORKSPACE" as const) : ("PRIVATE" as const) };
  const view = await prisma.$transaction(async (tx) => {
    const saved = existing
      ? await tx.savedView.update({ where: { id: existing.id }, data })
      : await tx.savedView.create({ data: { ...data, workspaceId: actor.workspace.id, entityType: ENTITY, ownerId: actor.user.id } });
    await recordAuditEvent({ action: "task.view_saved", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "SavedView", targetId: saved.id, metadata: { projectKey, shared }, client: tx });
    return saved;
  });
  return { ok: true, data: { id: view.id } };
}

/** The owner removes a view; an admin can remove a shared one. */
export async function deleteTaskView(actor: TaskActor, id: unknown): Promise<ActionResult> {
  const parsed = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/).safeParse(id);
  if (!parsed.success) return actionError("Couldn't remove this view. Try again.");
  const view = await prisma.savedView.findFirst({ where: { id: parsed.data, workspaceId: actor.workspace.id, entityType: ENTITY } });
  const mayRemove = view && (view.ownerId === actor.user.id || (view.shared === "WORKSPACE" && hasRoleAtLeast(actor.membership.role, "ADMIN")));
  if (!view || !mayRemove) return actionError(NOT_ALLOWED);
  await prisma.$transaction(async (tx) => {
    await tx.savedView.delete({ where: { id: view.id } });
    await recordAuditEvent({ action: "task.view_deleted", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "SavedView", targetId: view.id, client: tx });
  });
  return { ok: true };
}
