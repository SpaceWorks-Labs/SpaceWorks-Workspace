"use client";

import { DndContext, DragOverlay } from "@dnd-kit/core";
import { useMemo, useState, type KeyboardEvent } from "react";
import { BOARD_INSTRUCTIONS, buildLayout } from "@/lib/tasks/boardMoves";
import type { BoardData, BoardTask } from "@/lib/tasks/types";
import { AddColumn } from "../ColumnControls";
import { TaskCard, type CardMove } from "../TaskCard";
import type { RunAction } from "../useTaskRunner";
import { BoardColumn } from "./BoardColumn";
import { boardCollision, useBoardDnd } from "./useBoardDnd";

/** A Design-Kit duration token in ms (the drop animation runs in JS, not CSS). */
const tokenMs = (name: string) => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * The kanban columns with accessible drag and drop (pointer, touch and
 * keyboard). `c` opens quick add in the first column while focus is on the board.
 */
export function BoardView({
  slug,
  data,
  visible,
  filtered,
  timeZone,
  run,
  onOpen,
  onMove,
  onCommit,
  onClaim,
  onCreate,
  onActiveChange,
}: {
  slug: string;
  data: BoardData;
  visible: BoardTask[];
  filtered: boolean;
  timeZone: string;
  run: RunAction;
  onOpen: (number: number) => void;
  onMove: (task: BoardTask, move: CardMove) => void;
  onCommit: (task: BoardTask, columnId: string, afterTaskId: string | null, movedColumn: boolean) => void;
  onClaim: (task: BoardTask) => void;
  onCreate: (columnId: string, title: string, options: { openAfter: boolean }) => Promise<boolean>;
  onActiveChange: (active: boolean) => void;
}) {
  const key = data.project.key;
  const baseLayout = useMemo(() => buildLayout(data.columns, visible), [data.columns, visible]);
  const dnd = useBoardDnd({ baseLayout, tasks: data.tasks, columns: data.columns, projectKey: key, onCommit, onActiveChange });
  const tasksById = useMemo(() => new Map(data.tasks.map((task) => [task.id, task])), [data.tasks]);
  const [quickAdd, setQuickAdd] = useState<string | null>(null);
  const canEdit = data.permissions.canEdit;
  const manage = data.permissions.canManage && data.project.status !== "ARCHIVED" ? { slug, projectId: data.project.id, projectKey: key, columns: data.columns, run } : null;
  const [reduceMotion] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "c" || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || isTyping(event.target) || !canEdit) return;
    const first = data.columns[0];
    if (!first) return;
    // Ignore keys from portalled menus/dialogs and while a card is being dragged.
    if (!event.currentTarget.contains(event.target as Node) || document.querySelector('[role="menu"], [role="dialog"], [role="alertdialog"], [role="listbox"]')) return;
    if (dnd.dragging) return;
    event.preventDefault();
    setQuickAdd(first.id);
  };

  return (
    <div className="relative -mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 [scrollbar-width:thin]" role="region" aria-label={`${data.project.name} board`} tabIndex={0} onKeyDown={onKeyDown}>
      <DndContext
        id="board-dnd"
        sensors={dnd.sensors}
        collisionDetection={boardCollision}
        accessibility={{ announcements: dnd.announcements, screenReaderInstructions: { draggable: BOARD_INSTRUCTIONS } }}
        {...dnd.handlers}
      >
        <ol className="flex snap-x snap-mandatory items-start gap-4 sm:snap-none">
          {data.columns.map((column) => (
            <BoardColumn
              key={column.id}
              column={column}
              ids={dnd.layout[column.id] ?? []}
              tasksById={tasksById}
              total={data.tasks.filter((task) => task.columnId === column.id).length}
              filtered={filtered}
              canEdit={canEdit}
              manage={manage}
              card={{ projectKey: key, columns: data.columns, members: data.members, labels: data.labels, taskTypes: data.taskTypes, timeZone, onOpen, onMove }}
              onClaim={onClaim}
              quickAddOpen={quickAdd === column.id}
              onQuickAddOpenChange={(open) => setQuickAdd(open ? column.id : null)}
              onCreate={(title, options) => onCreate(column.id, title, options)}
            />
          ))}
          {manage ? (
            <li className="w-[min(85vw,300px)] shrink-0 snap-start">
              <AddColumn slug={slug} projectId={data.project.id} projectKey={key} run={run} />
            </li>
          ) : null}
        </ol>
        <DragOverlay dropAnimation={reduceMotion ? null : { duration: tokenMs("--sw-dur-base"), easing: "cubic-bezier(0.2, 0, 0, 1)" }}>
          {dnd.activeTask ? (
            <TaskCard
              overlay
              task={dnd.activeTask}
              projectKey={key}
              columns={data.columns}
              members={data.members}
              labels={data.labels}
              taskTypes={data.taskTypes}
              timeZone={timeZone}
              canEdit
              canClaim={false}
              onClaim={onClaim}
              position={{ index: 0, count: 1 }}
              onOpen={onOpen}
              onMove={onMove}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

