"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { ComponentProps } from "react";
import { CollapseToggle, usePersistentOpen } from "@/components/ui/collapsible-section";
import { cn } from "@/lib/cn";
import { columnDropId } from "@/lib/tasks/boardMoves";
import { wipState } from "@/lib/tasks/wip";
import type { BoardTask, ColumnDTO } from "@/lib/tasks/types";
import { columnDot } from "../columnTone";
import { ColumnMenu } from "../ColumnControls";
import { QuickAdd } from "../BoardQuickAdd";
import type { RunAction } from "../useTaskRunner";
import { SortableCard } from "./SortableCard";

type CardShared = Omit<ComponentProps<typeof SortableCard>, "task" | "columnId" | "canEdit" | "canClaim" | "locked" | "position" | "onClaim">;

/** One board column: tone dot, name, count, its sortable cards and quick add. */
export function BoardColumn({
  column,
  collapseId,
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
  /** Key of this column's remembered collapse state (the column id, scoped by lane in swimlanes). */
  collapseId: string;
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
  const [storedOpen, setOpen] = usePersistentOpen("sw:collapse:board", collapseId, true);
  // Quick add (the `c` shortcut) needs the column open.
  const open = storedOpen || quickAddOpen;
  const bodyId = `board-column-${column.id}-body`;
  const wip = wipState(total, column.wipLimit);
  const countLabel = wip.limit ? wip.label : filtered ? `${tasks.length}/${total}` : total;
  const dot = columnDot(column);
  const count = (
    <span className={cn("text-caption tabular-nums", wip.over ? "font-semibold text-warning-fg" : "text-ink-muted")} title={wip.limit && filtered ? `Showing ${tasks.length} of ${total}` : undefined}>
      {countLabel}
      <span className="sr-only"> tasks{filtered && wip.limit ? `, ${tasks.length} shown` : ""}. {wip.hint}</span>
    </span>
  );
  if (!open) {
    // A narrow strip that is still the column's drop target: a dropped card goes to the end.
    return (
      <li className="flex w-12 shrink-0 snap-start" aria-label={column.name}>
        <div ref={setNodeRef} id={bodyId} className={cn("flex w-full flex-col items-center rounded-xl border border-line bg-surface transition-colors duration-[var(--sw-dur-fast)]", isOver && "bg-accent-soft")}>
          <CollapseToggle open={false} onToggle={() => setOpen(true)} controls={bodyId} label={`Expand ${column.name}`} className="w-full flex-col justify-start px-1 py-3 text-label font-semibold text-ink">
            {count}
            <span aria-hidden className={cn("size-2 shrink-0 rounded-full", dot)} />
            <span className="max-h-48 truncate [writing-mode:vertical-rl]">{column.name}</span>
          </CollapseToggle>
        </div>
      </li>
    );
  }
  return (
    <li className="flex w-[min(85vw,300px)] shrink-0 snap-start flex-col rounded-xl border border-line bg-surface" aria-label={column.name}>
      <div className={cn("flex items-center gap-1 rounded-t-xl border-b border-line py-1.5 pl-1 pr-1.5", wip.over && "bg-warning-bg")}>
        <CollapseToggle open onToggle={() => setOpen(false)} controls={bodyId} label={`Collapse ${column.name}`} className="size-9 min-h-9 shrink-0 justify-center text-ink-muted" />
        <h2 className="flex min-w-0 flex-1 items-center gap-2 text-label font-semibold text-ink">
          <span aria-hidden className={cn("size-2 shrink-0 rounded-full", dot)} />
          <span className="truncate">{column.name}</span>
        </h2>
        {count}
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
