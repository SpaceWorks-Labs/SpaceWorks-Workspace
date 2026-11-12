"use client";

import { type ReactNode } from "react";
import {
  moveTaskAction,
  setAssigneesAction,
  setLabelsAction,
  updateTaskAction,
} from "@/app/actions/tasks";
import { Button } from "@/components/ui/button";
import { Avatar, Chip } from "@/components/ui/display";
import { Dropdown } from "@/components/ui/field";
import { controlClasses } from "@/components/ui/styles";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format/datetime";
import { labelChipTone } from "@/lib/labels";
import { PRIORITIES, PRIORITY_LABELS } from "@/lib/tasks/filters";
import { toDateInputValue } from "@/lib/tasks/localDate";
import type { TaskDetailDTO } from "@/lib/tasks/types";
import { effectiveType } from "@/lib/tasks/taskTypes";
import { DueChip, PriorityChip, TypeChip } from "./bits";
import { MultiSelect } from "./MultiSelect";
import { RepeatControl } from "./RepeatControl";
import type { RunAction } from "./useTaskRunner";

function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] items-start gap-3 py-2.5 sm:grid-cols-[120px_minmax(0,1fr)]">
      <dt className="pt-2.5 text-label text-ink-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

const LOCK_HINT = "Only the creator, assignees and project admins can edit this task";

export function TaskProperties({ slug, task, canEdit, run }: {
  slug: string;
  task: TaskDetailDTO;
  canEdit: boolean;
  run: RunAction;
}) {
  const restricted = Boolean(task.project?.restrictTaskEdits) && !task.permissions.canEdit && !task.archivedAt && task.project?.status !== "ARCHIVED";
  const column = task.columns.find((item) => item.id === task.columnId) ?? null;
  const assigneeItems = [...task.members]
    .sort((a, b) => Number(b.id === task.viewerId) - Number(a.id === task.viewerId))
    .map((person) => ({ id: person.id, label: person.id === task.viewerId ? "Me" : (person.name ?? "Member"), leading: <Avatar name={person.name} src={person.image} size="xs" /> }));
  const labelItems = task.labels.map((label) => ({ id: label.id, label: label.name }));
  return (
    <dl className="divide-y divide-line">
      {task.project && !task.parent ? (
        <Property label="Status">
          {canEdit ? (
            <Dropdown aria-label="Status" value={task.columnId ?? ""} onChange={(event) => void run(() => moveTaskAction(slug, { taskId: task.id, columnId: event.target.value, afterTaskId: null }))}>
              {task.columnId ? null : <option value="">No status</option>}
              {task.columns.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Dropdown>
          ) : (
            <p className="pt-2.5 text-body-ui text-ink">{column?.name ?? "No status"}</p>
          )}
        </Property>
      ) : null}
      {task.project ? (
        <Property label="Type">
          {canEdit ? (
            <Dropdown aria-label="Type" value={effectiveType(task.taskTypes, task.typeId)?.id ?? ""} onChange={(event) => void run(() => updateTaskAction(slug, { taskId: task.id, typeId: event.target.value || null }))}>
              {task.taskTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </Dropdown>
          ) : (
            <div className="pt-2">
              <TypeChip type={effectiveType(task.taskTypes, task.typeId)} size="md" />
            </div>
          )}
        </Property>
      ) : null}
      <Property label="Priority">
        {canEdit ? (
          <Dropdown aria-label="Priority" value={task.priority} onChange={(event) => void run(() => updateTaskAction(slug, { taskId: task.id, priority: event.target.value }))}>
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {PRIORITY_LABELS[priority]}
              </option>
            ))}
          </Dropdown>
        ) : (
          <div className="pt-2">{task.priority === "NONE" ? <span className="text-body-ui text-ink-muted">No priority</span> : <PriorityChip priority={task.priority} size="md" />}</div>
        )}
      </Property>
      <Property label="Assignees">
        <div className="flex flex-col items-start gap-1.5 pt-1.5">
          {task.assignees.length ? (
            <ul className="flex flex-col gap-1.5">
              {task.assignees.map((person) => (
                <li key={person.id} className="flex items-center gap-2 text-body-ui text-ink">
                  <Avatar name={person.name} src={person.image} size="xs" />
                  {person.name ?? "Member"}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-body-ui text-ink-muted">Nobody yet</span>
          )}
          {restricted ? (
            <span className="inline-flex items-center gap-1.5 text-caption text-ink-muted" title={LOCK_HINT}>
              {LOCK_HINT}.
            </span>
          ) : null}
          {canEdit || restricted ? (
            <MultiSelect
              title="Assignees"
              disabled={!canEdit}
              commitOnClose
              trigger={
                <Button variant="quiet" size="sm">
                  {task.assignees.length ? "Change" : "Assign"}
                </Button>
              }
              items={assigneeItems}
              selected={task.assignees.map((person) => person.id)}
              onChange={(userIds) => void run(() => setAssigneesAction(slug, { taskId: task.id, userIds }))}
              searchPlaceholder="Find a member"
            />
          ) : null}
        </div>
      </Property>
      <Property label="Labels">
        <div className="flex flex-col items-start gap-1.5 pt-2">
          {task.labelIds.length ? (
            <div className="flex flex-wrap gap-1.5">
              {task.labelIds.map((id) => {
                const label = task.labels.find((item) => item.id === id);
                return label ? (
                  <Chip key={id} tone={labelChipTone(label.tone)} size="sm">
                    {label.name}
                  </Chip>
                ) : null;
              })}
            </div>
          ) : (
            <span className="text-body-ui text-ink-muted">None</span>
          )}
          {canEdit ? (
            <MultiSelect
              title="Labels"
              commitOnClose
              trigger={
                <Button variant="quiet" size="sm">
                  {task.labelIds.length ? "Change" : "Add labels"}
                </Button>
              }
              items={labelItems}
              selected={task.labelIds}
              onChange={(labelIds) => void run(() => setLabelsAction(slug, { taskId: task.id, labelIds }))}
              emptyText="No labels yet. Admins add them in settings."
            />
          ) : null}
        </div>
      </Property>
      <Property label="Due date">
        {canEdit ? (
          <div className="flex items-center gap-2">
            <input
              type="date"
              aria-label="Due date"
              className={cn(controlClasses, "min-w-0")}
              value={toDateInputValue(task.dueAt ? new Date(task.dueAt) : null, task.timeZone)}
              onChange={(event) => void run(() => updateTaskAction(slug, { taskId: task.id, dueDate: event.target.value || null }))}
            />
            {task.dueAt ? (
              <Button variant="quiet" size="sm" onClick={() => void run(() => updateTaskAction(slug, { taskId: task.id, dueDate: null }))}>
                Clear
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="pt-2">{task.dueAt ? <DueChip dueAt={task.dueAt} completedAt={task.completedAt} timeZone={task.timeZone} size="md" /> : <span className="text-body-ui text-ink-muted">No due date</span>}</div>
        )}
      </Property>
      <Property label="Repeat">
        <div className="pt-2">
          <RepeatControl key={`${task.recurrence?.id ?? "none"}-${task.recurrence?.rrule ?? ""}-${task.recurrence?.active ?? ""}`} slug={slug} task={task} run={run} />
        </div>
      </Property>
      <Property label="Created">
        <p className="pt-2.5 text-body-ui text-ink-secondary">
          {formatDate(task.createdAt, task.timeZone)} by {task.creator?.name ?? "a former member"}
        </p>
      </Property>
    </dl>
  );

}
