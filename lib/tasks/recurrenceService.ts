import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { actionError, validationError, type ActionResult } from "@/lib/actionResult";
import { nextWorkspaceSequence } from "@/lib/counters";
import { dispatch } from "@/lib/notify";
import { assignableMembers, type TaskActor } from "@/lib/tasks/access";
import { loadEditableTask } from "@/lib/tasks/service/helpers";
import { taskReference, taskUrl } from "@/lib/tasks/links";
import { DAY_MS, fromDateInputValue, localDayNumber, localToInstant, startOfLocalDay } from "@/lib/tasks/localDate";
import { POSITION_GAP } from "@/lib/tasks/position";
import { publishTaskChange } from "@/lib/tasks/realtime";
import { describeRule, formatRRule, nextAssignees, nextOccurrence, parseAssigneeRule, parseRRule, type AssigneeRule } from "@/lib/tasks/recurrence";
import { setRecurrenceSchema, taskIdSchema } from "@/lib/tasks/schemas";
import { indexTask } from "@/lib/tasks/search";

/**
 * Recurring tasks. The task where someone sets "Repeat" is the rule's
 * template. ON_SCHEDULE rules create a copy at each occurrence (09:00 local
 * on the matching day), due `dueOffsetDays` later. ON_COMPLETION rules
 * create the next copy once the current one is done, due on the next
 * matching day. `TaskOccurrence` (unique per rule and date) plus a
 * conditional claim on `nextRunAt` keep creation exactly-once across
 * replicas.
 */

const OCCURRENCE_HOUR = 9;

async function findRuleForTask(task: { id: string; recurrenceId: string | null; workspaceId: string }) {
  return prisma.taskRecurrence.findFirst({
    where: { workspaceId: task.workspaceId, OR: [{ templateTaskId: task.id }, ...(task.recurrenceId ? [{ id: task.recurrenceId }] : [])] },
    orderBy: [{ active: "desc" }, { updatedAt: "desc" }],
  });
}

async function editableTask(actor: TaskActor, taskId: string) {
  const found = await loadEditableTask(actor, taskId, { action: "edit" });
  return "error" in found ? { error: found.error } : { task: found.task };
}

export async function setRecurrence(actor: TaskActor, input: unknown): Promise<ActionResult<{ description: string; nextRunAt: string | null }>> {
  const parsed = setRecurrenceSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const data = parsed.data;
  const editable = await editableTask(actor, data.taskId);
  if (editable.error !== undefined) return actionError(editable.error);
  const { task } = editable;
  const rule = parseRRule(data.rrule);
  if (!rule) return actionError("Choose how often it repeats.", { rrule: ["That repeat pattern isn't supported."] });
  if (data.assigneeIds.length > 0) {
    const allowed = new Set((await assignableMembers(actor.workspace.id, task.project)).map((person) => person.id));
    if (!data.assigneeIds.every((id) => allowed.has(id))) return actionError("Assign only members who can see this project.");
  }
  if (data.assigneeMode === "ROTATE" && data.assigneeIds.length < 2) return actionError("Pick at least two people to take turns.", { assigneeIds: ["Pick two or more people."] });
  const timeZone = actor.workspace.timezone;
  const now = new Date();
  const existing = await findRuleForTask(task);
  const templateTaskId = existing?.templateTaskId ?? task.id;

  let nextRunAt: Date | null = null;
  if (data.createMode === "ON_SCHEDULE") {
    const start = data.startDate ? fromDateInputValue(data.startDate, timeZone) : null;
    if (data.startDate && !start) return actionError("Pick a valid start date.", { startDate: ["Pick a valid date."] });
    if (start) {
      const anchor = localToInstant(localDayNumber(start, timeZone), OCCURRENCE_HOUR, 0, timeZone);
      nextRunAt = nextOccurrence(rule, anchor, new Date(Math.max(anchor.getTime(), now.getTime()) - 1), timeZone);
    } else {
      // From tomorrow: this task is today's instance.
      const today = localDayNumber(now, timeZone);
      const anchor = localToInstant(today, OCCURRENCE_HOUR, 0, timeZone);
      nextRunAt = nextOccurrence(rule, anchor, new Date(localToInstant(today + 1, 0, 0, timeZone).getTime() - 1), timeZone);
    }
    if (!nextRunAt) return actionError("That pattern never repeats. Pick another.");
  } else {
    const currentId = existing?.lastCreatedTaskId ?? templateTaskId;
    const current = await prisma.task.findFirst({ where: { id: currentId, workspaceId: actor.workspace.id }, select: { completedAt: true } });
    nextRunAt = current?.completedAt ? now : null;
  }

  const previous = existing ? parseAssigneeRule(existing.assigneeRule) : null;
  const assigneeRule: AssigneeRule =
    data.assigneeMode === "ROTATE"
      ? { type: "ROTATE", userIds: data.assigneeIds, index: previous?.type === "ROTATE" ? previous.index : 0 }
      : { type: "FIXED", userIds: data.assigneeIds };
  const description = describeRule(rule);
  const fields = {
    rrule: formatRRule(rule),
    timezone: timeZone,
    createMode: data.createMode,
    assigneeRule: assigneeRule as unknown as Prisma.InputJsonValue,
    dueOffsetDays: data.createMode === "ON_SCHEDULE" ? (data.dueOffsetDays ?? 0) : null,
    nextRunAt,
    active: true,
  };
  await prisma.$transaction(async (tx) => {
    const saved = existing
      ? await tx.taskRecurrence.update({ where: { id: existing.id }, data: fields })
      : await tx.taskRecurrence.create({ data: { ...fields, workspaceId: actor.workspace.id, templateTaskId, createdById: actor.user.id } });
    await tx.taskActivity.create({ data: { taskId: task.id, actorId: actor.user.id, kind: "recurrence_set", data: { text: description } } });
    await recordAuditEvent({ action: "task.recurrence_set", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "TaskRecurrence", targetId: saved.id, metadata: { rrule: saved.rrule, createMode: saved.createMode }, client: tx });
  });
  await publishTaskChange({ workspaceId: actor.workspace.id, project: task.project, taskIds: [task.id], type: "task.changed", actorId: actor.user.id });
  return { ok: true, data: { description, nextRunAt: nextRunAt?.toISOString() ?? null } };
}

