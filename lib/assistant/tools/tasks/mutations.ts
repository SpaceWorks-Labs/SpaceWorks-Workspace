import "server-only";

import type { ColumnCategory } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { projectWhere, textToHtml } from "@/lib/assistant/tools/access";
import { auditToolWrite } from "@/lib/assistant/tools/audit";
import { defineTool, ToolError } from "@/lib/assistant/tools/types";
import { createTask as createTaskService, moveTask, setAssignees, setTaskCompleted, updateTask as updateTaskService } from "@/lib/tasks/service";
import type { TaskActor } from "@/lib/tasks/access";
import { assertAssignable, principalToActor, resolveUserIds, toDueDate, unwrap } from "./actor";
import { resolveTypeId } from "./typeResolve";
import { findTaskForWrite, readTaskDto, taskDto, taskRef } from "./records";

export const PRIORITIES = ["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export const STATUS_TO_CATEGORY: Record<"todo" | "in_progress" | "done", ColumnCategory> = { todo: "TODO", in_progress: "IN_PROGRESS", done: "DONE" };

const dateInput = z
  .string()
  .trim()
  .max(40)
  .refine((value) => !Number.isNaN(Date.parse(value)), "Use an ISO date such as 2026-11-02 or 2026-11-02T18:00:00+05:30.")
  .describe("ISO 8601 date or date-time. A date-only value is a day in the workspace time zone.");

export const createTask = defineTool({
  name: "sw_create_task",
  title: "New task",
  description:
    "Create a task. The person confirms before it runs. Optional project key, plain-text description, assignees (\"me\" or member ids from sw_list_members), priority and due date. The task goes to the bottom of the project's first column.",
  input: z.object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(5000).optional().describe("Plain text."),
    project: z.string().trim().max(10).optional().describe("Project key, e.g. BOT. Leave out for a personal task."),
    assignees: z.array(z.string().trim().min(1).max(64)).max(10).optional(),
    priority: z.enum(PRIORITIES).optional(),
    dueAt: dateInput.optional(),
    type: z.string().trim().min(1).max(30).optional().describe("Task type name on the project (e.g. Bug); default type when left out. Needs a project."),
  }),
  write: true,
  scope: "write:tasks",
  minRole: "MEMBER",
  async run(ctx, input) {
    const { principal } = ctx;
    const actor = await principalToActor(ctx);
    const project = input.project
      ? await prisma.project.findFirst({ where: { AND: [await projectWhere(principal), { key: input.project.toUpperCase(), status: { not: "ARCHIVED" } }] }, select: { id: true } })
      : null;
    if (input.project && !project) throw new ToolError(`No open project ${input.project.toUpperCase()} that you can see.`, "not_found");
    if (input.type && !project) throw new ToolError("Task types belong to a project. Give a project key too.");
    const typeId = input.type && project ? await resolveTypeId(principal.workspace.id, project.id, input.type) : undefined;
    const created = unwrap(
      await createTaskService(actor, {
        title: input.title,
        description: input.description ? textToHtml(input.description) : null,
        projectId: project?.id ?? null,
        typeId,
        priority: input.priority ?? "NONE",
        dueDate: toDueDate(input.dueAt, actor.workspace.timezone) ?? null,
        assigneeIds: resolveUserIds(input.assignees ?? [], principal.userId),
      }),
    )!;
    await auditToolWrite(ctx, { action: "assistant.task_created", targetType: "Task", targetId: created.id, metadata: { number: created.number } });
    const dto = await readTaskDto(principal.workspace.slug, created.id);
    return { summary: `Created ${dto.ref}`, data: dto };
  },
});

