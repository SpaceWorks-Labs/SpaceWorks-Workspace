import "server-only";

import { z } from "zod";
import { auditToolWrite } from "@/lib/assistant/tools/audit";
import { defineTool } from "@/lib/assistant/tools/types";
import { assignTask, claimTask, setAssignees, unassignTask, unclaimTask } from "@/lib/tasks/service";
import { assertAssignable, principalToActor, resolveUserIds, unwrap } from "./actor";
import { findTaskForWrite, readTaskDto, taskRef } from "./records";

export const assignTaskTool = defineTool({
  name: "sw_assign_task",
  title: "Assign task",
  description:
    'Change who a task is assigned to. mode "add" (default) adds the people, "remove" removes them, "set" replaces the whole list. userIds may include "me". The person confirms before it runs.',
  input: z.object({
    ref: taskRef,
    userIds: z.array(z.string().trim().min(1).max(64)).max(20),
    mode: z.enum(["add", "remove", "set"]).default("add"),
  }),
  write: true,
  scope: "write:tasks",
  minRole: "MEMBER",
  async run(ctx, input) {
    const actor = await principalToActor(ctx);
    const task = await findTaskForWrite(actor, input.ref);
    const ids = resolveUserIds(input.userIds, ctx.principal.userId);
    // Validate everyone first so a bad id never leaves a half-applied list.
    if (input.mode !== "remove") await assertAssignable(actor, task.project, ids, task.assignees.map((a) => a.user.id));
    if (input.mode === "set") unwrap(await setAssignees(actor, { taskId: task.id, userIds: ids }));
    else for (const userId of ids) unwrap(await (input.mode === "add" ? assignTask : unassignTask)(actor, { taskId: task.id, userId }));
    await auditToolWrite(ctx, { action: "assistant.task_assigned", targetType: "Task", targetId: task.id, metadata: { number: task.number, mode: input.mode } });
    const dto = await readTaskDto(ctx.principal.workspace.slug, task.id);
    return { summary: `Updated assignees on ${dto.ref}`, data: dto };
  },
});

export const claimTaskTool = defineTool({
  name: "sw_claim_task",
  title: "Claim task",
  description: "Assign a task to yourself, or with release: true take yourself off it. The person confirms before it runs.",
  input: z.object({ ref: taskRef, release: z.boolean().default(false) }),
  write: true,
  scope: "write:tasks",
  minRole: "MEMBER",
  async run(ctx, input) {
    const actor = await principalToActor(ctx);
    const task = await findTaskForWrite(actor, input.ref);
    unwrap(await (input.release ? unclaimTask : claimTask)(actor, { taskId: task.id }));
    await auditToolWrite(ctx, { action: input.release ? "assistant.task_unclaimed" : "assistant.task_claimed", targetType: "Task", targetId: task.id, metadata: { number: task.number } });
    const dto = await readTaskDto(ctx.principal.workspace.slug, task.id);
    return { summary: `${input.release ? "Released" : "Claimed"} ${dto.ref}`, data: dto };
  },
});
