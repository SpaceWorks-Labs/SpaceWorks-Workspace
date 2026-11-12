import "server-only";
import { prisma } from "@/lib/db";
import { actionError, validationError, type ActionResult } from "@/lib/actionResult";
import { uploadWorkspaceFile, fileUrl } from "@/lib/storage";
import type { TaskActor } from "@/lib/tasks/access";
import { INLINE_FOLDER, INLINE_IMAGE_TYPES } from "@/lib/tasks/inlineImages";
import { taskIdSchema } from "@/lib/tasks/schemas";
import { loadEditableTask } from "./helpers";

/**
 * Store an image pasted or dropped into a task description. It is a private
 * task file (folder `/tasks/inline`, so it is not listed as an attachment) that
 * `/api/files/[id]` serves with the usual membership and private-team checks.
 * Same gate as editing the description; the stored description may then
 * reference it as `<img src="/api/files/<id>">`.
 */
export async function uploadDescriptionImage(actor: TaskActor, taskId: string, file: File): Promise<ActionResult<{ id: string; url: string; alt: string }>> {
  const parsed = taskIdSchema.safeParse({ taskId });
  if (!parsed.success) return validationError(parsed.error);
  const found = await loadEditableTask(actor, parsed.data.taskId, { action: "edit" });
  if ("error" in found) return actionError(found.error);
  if (!INLINE_IMAGE_TYPES.has(file.type)) return actionError("Use a PNG, JPEG, WebP or GIF image.");
  const count = await prisma.fileObject.count({ where: { taskId: found.task.id, folder: INLINE_FOLDER, deletedAt: null } });
  if (count >= 30) return actionError("A description can hold up to 30 images.");
  const uploaded = await uploadWorkspaceFile({ workspaceId: actor.workspace.id, uploadedById: actor.user.id, file, folder: INLINE_FOLDER, taskId: found.task.id, allowedTypes: INLINE_IMAGE_TYPES });
  if (!uploaded.ok) return actionError(uploaded.error);
  return { ok: true, data: { id: uploaded.file.id, url: fileUrl(uploaded.file.id), alt: uploaded.file.filename.replace(/\.[^.]+$/, "").slice(0, 100) } };
}