/** Move a task to the first column of `category` (or reopen/complete a task without a board column). */
async function applyStatus(actor: TaskActor, task: Awaited<ReturnType<typeof findTaskForWrite>>, status: "todo" | "in_progress" | "done") {
  const category = STATUS_TO_CATEGORY[status];
  const current = await prisma.task.findUniqueOrThrow({ where: { id: task.id }, select: { columnId: true, parentId: true, completedAt: true } });
  if (current.columnId && !current.parentId && task.projectId) {
    if (task.column?.category === category && Boolean(current.completedAt) === (category === "DONE")) return;
    const column = await prisma.boardColumn.findFirst({ where: { projectId: task.projectId, category }, orderBy: { position: "asc" }, select: { id: true } });
    if (column) {
      // Done cards go to the top of Done (like the checkbox); others to the bottom.
      const last = category === "DONE" ? null : await prisma.task.findFirst({ where: { columnId: column.id, parentId: null, archivedAt: null, id: { not: task.id } }, orderBy: [{ position: "desc" }, { number: "desc" }], select: { id: true } });
      unwrap(await moveTask(actor, { taskId: task.id, columnId: column.id, afterTaskId: last?.id ?? null }));
      return;
    }
  }
  unwrap(await setTaskCompleted(actor, { taskId: task.id, completed: category === "DONE" }));
}

export const updateTask = defineTool({
  name: "sw_update_task",
  title: "Task update",
  description:
    "Update a task's title, status (todo, in_progress, done), priority, due date (null clears it), type (name) or assignees (the full set; \"me\" allowed). The person confirms before it runs.",
  input: z.object({
    ref: taskRef,
    title: z.string().trim().min(1).max(200).optional(),
    status: z.enum(["todo", "in_progress", "done"]).optional(),
    priority: z.enum(PRIORITIES).optional(),
    dueAt: dateInput.nullable().optional(),
    type: z.string().trim().min(1).max(30).optional().describe("Task type name on the task's project (e.g. Bug)."),
    assignees: z.array(z.string().trim().min(1).max(64)).max(20).optional().describe('Replaces the assignees. "me" or member ids.'),
  }),
  write: true,
  scope: "write:tasks",
  minRole: "MEMBER",
  async run(ctx, input) {
    const { principal } = ctx;
    const actor = await principalToActor(ctx);
    const task = await findTaskForWrite(actor, input.ref);
    const before = taskDto(principal.workspace.slug, task);
    const dueDate = toDueDate(input.dueAt, actor.workspace.timezone);
    if (input.type && !task.projectId) throw new ToolError("Task types belong to a project. This task has none.");
    const typeId = input.type && task.projectId ? await resolveTypeId(principal.workspace.id, task.projectId, input.type) : undefined;
    // Validate the parts that can be checked up front. Fields, status and assignees are still separate service
    // calls (different locks and history rows), so a late failure (e.g. a permission change mid-call) can leave earlier parts applied.
    const assigneeIds = input.assignees ? resolveUserIds(input.assignees, principal.userId) : null;
    if (assigneeIds) await assertAssignable(actor, task.project, assigneeIds, task.assignees.map((a) => a.user.id));
    const fields = { title: input.title, priority: input.priority, dueDate, typeId };
    if (Object.values(fields).some((value) => value !== undefined)) {
      unwrap(await updateTaskService(actor, { taskId: task.id, ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) }));
    }
    if (input.status) await applyStatus(actor, task, input.status);
    if (assigneeIds) unwrap(await setAssignees(actor, { taskId: task.id, userIds: assigneeIds }));

    const after = await readTaskDto(principal.workspace.slug, task.id);
    const changed = [
      after.title !== before.title && "title",
      after.priority !== before.priority && "priority",
      after.dueAt !== before.dueAt && "due date",
      after.status !== before.status && "status",
      after.type !== before.type && "type",
      after.assignees.map((a) => a.id).sort().join() !== before.assignees.map((a) => a.id).sort().join() && "assignees",
    ].filter((name): name is string => Boolean(name));
    if (changed.length === 0) return { summary: `Nothing to change on ${before.ref}`, data: after };
    await auditToolWrite(ctx, { action: "assistant.task_updated", targetType: "Task", targetId: task.id, metadata: { number: task.number, fields: changed.join(",") } });
    return { summary: `Updated ${after.ref} (${changed.join(", ")})`, data: after };
  },
});
