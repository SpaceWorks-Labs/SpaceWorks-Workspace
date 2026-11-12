"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import { CollapsibleSection, useOpenState } from "@/components/ui/collapsible-section";
import { groupTasks, type GroupKey } from "@/lib/tasks/filters";
import type { BoardTask } from "@/lib/tasks/types";
import { useNow } from "../useNow";
import { BoardLane, type LaneProps } from "./BoardLane";
import { lanesFor } from "./lanes";

const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * The kanban columns with accessible drag and drop (pointer, touch and
 * keyboard). `c` opens quick add in the first column while focus is on the
 * board. Grouping by assignee or priority splits the board into swimlanes,
 * each a row of the same columns.
 */
export function BoardView({
  slug,
  data,
  visible,
  group,
  filtered,
  compact,
  timeZone,
  run,
  onOpen,
  onMove,
  onCommit,
  onClaim,
  onCreate,
  onActiveChange,
}: Omit<LaneProps, "tasks" | "laneKey" | "manageColumns" | "quickAdd" | "onQuickAdd"> & { visible: BoardTask[]; group: GroupKey }) {
  const [quickAdd, setQuickAdd] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const now = useNow();
  const laneBy = lanesFor(group);
  const lanes = useMemo(
    () => (laneBy ? groupTasks(visible, laneBy, { columns: data.columns, members: data.members, labels: data.labels, now, timeZone }) : null),
    [laneBy, visible, data.columns, data.members, data.labels, now, timeZone],
  );
  const collapse = useOpenState("sw:collapse:swimlanes");
  const canEdit = data.permissions.canEdit;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "c" || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || isTyping(event.target) || !canEdit) return;
    const first = data.columns[0];
    if (!first) return;
    // Ignore keys from portalled menus/dialogs and while a card is being dragged.
    if (!event.currentTarget.contains(event.target as Node) || document.querySelector('[role="menu"], [role="dialog"], [role="alertdialog"], [role="listbox"]')) return;
    if (dragging) return;
    event.preventDefault();
    setQuickAdd(`${lanes?.[0] ? `${laneBy}:${lanes[0].key}:` : ""}${first.id}`);
  };

  const shared = {
    slug,
    data,
    filtered: filtered || Boolean(lanes),
    compact,
    timeZone,
    run,
    quickAdd,
    onQuickAdd: setQuickAdd,
    onOpen,
    onMove,
    onCommit,
    onClaim,
    onCreate,
    onActiveChange: (active: boolean) => {
      setDragging(active);
      onActiveChange(active);
    },
  };

  return (
    <div className="relative -mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 [scrollbar-width:thin]" role="region" aria-label={`${data.project.name} board`} tabIndex={0} onKeyDown={onKeyDown}>
      {lanes ? (
        <div className="flex flex-col gap-6">
          {lanes.map((lane, index) => {
            const laneKey = `${laneBy}:${lane.key}`;
            const id = `${data.project.id}:${laneKey}`;
            return (
              <section key={lane.key} aria-label={`${lane.label} lane`}>
                <CollapsibleSection
                  id={`lane-${lane.key}`}
                  heading="h3"
                  open={collapse.isOpen(id, true)}
                  onOpenChange={(open) => collapse.setOpen(id, open)}
                  title={lane.label}
                  count={lane.tasks.length}
                  className="flex flex-col gap-3"
                  toggleClassName="text-title text-ink"
                  bodyClassName="flex flex-col gap-3"
                >
                  <BoardLane {...shared} tasks={lane.tasks} laneKey={laneKey} manageColumns={index === 0} />
                </CollapsibleSection>
              </section>
            );
          })}
        </div>
      ) : (
        <BoardLane {...shared} tasks={visible} laneKey="" manageColumns />
      )}
    </div>
  );
}
