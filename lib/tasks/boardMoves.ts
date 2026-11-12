import { placeAt } from "@/lib/tasks/position";
import type { BoardTask, ColumnDTO } from "@/lib/tasks/types";

/**
 * Pure move logic for the board (client-safe, unit-tested): the per-column
 * id layout used while dragging, where a drop lands, the optimistic update
 * and the screen-reader announcements.
 */

/** Column id -> ordered task ids. */
export type ColumnLayout = Record<string, string[]>;
export type RelativeMove = "up" | "down" | "top" | "bottom";

const COLUMN_PREFIX = "col:";
export const columnDropId = (columnId: string) => `${COLUMN_PREFIX}${columnId}`;
export const isColumnDropId = (id: string | number) => String(id).startsWith(COLUMN_PREFIX);
export const columnIdFromDrop = (id: string | number) => String(id).slice(COLUMN_PREFIX.length);

export const byPosition = (a: Pick<BoardTask, "position" | "number">, b: Pick<BoardTask, "position" | "number">) => a.position - b.position || a.number - b.number;

export function buildLayout(columns: readonly ColumnDTO[], tasks: readonly BoardTask[]): ColumnLayout {
  const layout: ColumnLayout = {};
  for (const column of columns) layout[column.id] = tasks.filter((task) => task.columnId === column.id).sort(byPosition).map((task) => task.id);
  return layout;
}

/** The column holding `id`, or the column a column-drop id stands for. */
export function findContainer(layout: ColumnLayout, id: string | number): string | null {
  if (isColumnDropId(id)) return columnIdFromDrop(id) in layout ? columnIdFromDrop(id) : null;
  return Object.keys(layout).find((columnId) => layout[columnId]!.includes(String(id))) ?? null;
}

/** While dragging over another column: take the card out of its column and put it where the pointer is (`below` = after the hovered card). */
export function moveAcross(layout: ColumnLayout, activeId: string, overId: string, below: boolean): ColumnLayout {
  const from = findContainer(layout, activeId);
  const to = findContainer(layout, overId);
  if (!from || !to || from === to) return layout;
  const target = layout[to]!;
  const overIndex = isColumnDropId(overId) ? -1 : target.indexOf(overId);
  const index = overIndex === -1 ? target.length : overIndex + (below ? 1 : 0);
  return { ...layout, [from]: layout[from]!.filter((id) => id !== activeId), [to]: [...target.slice(0, index), activeId, ...target.slice(index)] };
}

/** On drop: reorder inside the column the card is in now. Returns where the card ended up. */
export function settleDrop(layout: ColumnLayout, activeId: string, overId: string | null): { layout: ColumnLayout; columnId: string; afterTaskId: string | null } | null {
  const columnId = findContainer(layout, activeId);
  if (!columnId) return null;
  let list = layout[columnId]!;
  const overContainer = overId ? findContainer(layout, overId) : null;
  if (overId && overContainer === columnId && !isColumnDropId(overId) && overId !== activeId) {
    const from = list.indexOf(activeId);
    const to = list.indexOf(overId);
    const next = list.filter((id) => id !== activeId);
    next.splice(to, 0, activeId);
    list = from === to ? list : next;
  }
  const at = list.indexOf(activeId);
  return { layout: { ...layout, [columnId]: list }, columnId, afterTaskId: at > 0 ? list[at - 1]! : null };
}

/** Task to place the card after for a Move menu choice within its column (null = top). */
export function relativeAfterId(list: readonly string[], id: string, move: RelativeMove): string | null {
  const index = list.indexOf(id);
  const others = list.filter((item) => item !== id);
  if (move === "up") return index >= 2 ? list[index - 2]! : null;
  if (move === "down") return list[index + 1] ?? others[others.length - 1] ?? null;
  if (move === "top") return null;
  return others[others.length - 1] ?? null;
}

/** Show a move at once: new column, a position between the new neighbours, `completedAt` synced with a Done column. */
export function applyOptimisticMove(tasks: readonly BoardTask[], columns: readonly ColumnDTO[], taskId: string, columnId: string, afterTaskId: string | null, now = new Date()): BoardTask[] {
  const task = tasks.find((item) => item.id === taskId);
  if (!task) return [...tasks];
  const siblings = tasks.filter((item) => item.columnId === columnId && item.id !== taskId).sort(byPosition);
  const anchor = afterTaskId === null ? -1 : siblings.findIndex((item) => item.id === afterTaskId);
  const index = afterTaskId === null ? 0 : anchor === -1 ? siblings.length : anchor + 1;
  const { position } = placeAt(siblings.map((item) => item.position), index);
  const done = columns.find((column) => column.id === columnId)?.category === "DONE";
  const completedAt = done ? (task.completedAt ?? now.toISOString()) : null;
  return tasks.map((item) => (item.id === taskId ? { ...item, columnId, position, completedAt } : item));
}

/* ---------- Screen-reader text ---------- */

export const BOARD_INSTRUCTIONS =
  "To pick up a task, press Space. Use the arrow keys to move it between columns and positions, Space to drop it and Escape to cancel. Press Enter to open the task.";

export const announce = {
  pickedUp: (reference: string, title: string) => `Picked up ${reference} ${title}.`,
  over: (reference: string, columnName: string, position: number, count: number) => `${reference} moved to ${columnName}, position ${position} of ${count}.`,
  dropped: (reference: string, columnName: string) => `Dropped ${reference} in ${columnName}.`,
  cancelled: () => "Move cancelled.",
};

/** 1-based position of a card in a column and the column's size once it is there. */
export function positionIn(layout: ColumnLayout, columnId: string, id: string): { position: number; count: number } {
  const list = layout[columnId] ?? [];
  const index = list.indexOf(id);
  return { position: index === -1 ? list.length + 1 : index + 1, count: index === -1 ? list.length + 1 : list.length };
}
