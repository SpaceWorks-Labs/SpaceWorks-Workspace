"use client";

import { Checkbox } from "@/components/ui/choice";
import { TD, TR } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { RESTRICTED_EDIT_MESSAGE } from "@/lib/tasks/capabilities";
import { taskReference } from "@/lib/tasks/links";
import type { BoardData, BoardTask } from "@/lib/tasks/types";
import { effectiveType } from "@/lib/tasks/taskTypes";
import { BlockedChip, LabelChips, TypeChip } from "./bits";
import { AssigneesCell, DueCell, PriorityCell, StatusCell } from "./ListCells";
import type { MultiSelectItem } from "./MultiSelect";
import { duePatch, movePatch, type TaskPatch } from "./useListEdits";

export type RowContext = {
  data: BoardData;
  timeZone: string;
  now: Date;
  assignees: MultiSelectItem[];
  onOpen: (number: number) => void;
  onComplete: (task: BoardTask, completed: boolean) => void;
  change: (task: BoardTask, patch: TaskPatch) => void;
  claim: ((task: BoardTask) => void) | null;
};

/** Why a cell is read-only, as a short hint. */
export function lockedHint(data: BoardData): string {
  if (data.project.status === "ARCHIVED") return "This project is archived.";
  return data.permissions.canEdit ? RESTRICTED_EDIT_MESSAGE : "You can view this project but not edit it.";
}

/** A task is selectable when the viewer can edit it, or take it (claim-only actions). */
export const isSelectable = (data: BoardData, task: BoardTask) => data.permissions.canEdit && (task.canEdit || task.canClaim);

/** One list row: selection, done tick, title (opens the drawer) and the four inline-edit cells. */
export function ListRow({ task, ctx, selected, onSelect }: { task: BoardTask; ctx: RowContext; selected: boolean; onSelect: (shift: boolean) => void }) {
  const { data, timeZone, now } = ctx;
  const reference = taskReference(data.project.key, task.number);
  const editable = data.permissions.canEdit && task.canEdit;
  const hint = lockedHint(data);
  return (
    <TR className={cn("sw-row-in group", selected && "bg-accent-soft")}>
      <TD className="w-12">
        {isSelectable(data, task) ? (
          <Checkbox
            checked={selected}
            aria-label={`Select ${reference}`}
            onClick={(event) => {
              // Shift-click selects a range; Radix reports the click before the state flips.
              if (event.shiftKey) {
                event.preventDefault();
                onSelect(true);
              }
            }}
            onCheckedChange={() => onSelect(false)}
          />
        ) : null}
      </TD>
      <TD className="w-12">
        <Checkbox checked={Boolean(task.completedAt)} disabled={!editable} aria-label={`${task.completedAt ? "Reopen" : "Complete"} ${reference}`} onCheckedChange={(checked) => ctx.onComplete(task, checked === true)} />
      </TD>
      <TD className={cn("sticky left-0 z-[1] min-w-[260px] border-r border-line bg-panel transition-colors duration-[var(--sw-dur-fast)] group-hover:bg-subtle", selected && "bg-accent-soft group-hover:bg-accent-soft")}>
        <button type="button" onClick={() => ctx.onOpen(task.number)} className="flex flex-col items-start gap-1 text-left">
          <span className={cn("font-medium text-ink underline-offset-4 hover:underline", task.completedAt && "text-ink-muted line-through")}>
            <span className="mr-2 text-caption font-semibold tabular-nums text-ink-muted">{reference}</span>
            {task.title}
          </span>
          <span className="flex flex-wrap gap-1">
            <TypeChip type={effectiveType(data.taskTypes, task.typeId)} />
            {task.blocked && !task.completedAt ? <BlockedChip /> : null}
            <LabelChips labelIds={task.labelIds} labels={data.labels} />
          </span>
        </button>
      </TD>
      <TD className="whitespace-nowrap">
        <StatusCell task={task} columns={data.columns} editable={editable} hint={hint} onPick={(columnId) => ctx.change(task, movePatch(data, task, columnId))} />
      </TD>
      <TD>
        <PriorityCell task={task} editable={editable} hint={hint} onPick={(priority) => ctx.change(task, { priority })} />
      </TD>
      <TD>
        <AssigneesCell
          task={task}
          members={data.members}
          items={ctx.assignees}
          editable={editable}
          hint={hint}
          onSet={(assigneeIds) => ctx.change(task, { assigneeIds })}
          onClaim={data.permissions.canEdit && task.canClaim && !task.isAssignedToMe && ctx.claim ? () => ctx.claim?.(task) : null}
        />
      </TD>
      <TD className="whitespace-nowrap">
        <DueCell task={task} editable={editable} hint={hint} timeZone={timeZone} now={now} onPick={(value) => ctx.change(task, duePatch(value, timeZone))} />
      </TD>
    </TR>
  );
}
