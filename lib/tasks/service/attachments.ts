import "server-only";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { actionError, validationError, type ActionResult } from "@/lib/actionResult";
import { hasRoleAtLeast } from "@/lib/roles";
import { uploadWorkspaceFile } from "@/lib/storage";
import { canManageProject, type TaskActor } from "@/lib/tasks/access";
import { publishTaskChange } from "@/lib/tasks/realtime";
import { fileIdSchema, taskIdSchema } from "@/lib/tasks/schemas";
import { loadEditableTask, addHistory, viaOf } from "./helpers";

/* ---------- Attachments ---------- */

export async function addAttachment(actor: TaskActor, taskId: string, file: File): Promise<ActionResult<{ id: string }>> {
  const parsedId = taskIdSchema.safeParse({ taskId });
  if (!parsedId.success) return validationError(parsedId.error);
  const found = await loadEditableTask(actor, parsedId.data.taskId, { action: "contribute" });
  if ("error" in found) return actionError(found.error);
  const { task } = found;
  const count = await prisma.fileObject.count({ where: { taskId: task.id, deletedAt: null } });
  if (count >= 50) return actionError("A task can hold up to 50 attachments.");
  const uploaded = await uploadWorkspaceFile({ workspaceId: actor.workspace.id, uploadedById: actor.user.id, file, folder: "/tasks", taskId: task.id });
  if (!uploaded.ok) return actionError(uploaded.error);
  await prisma.$transaction(async (tx) => {
    await addHistory(tx, task.id, actor.user.id, "attachment_added", { filename: uploaded.file.filename.slice(0, 120) }, viaOf(actor));
    await tx.task.update({ where: { id: task.id }, data: { updatedAt: new Date() } });
  });
  await publishTaskChange({ workspaceId: actor.workspace.id, project: task.project, taskIds: [task.id], type: "task.changed", actorId: actor.user.id });
  return { ok: true, data: { id: uploaded.file.id } };
}

export async function removeAttachment(actor: TaskActor, input: unknown): Promise<ActionResult> {
  const parsed = fileIdSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const found = await loadEditableTask(actor, parsed.data.taskId, { action: "contribute" });
  if ("error" in found) return actionError(found.error);
  const { task } = found;
  const file = await prisma.fileObject.findFirst({ where: { id: parsed.data.fileId, taskId: task.id, workspaceId: actor.workspace.id, deletedAt: null } });
  if (!file) return { ok: true };
  const mayDelete = file.uploadedById === actor.user.id || (task.project ? canManageProject(actor, task.project) : hasRoleAtLeast(actor.membership.role, "ADMIN"));
  if (!mayDelete) return actionError("Only the person who added a file, or an admin, can remove it.");
  await prisma.$transaction(async (tx) => {
    await tx.fileObject.update({ where: { id: file.id }, data: { deletedAt: new Date() } });
    await addHistory(tx, task.id, actor.user.id, "attachment_removed", { filename: file.filename.slice(0, 120) }, viaOf(actor));
    await recordAuditEvent({ action: "task.attachment_removed", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Task", targetId: task.id, metadata: { fileId: file.id }, client: tx });
  });
  await publishTaskChange({ workspaceId: actor.workspace.id, project: task.project, taskIds: [task.id], type: "task.changed", actorId: actor.user.id });
  return { ok: true };
}
