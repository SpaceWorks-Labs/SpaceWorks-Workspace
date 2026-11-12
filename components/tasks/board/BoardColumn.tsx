"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { ComponentProps } from "react";
import { CollapseToggle, usePersistentOpen } from "@/components/ui/collapsible-section";
import { cn } from "@/lib/cn";
import { columnDropId } from "@/lib/tasks/boardMoves";
import type { BoardTask, ColumnDTO } from "@/lib/tasks/types";
import { ColumnMenu } from "../ColumnControls";
import { QuickAdd } from "../BoardQuickAdd";
import type { RunAction } from "../useTaskRunner";
import { SortableCard } from "./SortableCard";

const TONE_DOT: Record<ColumnDTO["category"], string> = { TODO: "bg-ink-muted", IN_PROGRESS: "bg-accent", DONE: "bg-success-solid" };

type CardShared = Omit<ComponentProps<typeof SortableCard>, "task" | "columnId" | "canEdit" | "canClaim" | "locked" | "position" | "onClaim">;

/** One board column: tone dot, name, count, its sortable cards and quick add. */
export function BoardColumn({
  column,
  ids,
  tasksById,
  total,
  filtered,
  canEdit,
  manage,
  card,
  onClaim,
  quickAddOpen,
  onQuickAddOpenChange,
  onCreate,
}: {
  column: ColumnDTO;
  /** Task ids to show, in order (the live layout while dragging). */
  ids: string[];
  tasksById: Map<string, BoardTask>;
  total: number;
  filtered: boolean;
  canEdit: boolean;
  manage: { slug: string; projectId: string; projectKey: string; columns: ColumnDTO[]; run: RunAction } | null;
  card: CardShared;
  onClaim: (task: BoardTask) => void;
  quickAddOpen: boolean;
  onQuickAddOpenChange: (open: boolean) => void;
  onCreate: (title: string, options: { openAfter: boolean }) => Promise<boolean>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: columnDropId(column.id) });
  const tasks = ids.map((id) => tasksById.get(id)).filter((task): task is BoardTask => Boolean(task));
  const [storedOpen, setOpen] = usePersistentOpen("sw:collapse:board", column.id, true);
  // Quick add (the `c` shortcut) needs the column open.
  const open = storedOpen || quickAddOpen;
  const bodyId = `board-column-${column.id}-body`;
  const countLabel = filtered ? `${tasks.length}/${total}` : total;
  if (!open) {
    // A narrow strip that is still the column's drop target: a dropped card goes to the end.
    return (
      <li className="flex w-12 shrink-0 snap-start" aria-label={column.name}>
        <div ref={setNodeRef} id={bodyId} className={cn("flex w-full flex-col items-center rounded-xl border border-line bg-surface transition-colors duration-[var(--sw-dur-fast)]", isOver && "bg-accent-soft")}>
          <CollapseToggle open={false} onToggle={() => setOpen(true)} controls={bodyId} label={`Expand ${column.name}`} className="w-full flex-col justify-start px-1 py-3 text-label font-semibold text-ink">
            <span className="text-caption tabular-nums text-ink-muted">
              {countLabel}
              <span className="sr-only"> tasks</span>
            </span>
            <span aria-hidden className={cn("size-2 shrink-0 rounded-full", TONE_DOT[column.category])} />
            <span className="max-h-48 truncate [writing-mode:vertical-rl]">{column.name}</span>
          </CollapseToggle>
        </div>
      </li>
    );
  }
  return (
    <li className="flex w-[min(85vw,300px)] shrink-0 snap-start flex-col rounded-xl border border-line bg-surface" aria-label={column.name}>
      <div className="flex items-center gap-1 border-b border-line py-1.5 pl-1 pr-1.5">
        <CollapseToggle open onToggle={() => setOpen(false)} controls={bodyId} label={`Collapse ${column.name}`} className="size-9 min-h-9 shrink-0 justify-center text-ink-muted" />
        <h2 className="flex min-w-0 flex-1 items-center gap-2 text-label font-semibold text-ink">
          <span aria-hidden className={cn("size-2 shrink-0 rounded-full", TONE_DOT[column.category])} />
          <span className="truncate">{column.name}</span>
        </h2>
        <span className="text-caption tabular-nums text-ink-muted">
          {countLabel}
          <span className="sr-only"> tasks</span>
        </span>
        {manage ? <ColumnMenu slug={manage.slug} projectId={manage.projectId} projectKey={manage.projectKey} column={column} columns={manage.columns} taskCount={total} run={manage.run} /> : <span className="size-9" aria-hidden />}
      </div>
      <div ref={setNodeRef} id={bodyId} className={cn("flex min-h-24 flex-col gap-2 p-2 transition-colors duration-[var(--sw-dur-fast)]", isOver && "bg-accent-soft")}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {tasks.map((task, index) => (
            <SortableCard
              key={task.id}
              {...card}
              task={task}
              columnId={column.id}
              canEdit={canEdit && task.canEdit}
              canClaim={canEdit && task.canClaim}
              locked={canEdit && !task.canEdit}
              onClaim={onClaim}
              position={{ index, count: tasks.length }}
            />
          ))}
        </SortableContext>
        {tasks.length === 0 ? <p className="px-1.5 py-3 text-caption text-ink-muted">{filtered && total ? "No matching tasks here." : "Nothing here yet."}</p> : null}
        {canEdit ? <QuickAdd open={quickAddOpen} onOpenChange={onQuickAddOpenChange} onCreate={onCreate} /> : null}
      </div>
    </li>
  );
}
