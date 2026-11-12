import "server-only";

import { recordActivity } from "@/lib/activity";
import {
  assertActor,
  changed,
  ensure,
  jsonObject,
  serial,
  type Actor,
} from "@/lib/meetings/core";
import { dispatch } from "@/lib/notify";
import { fromDateInputValue } from "@/lib/tasks/localDate";
import { RESTRICTED_EDIT_MESSAGE } from "@/lib/tasks/capabilities";
import { canEditTaskInTx } from "@/lib/tasks/service/helpers";
import { carryOverTaskIds } from "./progress";

import { cycleWhere } from "./access";
import { createCycle } from "./create";
import { cycleCommand } from "./validation";

export { cycleWhere } from "./access";
export { cycleCommand } from "./validation";

export async function mutateCycle(actor: Actor, input: unknown) {
  const raw: Record<string, unknown> =
    input && typeof input === "object"
      ? { ...(input as Record<string, unknown>) }
      : {};
  if (raw.op === "create" || raw.op === "edit")
    for (const key of ["startsAt", "endsAt"]) {
      if (
        typeof raw[key] === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(raw[key])
      ) {
        const local = fromDateInputValue(raw[key], actor.workspace.timezone);
        ensure(local, "Choose a valid date.");
        raw[key] = local;
      }
    }
  const data = cycleCommand.parse(raw);
  const result = await serial(async (tx) => {
    let notification: import("@/lib/notify/types").DispatchResult | null = null;
    await assertActor(actor, tx);
    if (data.op === "create") {
      const id = await createCycle(actor, data, tx);
      return { id, notification };
    }
    const cycle = await tx.cycle.findFirst({
      where: { ...(await cycleWhere(actor, tx)), id: data.cycleId },
      include: {
        tasks: {
          where: { workspaceId: actor.workspace.id },
          orderBy: { number: "asc" },
        },
      },
    });
    ensure(cycle);
    if (data.op === "review") {
      ensure(
        cycle.status === "COMPLETED",
        "Complete the cycle before recording its review.",
      );
      const previous = await tx.activityEvent.findFirst({
        where: {
          workspaceId: actor.workspace.id,
          entityType: "cycle_review",
          entityId: cycle.id,
        },
        orderBy: { createdAt: "desc" },
      });
      ensure(previous);
      await recordActivity(
        {
          workspaceId: actor.workspace.id,
          actorId: actor.user.id,
          entityType: "cycle_review",
          entityId: cycle.id,
          verb: "reviewed",
          summary: `Reviewed cycle ${cycle.number}`,
          projectId: cycle.projectId,
          teamId: cycle.teamId,
          data: {
            ...jsonObject(previous.data),
            review: data.review,
          } as import("@prisma/client").Prisma.InputJsonValue,
        },
        tx,
      );
      await changed(
        tx,
        actor,
        "cycle",
        cycle.id,
        cycle.name ?? `Cycle ${cycle.number}`,
        `cycles/${cycle.id}`,
        "reviewed",
        cycle.goal ?? "",
        { teamId: cycle.teamId, projectId: cycle.projectId },
      );
      return { id: cycle.id, notification };
    }
    ensure(
      cycle.status !== "COMPLETED",
      "This cycle is complete. Choose an open cycle.",
    );
    if (data.op === "edit") {
      ensure(
        data.endsAt > data.startsAt &&
          data.endsAt.getTime() - data.startsAt.getTime() <= 366 * 86_400_000,
        "Choose an end date after the start, within a year.",
      );
      await tx.cycle.updateMany({
        where: { workspaceId: actor.workspace.id, id: cycle.id },
        data: {
          name: data.name,
          goal: data.goal,
          startsAt: data.startsAt,
          endsAt: data.endsAt,
        },
      });
      await changed(
        tx,
        actor,
        "cycle",
        cycle.id,
        data.name,
        `cycles/${cycle.id}`,
        "updated",
        data.goal,
        { teamId: cycle.teamId, projectId: cycle.projectId },
      );
      return { id: cycle.id, notification };
    }
    if (data.op === "assign") {
      const task = await tx.task.findFirst({
        where: {
          workspaceId: actor.workspace.id,
          id: data.taskId,
          projectId: cycle.projectId,
          archivedAt: null,
        },
      });
      ensure(task && (!data.remove || task.cycleId === cycle.id));
      const project = await tx.project.findFirst({ where: { id: cycle.projectId!, workspaceId: actor.workspace.id }, select: { restrictTaskEdits: true, ownerId: true } });
      ensure(await canEditTaskInTx(tx, actor, [task], project), RESTRICTED_EDIT_MESSAGE);
      if (task.cycleId && task.cycleId !== cycle.id) {
        const previous = await tx.cycle.findFirst({
          where: { workspaceId: actor.workspace.id, id: task.cycleId },
        });
        ensure(
          previous?.status !== "COMPLETED",
          "Keep completed cycle history intact. Create a new task instead.",
        );
      }
      await tx.task.updateMany({
        where: { workspaceId: actor.workspace.id, id: task.id },
        data: { cycleId: data.remove ? null : cycle.id },
      });
    } else if (data.op === "start") {
      ensure(cycle.status === "UPCOMING");
      ensure(
        !(await tx.cycle.findFirst({
          where: {
            workspaceId: actor.workspace.id,
            projectId: cycle.projectId,
            status: "ACTIVE",
          },
        })),
        "Complete the active cycle first.",
      );
      await tx.cycle.updateMany({
        where: { workspaceId: actor.workspace.id, id: cycle.id },
        data: { status: "ACTIVE" },
      });
      notification = await dispatch(
        actor.workspace.id,
        {
          type: "cycle.started",
          title: `Cycle started: ${cycle.name ?? cycle.number}`,
          actorId: actor.user.id,
          useWorkspaceRules: !cycle.teamId,
          scope: { projectId: cycle.projectId! },
          url: `/w/${actor.workspace.slug}/cycles/${cycle.id}`,
          data: { cycleId: cycle.id, projectId: cycle.projectId },
        },
        { tx },
      );
    } else {
      ensure(
        cycle.status === "ACTIVE",
        "Start the cycle before completing it.",
      );
      if (data.carryToId) {
        const next = await tx.cycle.findFirst({
          where: {
            ...(await cycleWhere(actor, tx)),
            id: data.carryToId,
            projectId: cycle.projectId,
            status: { not: "COMPLETED" },
          },
        });
        ensure(
          next && next.id !== cycle.id,
          "Choose another open cycle in this project.",
        );
        await tx.task.updateMany({
          where: {
            workspaceId: actor.workspace.id,
            cycleId: cycle.id,
            id: { in: carryOverTaskIds(cycle.tasks) },
          },
          data: { cycleId: next.id },
        });
      }
      await tx.cycle.updateMany({
        where: { workspaceId: actor.workspace.id, id: cycle.id },
        data: { status: "COMPLETED" },
      });
      await recordActivity(
        {
          workspaceId: actor.workspace.id,
          actorId: actor.user.id,
          entityType: "cycle_review",
          entityId: cycle.id,
          verb: "completed",
          summary: `Reviewed cycle ${cycle.name ?? cycle.number}`,
          teamId: cycle.teamId,
          projectId: cycle.projectId,
          data: {
            review: data.review,
            carriedToId: data.carryToId ?? null,
            tasks: cycle.tasks.map((t) => ({
              id: t.id,
              title: t.title,
              createdAt: t.createdAt.toISOString(),
              completedAt: t.completedAt?.toISOString() ?? null,
              archivedAt: t.archivedAt?.toISOString() ?? null,
            })),
          },
        },
        tx,
      );
      notification = await dispatch(
        actor.workspace.id,
        {
          type: "cycle.completed",
          title: `Cycle complete: ${cycle.name ?? cycle.number}`,
          actorId: actor.user.id,
          useWorkspaceRules: !cycle.teamId,
          scope: { projectId: cycle.projectId! },
          url: `/w/${actor.workspace.slug}/cycles/${cycle.id}`,
          data: { cycleId: cycle.id, projectId: cycle.projectId },
        },
        { tx },
      );
    }
    await changed(
      tx,
      actor,
      "cycle",
      cycle.id,
      cycle.name ?? `Cycle ${cycle.number}`,
      `cycles/${cycle.id}`,
      data.op,
      cycle.goal ?? "",
      { teamId: cycle.teamId, projectId: cycle.projectId },
    );
    return { id: cycle.id, notification };
  });
  await result.notification?.afterCommit();
  return { id: result.id };
}
