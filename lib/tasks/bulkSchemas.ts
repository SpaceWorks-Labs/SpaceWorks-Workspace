import { z } from "zod";

/** Bulk edit contract (client-safe): shared by the list view, the action and lib/tasks/service/bulk. */

export const MAX_BULK = 50;
export const SELECT_LIMIT_MESSAGE = `Select up to ${MAX_BULK} tasks.`;

const id = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "Invalid id.");

export const bulkOpSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("move"), columnId: id }),
  z.object({ kind: z.literal("priority"), priority: z.enum(["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"]) }),
  z.object({ kind: z.literal("assign"), userId: id }),
  z.object({ kind: z.literal("unassign"), userId: id }),
  z.object({ kind: z.literal("claim") }),
  z.object({ kind: z.literal("archive") }),
]);

export const bulkInputSchema = z.object({
  taskIds: z.array(id).min(1, "Select at least one task.").max(MAX_BULK, SELECT_LIMIT_MESSAGE).transform((values) => [...new Set(values)]),
  op: bulkOpSchema,
});

export type BulkOp = z.infer<typeof bulkOpSchema>;
export type BulkResult = { taskId: string; ref: string; ok: boolean; error?: string };
