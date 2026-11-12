"use client";

import { DndContext, DragOverlay } from "@dnd-kit/core";
import { useMemo, useState } from "react";
import { BOARD_INSTRUCTIONS, buildLayout } from "@/lib/tasks/boardMoves";
import type { BoardData, BoardTask } from "@/lib/tasks/types";
import { AddColumn } from "../ColumnControls";
import { TaskCard, type CardMove } from "../TaskCard";
import type { RunAction } from "../useTaskRunner";
import { BoardColumn } from "./BoardColumn";
import { boardCollision, useBoardDnd } from "./useBoardDnd";

/** A Design System duration token in ms (the drop animation runs in JS, not CSS). */
const tokenMs = (name: string) => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;

export type LaneProps = {
  slug: string;
  data: BoardData;
  /** The tasks this lane shows (all visible tasks when the board has no swimlanes). */
  tasks: BoardTask[];
  /** Empty for a board without swimlanes; scopes ids, collapse state and quick add per lane. */
  laneKey: string;
  filtered: boolean;
  compact: boolean;
  /** Column management (rename, add) is offered in the first lane only. */
  manageColumns: boolean;
  timeZone: string;
  run: RunAction;
  quickAdd: string | null;
  onQuickAdd: (value: string | null) => void;
  onOpen: (number: number) => void;
  onMove: (task: BoardTask, move: CardMove) => void;
  onCommit: (task: BoardTask, columnId: string, afterTaskId: string | null, movedColumn: boolean) => void;
  onClaim: (task: BoardTask) => void;
  onCreate: (columnId: string, title: string, options: { openAfter: boolean }) => Promise<boolean>;
  onActiveChange: (active: boolean) => void;
};

/**
 * One row of columns with its own drag and drop (pointer, touch, keyboard).
 * Without swimlanes the board is a single lane. With them each lane has its
 * own drag context, so a drop only ever changes the column, never the lane.
 */
export function BoardLane({ slug, data, tasks, laneKey, filtered, compact, manageColumns, timeZone, run, quickAdd, onQuickAdd, onOpen, onMove, onCommit, onClaim, onCreate, onActiveChange }: LaneProps) {
  const key = data.project.key;
  const baseLayout = useMemo(() => buildLayout(data.columns, tasks), [data.columns, tasks]);
  const dnd = useBoardDnd({ baseLayout, tasks: data.tasks, columns: data.columns, projectKey: key, onCommit, onActiveChange });
  const tasksById = useMemo(() => new Map(data.tasks.map((task) => [task.id, task])), [data.tasks]);
  const canEdit = data.permissions.canEdit;
  const manage = manageColumns && data.permissions.canManage && data.project.status !== "ARCHIVED" ? { slug, projectId: data.project.id, projectKey: key, columns: data.columns, run } : null;
  const [reduceMotion] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const scope = (columnId: string) => (laneKey ? `${laneKey}:${columnId}` : columnId);

  return (
    <DndContext
      id={`board-dnd${laneKey ? `-${laneKey}` : ""}`}
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
            collapseId={scope(column.id)}
            ids={dnd.layout[column.id] ?? []}
            tasksById={tasksById}
            total={data.tasks.filter((task) => task.columnId === column.id).length}
            filtered={filtered}
            canEdit={canEdit}
            manage={manage}
            card={{ projectKey: key, columns: data.columns, members: data.members, labels: data.labels, taskTypes: data.taskTypes, timeZone, compact, onOpen, onMove }}
            onClaim={onClaim}
            quickAddOpen={quickAdd === scope(column.id)}
            onQuickAddOpenChange={(open) => onQuickAdd(open ? scope(column.id) : null)}
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
            compact={compact}
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
  );
}
