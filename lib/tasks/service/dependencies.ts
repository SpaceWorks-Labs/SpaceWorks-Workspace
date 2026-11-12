import "server-only";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { actionError, validationError, type ActionResult } from "@/lib/actionResult";
import { visibleTaskWhere, type TaskActor } from "@/lib/tasks/access";
import { wouldCreateCycle } from "@/lib/tasks/dependencies";
import { parseTaskReference, taskReference } from "@/lib/tasks/links";
import { publishTaskChange } from "@/lib/tasks/realtime";
import { addDependencySchema, removeDependencySchema } from "@/lib/tasks/schemas";
import { loadEditableTask, addHistory, viaOf } from "./helpers";

/* ---------- Dependencies ---------- */

export async function addDependency(actor: TaskActor, input: unknown): Promise<ActionResult> {
  const parsed = addDependencySchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const found = await loadEditableTask(actor, parsed.data.taskId, { action: "edit" });
  if ("error" in found) return actionError(found.error);
  const { task } = found;
  const reference = parseTaskReference(parsed.data.reference);
  if (!reference) return actionError("Enter a task reference like BOT-12.", { reference: ["Use a reference like BOT-12."] });
  const other = await prisma.task.findFirst({
    where: { AND: [await visibleTaskWhere(actor), { number: reference.number }] },
    include: { project: true },
  });
  if (!other || (reference.key && other.project?.key !== reference.key)) return actionError(`Couldn't find ${parsed.data.reference.toUpperCase()}. Check the reference.`, { reference: ["No task with that reference."] });
  if (other.id === task.id) return actionError("A task can't depend on itself.");
  // Linking changes the other task too: it needs the same edit gate (restrictTaskEdits, archived task or project).
  const otherFound = await loadEditableTask(actor, other.id, { action: "edit" });
  if ("error" in otherFound) return actionError(otherFound.error);
  const blockingTaskId = parsed.data.direction === "blockedBy" ? other.id : task.id;
  const blockedTaskId = parsed.data.direction === "blockedBy" ? task.id : other.id;

  const result = await prisma.$transaction(async (tx) => {
    // Serialise dependency writes per workspace so two opposite edges can't both pass the cycle check.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`task-deps:${actor.workspace.id}`}))`;
    const existing = await tx.taskDependency.findUnique({ where: { blockingTaskId_blockedTaskId: { blockingTaskId, blockedTaskId } } });
    if (existing) return "exists" as const;
    const edges = await tx.taskDependency.findMany({ where: { workspaceId: actor.workspace.id, type: "BLOCKS" }, select: { blockingTaskId: true, blockedTaskId: true } });
    if (wouldCreateCycle(edges, blockingTaskId, blockedTaskId)) return "cycle" as const;
    await tx.taskDependency.create({ data: { workspaceId: actor.workspace.id, blockingTaskId, blockedTaskId, type: "BLOCKS", createdById: actor.user.id } });
    const blockingRef = blockingTaskId === task.id ? taskReference(task.project?.key, task.number) : taskReference(other.project?.key, other.number);
    const blockedRef = blockedTaskId === task.id ? taskReference(task.project?.key, task.number) : taskReference(other.project?.key, other.number);
    await addHistory(tx, blockedTaskId, actor.user.id, "blocked_by_added", { ref: blockingRef }, viaOf(actor));
    await addHistory(tx, blockingTaskId, actor.user.id, "blocks_added", { ref: blockedRef }, viaOf(actor));
    await recordAuditEvent({ action: "task.dependency_added", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Task", targetId: blockedTaskId, metadata: { blockingTaskId }, client: tx });
    return "ok" as const;
  });
  if (result === "exists") return actionError("Those tasks are already linked.");
  if (result === "cycle") return actionError("That would make the tasks wait on each other in a circle: the other task already waits on this one.");
  await publishTaskChange({ workspaceId: actor.workspace.id, project: task.project, taskIds: [task.id, other.id], type: "task.changed", actorId: actor.user.id });
  if (other.projectId && other.projectId !== task.projectId) await publishTaskChange({ workspaceId: actor.workspace.id, project: other.project, taskIds: [], type: "task.changed", actorId: actor.user.id });
  return { ok: true };
}

export async function removeDependency(actor: TaskActor, input: unknown): Promise<ActionResult> {
  const parsed = removeDependencySchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const found = await loadEditableTask(actor, parsed.data.blockedTaskId, { action: "edit" });
  if ("error" in found) return actionError(found.error);
  const edge = await prisma.taskDependency.findFirst({ where: { workspaceId: actor.workspace.id, blockingTaskId: parsed.data.blockingTaskId, blockedTaskId: parsed.data.blockedTaskId } });
  if (!edge) return { ok: true };
  const blockingFound = await loadEditableTask(actor, edge.blockingTaskId, { action: "edit" });
  if ("error" in blockingFound) return actionError(blockingFound.error);
  const blocking = blockingFound.task;
  await prisma.$transaction(async (tx) => {
    await tx.taskDependency.delete({ where: { blockingTaskId_blockedTaskId: { blockingTaskId: edge.blockingTaskId, blockedTaskId: edge.blockedTaskId } } });
    await addHistory(tx, edge.blockedTaskId, actor.user.id, "blocked_by_removed", { ref: taskReference(blocking.project?.key, blocking.number) }, viaOf(actor));
    await recordAuditEvent({ action: "task.dependency_removed", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Task", targetId: edge.blockedTaskId, metadata: { blockingTaskId: edge.blockingTaskId }, client: tx });
  });
  await publishTaskChange({ workspaceId: actor.workspace.id, project: found.task.project, taskIds: [edge.blockedTaskId, edge.blockingTaskId], type: "task.changed", actorId: actor.user.id });
  return { ok: true };
}