export async function stopRecurrence(actor: TaskActor, input: unknown): Promise<ActionResult> {
  const parsed = taskIdSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const editable = await editableTask(actor, parsed.data.taskId);
  if (editable.error !== undefined) return actionError(editable.error);
  const { task } = editable;
  const rule = await findRuleForTask(task);
  if (!rule || !rule.active) return { ok: true };
  await prisma.$transaction(async (tx) => {
    await tx.taskRecurrence.update({ where: { id: rule.id }, data: { active: false, nextRunAt: null } });
    await tx.taskActivity.create({ data: { taskId: task.id, actorId: actor.user.id, kind: "recurrence_stopped" } });
    await recordAuditEvent({ action: "task.recurrence_stopped", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "TaskRecurrence", targetId: rule.id, client: tx });
  });
  await publishTaskChange({ workspaceId: actor.workspace.id, project: task.project, taskIds: [task.id], type: "task.changed", actorId: actor.user.id });
  return { ok: true };
}

export async function skipNextOccurrence(actor: TaskActor, input: unknown): Promise<ActionResult<{ nextRunAt: string | null }>> {
  const parsed = taskIdSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const editable = await editableTask(actor, parsed.data.taskId);
  if (editable.error !== undefined) return actionError(editable.error);
  const { task } = editable;
  const rule = await findRuleForTask(task);
  const pattern = parseRRule(rule?.rrule);
  if (!rule || !rule.active || rule.createMode !== "ON_SCHEDULE" || !rule.nextRunAt || !pattern) return actionError("There's no upcoming repeat to skip.");
  const next = nextOccurrence(pattern, rule.nextRunAt, rule.nextRunAt, rule.timezone);
  await prisma.$transaction(async (tx) => {
    await tx.taskRecurrence.update({ where: { id: rule.id }, data: { nextRunAt: next } });
    await tx.taskActivity.create({ data: { taskId: task.id, actorId: actor.user.id, kind: "recurrence_skipped", data: { skipped: rule.nextRunAt!.toISOString() } } });
  });
  await publishTaskChange({ workspaceId: actor.workspace.id, project: task.project, taskIds: [task.id], type: "task.changed", actorId: actor.user.id });
  return { ok: true, data: { nextRunAt: next?.toISOString() ?? null } };
}

/* ---------- Generator (scheduler) ---------- */

const dueRuleInclude = {
  workspace: { select: { id: true, slug: true, timezone: true } },
  templateTask: { include: { project: true, labels: { select: { labelId: true } } } },
} satisfies Prisma.TaskRecurrenceInclude;

type DueRule = Prisma.TaskRecurrenceGetPayload<{ include: typeof dueRuleInclude }>;

/**
 * Create every due instance. Safe to run on several replicas at once: each
 * rule is claimed by moving `nextRunAt` with a conditional update inside
 * the creating transaction, and `TaskOccurrence` rejects duplicates.
 * Returns the number of tasks created.
 */
export async function generateRecurringTasks(now: Date = new Date(), limit = 50): Promise<number> {
  const rules = await prisma.taskRecurrence.findMany({
    where: { active: true, nextRunAt: { lte: now }, workspace: { status: "ACTIVE", archivedAt: null } },
    orderBy: { nextRunAt: "asc" },
    take: limit,
    include: dueRuleInclude,
  });
  let created = 0;
  for (const rule of rules) {
    try {
      if (await generateOne(rule, now)) created += 1;
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002") console.error("[tasks] recurring task generation failed");
    }
  }
  return created;
}

