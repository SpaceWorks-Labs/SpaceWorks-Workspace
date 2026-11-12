"use client";

import { memo, useRef, type CSSProperties, type HTMLAttributes, type Ref } from "react";
import { Plus } from "lucide-react";
import { IconButton } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { taskReference } from "@/lib/tasks/links";
import { effectiveType, type TaskTypeRef } from "@/lib/tasks/taskTypes";
import type { BoardTask, ColumnDTO, LabelRef, PersonRef } from "@/lib/tasks/types";
import { AvatarStack, BlockedChip, DueChip, LabelChips, PriorityChip, SubtaskProgress, TypeChip } from "./bits";
import { CardMoveMenu, type CardMove } from "./board/CardMoveMenu";

export type { CardMove };

/** Drag wiring from `useSortable` (absent on the drag overlay and read-only cards). */
export type CardDnd = {
  setNodeRef: Ref<HTMLElement>;
  setActivatorNodeRef: Ref<HTMLElement>;
  style: CSSProperties;
  activator: HTMLAttributes<HTMLElement>;
  dragging: boolean;
};

/**
 * One board card. The card body is a button that opens the task (Enter) and
 * picks it up for a keyboard drag (Space); the "Move" menu beside it is the
 * touch and screen-reader alternative. Cards the viewer cannot edit are not
 * draggable and say why on hover or focus.
 */
export const TaskCard = memo(function TaskCard({
  task,
  projectKey,
  columns,
  members,
  labels,
  taskTypes,
  timeZone,
  compact = false,
  canEdit,
  canClaim,
  locked = false,
  overlay = false,
  onClaim,
  position,
  onOpen,
  onMove,
  dnd,
}: {
  task: BoardTask;
  projectKey: string;
  columns: ColumnDTO[];
  members: PersonRef[];
  labels: LabelRef[];
  taskTypes: TaskTypeRef[];
  timeZone: string;
  /** Dense card: reference, title, priority, due date and people only. */
  compact?: boolean;
  canEdit: boolean;
  /** Show the hover "Assign to me" button (unassigned and the viewer may take it). */
  canClaim: boolean;
  /** The board is editable but this card is not (restricted project). */
  locked?: boolean;
  /** Rendered inside the drag overlay: no menus, no ids. */
  overlay?: boolean;
  onClaim: (task: BoardTask) => void;
  position: { index: number; count: number };
  onOpen: (number: number) => void;
  onMove: (task: BoardTask, move: CardMove) => void;
  dnd?: CardDnd;
}) {
  const reference = taskReference(projectKey, task.number);
  const assignees = task.assigneeIds.map((id) => members.find((member) => member.id === id) ?? { id, name: "Former member", image: null });
  const done = Boolean(task.completedAt);
  const type = effectiveType(taskTypes, task.typeId);
  const lockId = `lock-${task.id}`;
  const keyboardDrag = useRef(false);
  const describedBy = [dnd?.activator["aria-describedby"], locked ? lockId : null].filter(Boolean).join(" ") || undefined;
  const activator = dnd?.activator;
  return (
    <article
      ref={dnd?.setNodeRef as Ref<HTMLElement> | undefined}
      style={{ ...dnd?.style, "--sw-i": position.index } as CSSProperties}
      data-card-id={overlay ? undefined : task.id}
      aria-label={`${reference} ${task.title}`}
      className={cn(
        "group relative rounded-xl border border-line bg-panel transition-[background-color,border-color,opacity,transform,box-shadow] duration-[var(--sw-dur-fast)] ease-[var(--sw-ease-standard)] hover:border-line-strong",
        canEdit && !overlay && "cursor-grab",
        !overlay && "sw-rise-in",
        dnd?.dragging && "opacity-40",
        overlay && "sw-lift scale-[1.02] cursor-grabbing border-line-strong shadow-[var(--yy-shadow-float)]",
      )}
    >
      <button
        type="button"
        data-card-focus={overlay ? undefined : task.id}
        ref={dnd?.setActivatorNodeRef as Ref<HTMLButtonElement> | undefined}
        {...activator}
        onKeyDown={(event) => {
          // Space/Enter that start or drop a keyboard drag must not also open the task.
          if (event.key === " " || event.key === "Enter") keyboardDrag.current = event.key === " " || Boolean(dnd?.dragging);
          activator?.onKeyDown?.(event);
        }}
        onKeyUp={(event) => {
          if (event.key === " ") setTimeout(() => (keyboardDrag.current = false), 0);
        }}
        onClick={(event) => {
          if (keyboardDrag.current || dnd?.dragging) {
            keyboardDrag.current = false;
            event.preventDefault();
            return;
          }
          onOpen(task.number);
        }}
        aria-describedby={describedBy}
        className={cn("flex w-full touch-manipulation flex-col rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--yy-focus)]", compact ? "gap-1 p-2 pr-11" : "gap-2 p-3 pr-11")}
      >
        <span className="flex flex-wrap items-center gap-1.5 text-caption font-semibold tabular-nums text-ink-muted">
          {done ? (
            <>
              <span aria-hidden="true" className="inline-flex items-center justify-center text-xs font-semibold">✓</span>
              <span className="sr-only">Done</span>
            </>
          ) : null}
          {reference}
          <TypeChip type={type} />
          {task.recurring ? <span className="inline-flex items-center justify-center text-xs font-semibold">Recurring</span> : null}
        </span>
        <span className={cn("break-words text-body-ui font-medium text-ink", done && "text-ink-secondary")}>{task.title}</span>
        {task.labelIds.length || task.priority !== "NONE" || task.blocked || task.dueAt ? (
          <span className="flex flex-wrap gap-1.5">
            {task.blocked && !done ? <BlockedChip /> : null}
            <PriorityChip priority={task.priority} />
            <DueChip dueAt={task.dueAt} completedAt={task.completedAt} timeZone={timeZone} />
            {compact ? null : <LabelChips labelIds={task.labelIds} labels={labels} max={2} />}
          </span>
        ) : null}
        {assignees.length || (!compact && (task.subtaskCount || task.commentCount || task.attachmentCount)) ? (
          <span className="flex items-center gap-3 text-caption text-ink-muted">
            {compact ? null : <SubtaskProgress done={task.subtaskDone} total={task.subtaskCount} />}
            {!compact && task.commentCount ? <span className="tabular-nums">{task.commentCount} comments</span> : null}
            {!compact && task.attachmentCount ? <span className="tabular-nums">{task.attachmentCount} attachments</span> : null}
            <AvatarStack people={assignees} className="ml-auto" />
          </span>
        ) : null}
      </button>
      {locked && !overlay ? (
        <span id={lockId} className="pointer-events-none absolute bottom-2 left-3 rounded-md bg-surface px-1.5 text-caption text-ink-muted opacity-0 transition-opacity duration-[var(--sw-dur-fast)] group-focus-within:opacity-100 group-hover:opacity-100">
          Locked: only the creator, assignees and project admins can move this.
        </span>
      ) : null}
      {canClaim && assignees.length === 0 && !overlay ? (
        <div className="absolute bottom-2 right-2 opacity-0 transition-opacity duration-[var(--sw-dur-fast)] focus-within:opacity-100 group-hover:opacity-100">
          <IconButton
            label={`Assign ${reference} to me`}
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              onClaim(task);
            }}
          >
            <Plus />
          </IconButton>
        </div>
      ) : null}
      {canEdit && !overlay ? (
        <div className="absolute right-1 top-1">
          <CardMoveMenu reference={reference} columns={columns} columnId={task.columnId} position={position} onMove={(move) => onMove(task, move)} />
        </div>
      ) : null}
    </article>
  );
});
