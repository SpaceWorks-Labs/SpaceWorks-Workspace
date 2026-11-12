import "server-only";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { auditToolWrite } from "@/lib/assistant/tools/audit";
import { defineTool, ToolError } from "@/lib/assistant/tools/types";
import { addComment, moveTask, setTaskArchived, transferTask } from "@/lib/tasks/service";
import { principalToActor, unwrap } from "./actor";
import { findTaskForWrite, readTaskDto, taskRef } from "./records";
import { STATUS_TO_CATEGORY } from "./mutations";

export const addTaskComment = defineTool({
  name: "sw_add_comment",
  title: "Task comment",
  description: "Add a comment to a task (plain text; <@memberId> mentions a member). The person confirms before it runs.",
  input: z.object({ ref: taskRef, body: z.string().trim().min(1).max(5000) }),
  write: true,
  scope: "write:tasks",
  minRole: "MEMBER",
  async run(ctx, input) {
    const actor = await principalToActor(ctx);
    const task = await findTaskForWrite(actor, input.ref);
    const created = unwrap(await addComment(actor, { taskId: task.id, body: input.body }))!;
    await auditToolWrite(ctx, { action: "assistant.task_commented", targetType: "Task", targetId: task.id, metadata: { number: task.number } });
    const dto = await readTaskDto(ctx.principal.workspace.slug, task.id);
    return { summary: `Commented on ${dto.ref}`, data: { commentId: created.id, task: dto } };
  },
});

export const archiveTask = defineTool({
  name: "sw_archive_task",
  title: "Archive task",
  description: "Archive a task, or restore an archived one with archived: false. The person confirms before it runs.",
  input: z.object({ ref: taskRef, archived: z.boolean().default(true) }),
  write: true,
  scope: "write:tasks",
  minRole: "MEMBER",
  async run(ctx, input) {
    const actor = await principalToActor(ctx);
    const task = await findTaskForWrite(actor, input.ref);
    unwrap(await setTaskArchived(actor, { taskId: task.id, archived: input.archived }));
    await auditToolWrite(ctx, { action: "assistant.task_archived", targetType: "Task", targetId: task.id, metadata: { number: task.number, archived: input.archived } });
    const dto = await readTaskDto(ctx.principal.workspace.slug, task.id);
    return { summary: `${input.archived ? "Archived" : "Restored"} ${dto.ref}`, data: { ...dto, archived: input.archived } };
  },
});

export const moveTaskTool = defineTool({
  name: "sw_move_task",
  title: "Move task",
  description:
    "Move a task on its project board to a column (by name) or to the first column of a status (todo, in_progress, done), at the top or bottom (default bottom). With project (a key) it first moves the task, with its subtasks, to that project: the column is matched by status, milestone links and the cycle are removed, and assignees who can't see the new project are dropped. The person confirms before it runs.",
  input: z.object({
    ref: taskRef,
    project: z.string().trim().min(2).max(10).optional().describe("Target project key, e.g. OPS. Moves the task to that project."),
    column: z.string().trim().min(1).max(40).optional().describe("Column name on the task's board."),
    status: z.enum(["todo", "in_progress", "done"]).optional(),
    position: z.enum(["top", "bottom"]).default("bottom"),
  }),
  write: true,
  scope: "write:tasks",
  minRole: "MEMBER",
  async run(ctx, input) {
    if (!input.column && !input.status && !input.project) throw new ToolError("Give a project, a column name or a status to move the task to.");
    const actor = await principalToActor(ctx);
    let task = await findTaskForWrite(actor, input.ref);
    if (input.project) {
      // Resolve the destination column against the TARGET project first, so an unresolvable one fails with no side effects.
      if (input.column || input.status) {
        const targetColumns = await prisma.boardColumn.findMany({ where: { project: { workspaceId: actor.workspace.id, key: input.project.toUpperCase() } }, orderBy: { position: "asc" }, select: { name: true, category: true } });
        const wanted = input.column
          ? targetColumns.find((c) => c.name.toLowerCase() === input.column!.toLowerCase())
          : targetColumns.find((c) => c.category === STATUS_TO_CATEGORY[input.status!]);
        if (!wanted) throw new ToolError(`No such column on ${input.project.toUpperCase()}. Columns: ${targetColumns.map((c) => c.name).join(", ")}.`, "not_found");
      }
      const moved = unwrap(await transferTask(actor, { taskId: task.id, targetProjectKey: input.project }))!;
      await auditToolWrite(ctx, { action: "assistant.task_transferred", targetType: "Task", targetId: task.id, metadata: { number: task.number, project: moved.key } });
      task = await findTaskForWrite(actor, input.ref);
      if (!input.column && !input.status) {
        const dto = await readTaskDto(ctx.principal.workspace.slug, task.id);
        return { summary: `Moved ${dto.ref} to ${moved.key}`, data: dto };
      }
    }
    if (!task.projectId) throw new ToolError("Only tasks on a project board can be moved.");
    const columns = await prisma.boardColumn.findMany({ where: { projectId: task.projectId }, orderBy: { position: "asc" }, select: { id: true, name: true, category: true } });
    const target = input.column
      ? columns.find((c) => c.name.toLowerCase() === input.column!.toLowerCase())
      : columns.find((c) => c.category === STATUS_TO_CATEGORY[input.status!]);
    if (!target) throw new ToolError(`No such column on this board. Columns: ${columns.map((c) => c.name).join(", ")}.`, "not_found");
    const last =
      input.position === "bottom"
        ? await prisma.task.findFirst({ where: { columnId: target.id, parentId: null, archivedAt: null, id: { not: task.id } }, orderBy: [{ position: "desc" }, { number: "desc" }], select: { id: true } })
        : null;
    const result = unwrap(await moveTask(actor, { taskId: task.id, columnId: target.id, afterTaskId: last?.id ?? null }));
    await auditToolWrite(ctx, { action: "assistant.task_moved", targetType: "Task", targetId: task.id, metadata: { number: task.number, column: target.name } });
    const dto = await readTaskDto(ctx.principal.workspace.slug, task.id);
    return { summary: `Moved ${dto.ref} to ${target.name}`, data: { ...dto, ...(result?.warning ? { warning: result.warning } : {}) } };
  },
});
