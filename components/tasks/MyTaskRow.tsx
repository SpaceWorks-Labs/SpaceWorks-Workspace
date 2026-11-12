"use client";

import { Checkbox } from "@/components/ui/choice";
import { cn } from "@/lib/cn";
import { taskReference } from "@/lib/tasks/links";
import type { MyTasksTab, MyTaskItem } from "@/lib/tasks/myTasks";
import type { LabelRef } from "@/lib/tasks/types";
import { AvatarStack, BlockedChip, DueChip, LabelChips, PriorityChip } from "./bits";

/** One row of My tasks. Other tabs also show who the task is assigned to. */
export function MyTaskRow({
  task,
  tab,
  labels,
  timeZone,
  now,
  onOpen,
  onToggle,
}: {
  task: MyTaskItem;
  tab: MyTasksTab;
  labels: LabelRef[];
  timeZone: string;
  now: Date;
  onOpen: (number: number) => void;
  onToggle: (task: MyTaskItem, completed: boolean) => void;
}) {
  const reference = taskReference(task.projectKey, task.number);
  const done = Boolean(task.completedAt);
  const names = task.assignees.map((person) => person.name ?? "Member").join(", ");
  return (
    <li className="flex min-h-14 items-start gap-3 px-4 py-3">
      <Checkbox
        className="mt-0.5"
        checked={done}
        disabled={!task.canEdit}
        title={task.canEdit ? undefined : "Only the creator, assignees and project admins can edit this task."}
        aria-label={`${done ? "Reopen" : "Complete"} ${reference} ${task.title}`}
        onCheckedChange={(checked) => onToggle(task, checked === true)}
      />
      <div className="min-w-0 flex-1">
        <button type="button" onClick={() => onOpen(task.number)} className={cn("text-left text-body-ui font-medium text-ink underline-offset-4 hover:underline", done && "text-ink-muted line-through")}>
          {task.title}
        </button>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-caption text-ink-muted">
          <span className="font-semibold tabular-nums">{reference}</span>
          {task.projectName ? <span>· {task.projectName}</span> : null}
          {task.blocked && !done ? <BlockedChip /> : null}
          <PriorityChip priority={task.priority} />
          <DueChip dueAt={task.dueAt} completedAt={task.completedAt} timeZone={timeZone} now={now} />
          <LabelChips labelIds={task.labelIds} labels={labels} max={2} />
        </div>
      </div>
      {tab !== "assigned" ? (
        <div className="flex max-w-[40%] shrink-0 items-center gap-2 text-caption text-ink-muted">
          {task.assignees.length ? (
            <>
              <AvatarStack people={task.assignees} />
              <span className="hidden truncate sm:inline">{names}</span>
            </>
          ) : (
            <span>Unassigned</span>
          )}
        </div>
      ) : null}
    </li>
  );
}
