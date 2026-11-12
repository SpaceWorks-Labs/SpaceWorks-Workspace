import "server-only";
import type { Project } from "@prisma/client";
import { prisma } from "@/lib/db";
import { actionError, NOT_ALLOWED, validationError, type ActionResult } from "@/lib/actionResult";
import { canPerformTaskAction } from "@/lib/tasks/capabilities";
import { canEditTasks, type TaskActor } from "@/lib/tasks/access";
import { taskReference } from "@/lib/tasks/links";
import { publishTaskChange } from "@/lib/tasks/realtime";
import { assignTaskSchema, setAssigneesSchema, taskIdSchema } from "@/lib/tasks/schemas";
import {
  type After,
  ARCHIVED_PROJECT,
  ARCHIVED_TASK,
  CHANGED_MESSAGE,
  NOT_FOUND,
  actorName,
  addHistory,
  capabilityInput,
  deniedMessage,
  eventBase,
  loadVisibleTask,
  lockTask,
  notify,
  runAfter,
  validateAssignees,
  viaOf,
  visibleRecipients,
} from "./helpers";

/**
 * Assignment changes. Every path locks the task row first, reads the current
 * assignees inside the transaction, decides permission from that fresh set,
 * then applies only the real difference, so concurrent claims and edits
 * neither lose updates nor double-notify.
 */

type Plan =
  | { kind: "set"; userIds: string[] }
  | { kind: "add"; userId: string }
  | { kind: "remove"; userId: string };

type Outcome = { error: string } | { added: string[]; removed: string[]; assigneeIds: string[]; project: Project | null };

