import { z } from "zod";
import { PROJECT_KEY_PATTERN } from "@/lib/projects/keys";

/** Zod schemas for the projects and tasks actions (shared by actions, lib and tests). */

const id = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "Invalid id.");
const optionalId = id.nullable().optional();
const ids = (max: number) => z.array(id).max(max).transform((values) => [...new Set(values)]);
/** "YYYY-MM-DD" (local date in the workspace time zone), or empty/null to clear. */
const dateInput = z
  .string()
  .trim()
  .regex(/^(\d{4}-\d{2}-\d{2})?$/, "Pick a valid date.")
  .nullable()
  .optional()
  .transform((value) => (value ? value : null));
const priority = z.enum(["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"]);
const category = z.enum(["TODO", "IN_PROGRESS", "DONE"]);

export const projectKeySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(PROJECT_KEY_PATTERN, "Use 2–10 capital letters or numbers, starting with a letter (e.g. BOT).");

const projectFields = {
  name: z.string().trim().min(2, "Give the project a name.").max(80, "Keep the name under 80 characters."),
  key: projectKeySchema,
  description: z.string().trim().max(2000, "Keep the description under 2,000 characters.").optional().transform((value) => value || null),
  ownerId: optionalId,
  teamId: optionalId,
  startsOn: dateInput,
  dueOn: dateInput,
};

export const createProjectSchema = z.object({
  ...projectFields,
  template: z.enum(["standard", "simple", "build"]).default("standard"),
});

export const updateProjectSchema = z.object({
  projectId: id,
  cyclesEnabled: z.boolean().optional(),
  restrictTaskEdits: z.boolean().optional(),
  ...projectFields,
  status: z.enum(["ACTIVE", "PAUSED", "DONE"]),
});

export const projectIdSchema = z.object({ projectId: id });

export const columnNameSchema = z.string().trim().min(1, "Name the column.").max(40, "Keep column names under 40 characters.");
export const addColumnSchema = z.object({ projectId: id, name: columnNameSchema, category: category.default("IN_PROGRESS") });
export const updateColumnSchema = z.object({ columnId: id, name: columnNameSchema, category });
export const reorderColumnsSchema = z.object({ projectId: id, columnIds: z.array(id).min(1).max(30) });
export const deleteColumnSchema = z.object({ columnId: id, moveToColumnId: id });

const tone = z.enum(["NEUTRAL", "SUCCESS", "WARNING", "INFO", "DANGER", "ACCENT", "HIGHLIGHT"]);
const typeIcon = z.enum(["TASK", "BUG", "FEATURE", "DOCS", "CHORE", "MILESTONE", "IDEA", "RISK"]);
export const taskTypeNameSchema = z.string().trim().min(1, "Name the type.").max(30, "Keep type names under 30 characters.");
export const createTaskTypeSchema = z.object({ projectId: id, name: taskTypeNameSchema, tone: tone.default("NEUTRAL"), icon: typeIcon.default("TASK") });
export const updateTaskTypeSchema = z.object({ typeId: id, name: taskTypeNameSchema.optional(), tone: tone.optional(), icon: typeIcon.optional() });
export const taskTypeIdSchema = z.object({ typeId: id });
export const reorderTaskTypesSchema = z.object({ projectId: id, typeIds: z.array(id).min(1).max(30) });

export const taskTitleSchema = z.string().trim().min(1, "Give the task a title.").max(200, "Keep the title under 200 characters.");

export const createTaskSchema = z.object({
  projectId: optionalId,
  columnId: optionalId,
  parentId: optionalId,
  title: taskTitleSchema,
  description: z.string().max(100_000).optional().nullable(),
  priority: priority.default("NONE"),
  dueDate: dateInput,
  assigneeIds: ids(20).default([]),
  labelIds: ids(20).default([]),
  /** Put the new card at the top of its column instead of the bottom. */
  atTop: z.boolean().default(false),
  /** A type of the task's project; omitted = the project's default. */
  typeId: optionalId,
});

export const updateTaskSchema = z
  .object({
    taskId: id,
    /** A type of the task's project; null = back to the project's default. */
    typeId: optionalId,
    title: taskTitleSchema.optional(),
    description: z.string().max(100_000).nullable().optional(),
    priority: priority.optional(),
    dueDate: z
      .string()
      .trim()
      .regex(/^(\d{4}-\d{2}-\d{2})?$/, "Pick a valid date.")
      .nullable()
      .optional(),
  })
  .refine((value) => value.title !== undefined || value.description !== undefined || value.priority !== undefined || value.dueDate !== undefined || value.typeId !== undefined, "Nothing to change.");

export const transferTaskSchema = z.object({ taskId: id, targetProjectKey: projectKeySchema });
export const moveTaskSchema = z.object({ taskId: id, columnId: id, afterTaskId: id.nullable() });
export const setAssigneesSchema = z.object({ taskId: id, userIds: ids(20) });
export const assignTaskSchema = z.object({ taskId: id, userId: id });
export const setLabelsSchema = z.object({ taskId: id, labelIds: ids(20) });
export const completeTaskSchema = z.object({ taskId: id, completed: z.boolean() });
export const archiveTaskSchema = z.object({ taskId: id, archived: z.boolean() });
export const taskIdSchema = z.object({ taskId: id });

export const commentBodySchema = z.string().trim().min(1, "Write a comment first.").max(5000, "Keep comments under 5,000 characters.");
export const addCommentSchema = z.object({ taskId: id, body: commentBodySchema });
export const editCommentSchema = z.object({ commentId: id, body: commentBodySchema });
export const commentIdSchema = z.object({ commentId: id });

export const addDependencySchema = z.object({
  taskId: id,
  /** "BOT-12", "#12" or "12". */
  reference: z.string().trim().min(1, "Enter a task reference like BOT-12.").max(30),
  /** blockedBy: the other task blocks this one; blocks: this task blocks the other. */
  direction: z.enum(["blockedBy", "blocks"]),
});
export const removeDependencySchema = z.object({ blockingTaskId: id, blockedTaskId: id });

export const setRecurrenceSchema = z.object({
  taskId: id,
  rrule: z.string().trim().min(6).max(200),
  createMode: z.enum(["ON_SCHEDULE", "ON_COMPLETION"]).default("ON_SCHEDULE"),
  assigneeMode: z.enum(["FIXED", "ROTATE"]).default("FIXED"),
  assigneeIds: ids(20).default([]),
  /** Days between an instance being created and being due (0 = due the same day). */
  dueOffsetDays: z.number().int().min(0).max(365).nullable().default(0),
  /** First instance date (YYYY-MM-DD); defaults to the next matching day. */
  startDate: dateInput,
});

export const fileIdSchema = z.object({ taskId: id, fileId: id });
