"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { announce, columnDropId, findContainer, isColumnDropId, moveAcross, settleDrop, type ColumnLayout } from "@/lib/tasks/boardMoves";
import { taskReference } from "@/lib/tasks/links";
import type { BoardTask, ColumnDTO } from "@/lib/tasks/types";

/** Pointer first (so empty columns accept drops), corners for the keyboard. Cards win over the column behind them. */
export const boardCollision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  if (hits.length > 0) {
    const cards = hits.filter((hit) => !isColumnDropId(hit.id));
    return cards.length > 0 ? cards : hits;
  }
  return closestCorners(args);
};

/**
 * Drag state for the board. While a card is held, a copy of the column
 * layout follows it across columns; on drop the final place is sent to
 * `onCommit` (the optimistic update and the server call live in the caller).
 */
export function useBoardDnd({
  baseLayout,
  tasks,
  columns,
  projectKey,
  onCommit,
  onActiveChange,
}: {
  baseLayout: ColumnLayout;
  tasks: BoardTask[];
  columns: ColumnDTO[];
  projectKey: string;
  onCommit: (task: BoardTask, columnId: string, afterTaskId: string | null, movedColumn: boolean) => void;
  onActiveChange: (active: boolean) => void;
}) {
  const [layout, setLayout] = useState<ColumnLayout | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const live = useRef<ColumnLayout | null>(null);
  /** Left/Right jump to the neighbouring column (sortable's own getter can't cross containers); Up/Down stay sortable. */
  const coordinateGetter: KeyboardCoordinateGetter = useCallback(
    (event, args) => {
      if (event.code !== "ArrowLeft" && event.code !== "ArrowRight") return sortableKeyboardCoordinates(event, args);
      event.preventDefault();
      const from = live.current ? findContainer(live.current, args.active) : null;
      const index = from ? columns.findIndex((column) => column.id === from) : -1;
      const target = index < 0 ? undefined : columns[index + (event.code === "ArrowRight" ? 1 : -1)];
      const rect = target ? args.context.droppableRects.get(columnDropId(target.id)) : undefined;
      return rect ? { x: rect.left + 8, y: rect.top + 8 } : args.currentCoordinates;
    },
    [columns],
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter, keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] } }),
  );
  const start = useRef<ColumnLayout | null>(null);
  /** Survives the reset on drop so the "Dropped" announcement can name the final column. */
  const last = useRef<ColumnLayout | null>(null);

  const taskOf = useCallback((id: string | number) => tasks.find((task) => task.id === id) ?? null, [tasks]);
  const columnName = useCallback((id: string | null) => columns.find((column) => column.id === id)?.name ?? "the column", [columns]);
  const label = useCallback((id: string | number) => {
    const task = taskOf(id);
    return task ? taskReference(projectKey, task.number) : "task";
  }, [taskOf, projectKey]);

  const reset = useCallback(() => {
    live.current = null;
    start.current = null;
    setLayout(null);
    setActiveId(null);
    onActiveChange(false);
  }, [onActiveChange]);

  const onDragStart = useCallback(
    (event: DragStartEvent) => {
      start.current = baseLayout;
      live.current = baseLayout;
      last.current = baseLayout;
      setLayout(baseLayout);
      setActiveId(String(event.active.id));
      onActiveChange(true);
    },
    [baseLayout, onActiveChange],
  );

  const onDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    const current = live.current;
    if (!over || !current) return;
    const from = findContainer(current, active.id);
    const to = findContainer(current, over.id);
    if (!from || !to || from === to) return;
    const translated = active.rect.current.translated;
    const below = Boolean(translated && translated.top > over.rect.top + over.rect.height / 2);
    const next = moveAcross(current, String(active.id), String(over.id), below);
    live.current = next;
    last.current = next;
    setLayout(next);
  }, []);

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      const current = live.current;
      const origin = start.current;
      reset();
      const task = taskOf(active.id);
      if (!over || !current || !origin || !task) return;
      const settled = settleDrop(current, String(active.id), String(over.id));
      if (!settled) return;
      const was = findContainer(origin, task.id);
      const originList = was ? origin[was]! : [];
      const originIndex = originList.indexOf(task.id);
      const originAfter = originIndex > 0 ? originList[originIndex - 1]! : null;
      if (was === settled.columnId && originAfter === settled.afterTaskId) return;
      onCommit(task, settled.columnId, settled.afterTaskId, was !== settled.columnId);
    },
    [onCommit, reset, taskOf],
  );

  const announcements: Announcements = useMemo(
    () => ({
      onDragStart: ({ active }) => announce.pickedUp(label(active.id), taskOf(active.id)?.title ?? ""),
      onDragOver: ({ active, over }) => {
        const current = last.current;
        if (!over || !current) return undefined;
        const columnId = findContainer(current, over.id);
        if (!columnId) return undefined;
        const list = current[columnId]!;
        const hasActive = list.includes(String(active.id));
        const overIndex = isColumnDropId(over.id) ? list.length : list.indexOf(String(over.id));
        const position = Math.min(overIndex + 1, list.length + (hasActive ? 0 : 1));
        return announce.over(label(active.id), columnName(columnId), position, list.length + (hasActive ? 0 : 1));
      },
      onDragEnd: ({ active, over }) => {
        const current = last.current ?? baseLayout;
        const columnId = over ? findContainer(current, over.id) : null;
        return columnId ? announce.dropped(label(active.id), columnName(columnId)) : announce.cancelled();
      },
      onDragCancel: () => announce.cancelled(),
    }),
    [baseLayout, columnName, label, taskOf],
  );

  return { sensors, layout: layout ?? baseLayout, dragging: layout !== null, activeTask: activeId ? taskOf(activeId) : null, handlers: { onDragStart, onDragOver, onDragEnd, onDragCancel: reset }, announcements };
}