async function generateOne(rule: DueRule, now: Date): Promise<boolean> {
  const template = rule.templateTask;
  const pattern = parseRRule(rule.rrule);
  const claimedAt = rule.nextRunAt!;
  if (!pattern || template.archivedAt || template.project?.status === "ARCHIVED") {
    await prisma.taskRecurrence.updateMany({ where: { id: rule.id, nextRunAt: claimedAt }, data: { active: false, nextRunAt: null } });
    return false;
  }
  const timeZone = rule.timezone || rule.workspace.timezone;
  const onSchedule = rule.createMode === "ON_SCHEDULE";
  let occurrenceDate: Date | null = claimedAt;
  if (!onSchedule) {
    // The next due day comes after both now and the finished instance's due day.
    const current = await prisma.task.findUnique({ where: { id: rule.lastCreatedTaskId ?? rule.templateTaskId }, select: { dueAt: true } });
    const afterDue = current?.dueAt ? localToInstant(localDayNumber(current.dueAt, timeZone) + 1, 0, 0, timeZone) : now;
    const after = new Date(Math.max(now.getTime(), afterDue.getTime() - 1));
    occurrenceDate = nextOccurrence(pattern, after, after, timeZone);
  }
  if (!occurrenceDate) return false;
  const nextRunAt = onSchedule ? nextOccurrence(pattern, claimedAt, new Date(Math.max(claimedAt.getTime(), now.getTime())), timeZone) : null;
  const dueAt = onSchedule ? startOfLocalDay(new Date(occurrenceDate.getTime() + (rule.dueOffsetDays ?? 0) * DAY_MS), timeZone) : startOfLocalDay(occurrenceDate, timeZone);
  const project = template.project;
  const eligible = new Set((await assignableMembers(rule.workspaceId, project)).map((person) => person.id));
  const { userIds, next } = nextAssignees(parseAssigneeRule(rule.assigneeRule), eligible);

  const outcome = await prisma.$transaction(async (tx) => {
    const claim = await tx.taskRecurrence.updateMany({
      where: { id: rule.id, active: true, nextRunAt: claimedAt },
      data: { nextRunAt, assigneeRule: next as unknown as Prisma.InputJsonValue },
    });
    if (claim.count === 0) return null;
    if (await tx.taskOccurrence.findUnique({ where: { recurrenceId_occurrenceDate: { recurrenceId: rule.id, occurrenceDate } } })) return null;
    let columnId: string | null = null;
    let position = POSITION_GAP;
    if (project) {
      const columns = await tx.boardColumn.findMany({ where: { projectId: project.id }, orderBy: { position: "asc" }, select: { id: true, category: true } });
      columnId = (columns.find((column) => column.category === "TODO") ?? columns.find((column) => column.category !== "DONE") ?? columns[0])?.id ?? null;
      if (columnId) {
        const edge = await tx.task.aggregate({ where: { columnId, parentId: null, archivedAt: null }, _max: { position: true } });
        position = (edge._max.position ?? 0) + POSITION_GAP;
      }
    }
    const number = await nextWorkspaceSequence(tx, rule.workspaceId, "task");
    const task = await tx.task.create({
      data: {
        workspaceId: rule.workspaceId,
        projectId: project?.id ?? null,
        columnId,
        number,
        title: template.title,
        description: template.description,
        priority: template.priority,
        dueAt,
        position,
        creatorId: rule.createdById,
        recurrenceId: rule.id,
        assignees: { create: userIds.map((userId) => ({ userId })) },
        labels: { create: template.labels.map((label) => ({ labelId: label.labelId })) },
      },
    });
    await tx.taskOccurrence.create({ data: { recurrenceId: rule.id, occurrenceDate, taskId: task.id } });
    await tx.taskRecurrence.update({ where: { id: rule.id }, data: { lastCreatedTaskId: task.id } });
    await tx.taskActivity.create({ data: { taskId: task.id, actorId: null, kind: "created_recurring", data: { text: describeRule(pattern) } } });
    await indexTask(tx, rule.workspace.slug, task, project);
    let afterCommit: () => Promise<void> = async () => undefined;
    if (userIds.length > 0) {
      const result = await dispatch(
        rule.workspaceId,
        {
          type: "task.assigned",
          title: `${taskReference(project?.key, number)} is up: ${template.title}`,
          url: taskUrl(rule.workspace.slug, project?.key, number),
          actorId: null,
          recipients: userIds,
          resource: { type: "task", id: task.id },
          scope: { taskId: task.id, ...(project ? { projectId: project.id } : {}) },
          data: { taskId: task.id, taskNumber: number, projectId: project?.id ?? null },
        },
        { tx },
      );
      afterCommit = result.afterCommit;
    }
    return { task, afterCommit };
  });
  if (!outcome) return false;
  await outcome.afterCommit().catch(() => undefined);
  await publishTaskChange({ workspaceId: rule.workspaceId, project, taskIds: [outcome.task.id], type: "task.created", actorId: null });
  return true;
}