async function applyPlan(actor: TaskActor, taskId: string, plan: Plan): Promise<ActionResult<{ assigneeIds: string[] }>> {
  if (!canEditTasks(actor)) return actionError(NOT_ALLOWED);
  const task = await loadVisibleTask(actor, taskId);
  if (!task) return actionError(NOT_FOUND);
  if (task.project?.status === "ARCHIVED") return actionError(ARCHIVED_PROJECT);
  if (task.archivedAt) return actionError(ARCHIVED_TASK);
  const me = actor.user.id;
  const after: After = [];

  const outcome: Outcome = await prisma.$transaction(async (tx) => {
    await lockTask(tx, task.id);
    const fresh = await tx.task.findUnique({ where: { id: task.id }, select: { archivedAt: true, projectId: true, parentId: true } });
    if (!fresh || fresh.archivedAt) return { error: ARCHIVED_TASK };
    // A concurrent transfer may have moved the task since the pre-transaction load: never act on stale project rules.
    if (fresh.projectId !== task.projectId || fresh.parentId !== task.parentId) return { error: CHANGED_MESSAGE };
    const project = fresh.projectId ? await tx.project.findUnique({ where: { id: fresh.projectId } }) : null;
    if (project?.status === "ARCHIVED") return { error: ARCHIVED_PROJECT };
    const live = { ...task, project };
    const current = (await tx.taskAssignee.findMany({ where: { taskId: task.id }, select: { userId: true } })).map((row) => row.userId);
    const input = capabilityInput(actor, live, current);

    let added: string[] = [];
    let removed: string[] = [];
    if (plan.kind === "set") {
      added = plan.userIds.filter((id, index, all) => !current.includes(id) && all.indexOf(id) === index);
      removed = current.filter((id) => !plan.userIds.includes(id));
      if (!canPerformTaskAction("edit", input)) return { error: deniedMessage("edit", input) };
    } else {
      const self = plan.userId === me;
      if (plan.kind === "add") added = current.includes(plan.userId) ? [] : [plan.userId];
      else removed = current.includes(plan.userId) ? [plan.userId] : [];
      if (added.length + removed.length === 0) return { added, removed, assigneeIds: current, project };
      const action = plan.kind === "add" ? "claim" : "unclaim";
      const allowed = canPerformTaskAction("edit", input) || (self && canPerformTaskAction(action, input));
      if (!allowed) return { error: deniedMessage(plan.kind === "add" && self ? "claim" : "edit", input) };
    }

    // Only newly added people must be assignable: keeping someone who has since been disabled or demoted is fine.
    if (added.length && !(await validateAssignees(actor, project, added, tx)).ok) return { error: "Assign only members who can see this project." };

    if (removed.length) {
      const result = await tx.taskAssignee.deleteMany({ where: { taskId: task.id, userId: { in: removed } } });
      if (result.count === 0) removed = [];
    }
    if (added.length) {
      const result = await tx.taskAssignee.createMany({ data: added.map((userId) => ({ taskId: task.id, userId, assignedById: me })), skipDuplicates: true });
      if (result.count === 0) added = [];
    }
    const assigneeIds = (await tx.taskAssignee.findMany({ where: { taskId: task.id }, orderBy: { assignedAt: "asc" }, select: { userId: true } })).map((row) => row.userId);
    if (added.length === 0 && removed.length === 0) return { added, removed, assigneeIds, project };

    await tx.task.update({ where: { id: task.id }, data: { updatedAt: new Date() } });
    const via = viaOf(actor);
    if (added.length) await addHistory(tx, task.id, me, "assigned", { userIds: added, by: me, ...(added.length === 1 && added[0] === me ? { claimed: true } : {}) }, via);
    if (removed.length) await addHistory(tx, task.id, me, "unassigned", { userIds: removed, by: me }, via);

    const ref = taskReference(project?.key, task.number);
    const toAdd = await visibleRecipients(tx, actor.workspace.id, project, added.filter((id) => id !== me));
    if (toAdd.length) {
      await notify(tx, after, actor.workspace.id, { ...eventBase(actor, task, project), type: "task.assigned", title: `${actorName(actor)} assigned you ${ref}: ${task.title}`, recipients: toAdd });
    }
    const toRemove = await visibleRecipients(tx, actor.workspace.id, project, removed.filter((id) => id !== me));
    if (toRemove.length) {
      await notify(tx, after, actor.workspace.id, { ...eventBase(actor, task, project), type: "task.unassigned", title: `${actorName(actor)} unassigned you from ${ref}: ${task.title}`, recipients: toRemove });
    }
    return { added, removed, assigneeIds, project };
  });

  if ("error" in outcome) return actionError(outcome.error);
  if (outcome.added.length || outcome.removed.length) {
    await runAfter(after);
    await publishTaskChange({ workspaceId: actor.workspace.id, project: outcome.project, taskIds: task.parentId ? [task.id, task.parentId] : [task.id], type: "task.changed", actorId: me });
  }
  return { ok: true, data: { assigneeIds: outcome.assigneeIds } };
}

/** Replace the whole assignee list (the task panel's multi-select). */
export async function setAssignees(actor: TaskActor, input: unknown): Promise<ActionResult<{ assigneeIds: string[] }>> {
  const parsed = setAssigneesSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  return applyPlan(actor, parsed.data.taskId, { kind: "set", userIds: parsed.data.userIds });
}

/** Add one person (taking the claim rules when it is the actor). Idempotent. */
export async function assignTask(actor: TaskActor, input: unknown): Promise<ActionResult<{ assigneeIds: string[] }>> {
  const parsed = assignTaskSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  return applyPlan(actor, parsed.data.taskId, { kind: "add", userId: parsed.data.userId });
}

/** Remove one person (taking the unclaim rules when it is the actor). Idempotent. */
export async function unassignTask(actor: TaskActor, input: unknown): Promise<ActionResult<{ assigneeIds: string[] }>> {
  const parsed = assignTaskSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  return applyPlan(actor, parsed.data.taskId, { kind: "remove", userId: parsed.data.userId });
}

export async function claimTask(actor: TaskActor, input: unknown): Promise<ActionResult<{ assigneeIds: string[] }>> {
  const parsed = taskIdSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  return applyPlan(actor, parsed.data.taskId, { kind: "add", userId: actor.user.id });
}

export async function unclaimTask(actor: TaskActor, input: unknown): Promise<ActionResult<{ assigneeIds: string[] }>> {
  const parsed = taskIdSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  return applyPlan(actor, parsed.data.taskId, { kind: "remove", userId: actor.user.id });
}
