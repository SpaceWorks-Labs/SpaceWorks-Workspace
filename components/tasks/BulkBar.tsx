"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { MAX_BULK, type BulkOp } from "@/lib/tasks/bulkSchemas";
import { PRIORITIES, PRIORITY_LABELS } from "@/lib/tasks/filters";
import type { BoardData, BoardTask } from "@/lib/tasks/types";
import { assigneeItems } from "./ListCells";
import { MultiSelect } from "./MultiSelect";
import type { BulkFailure } from "./useBulkActions";

/**
 * Sticky bar shown while rows are selected: move, priority, add/remove
 * assignee, assign to me and a two-step archive. Which rows actually change
 * is decided per task on the server; refused ones are listed afterwards.
 */
export function BulkBar({
  data,
  selectedTasks,
  viewerId,
  notice,
  busy,
  failures,
  onRun,
  onClear,
  onDismissFailures,
}: {
  data: BoardData;
  selectedTasks: BoardTask[];
  viewerId?: string;
  notice: string | null;
  busy: boolean;
  failures: BulkFailure[];
  onRun: (ops: BulkOp[]) => void;
  onClear: () => void;
  onDismissFailures: () => void;
}) {
  const count = selectedTasks.length;
  // Confirmation is tied to the selected ids, so changing the selection cancels it.
  const selectionKey = selectedTasks.map((task) => task.id).sort().join(",");
  const [confirmFor, setConfirmFor] = useState<string | null>(null);
  const confirming = confirmFor === selectionKey;
  const setConfirming = (on: boolean) => setConfirmFor(on ? selectionKey : null);
  const items = useMemo(() => assigneeItems(data.members, viewerId), [data.members, viewerId]);
  const assignedItems = useMemo(() => {
    const ids = new Set(selectedTasks.flatMap((task) => task.assigneeIds));
    return items.filter((item) => ids.has(item.id));
  }, [items, selectedTasks]);
  const trigger = (label: string) => (
    <Button variant="secondary" size="sm" disabled={busy}>
      {label}
    </Button>
  );

  return (
    <div className="sticky bottom-4 z-20 flex flex-col gap-2">
      {failures.length > 0 ? (
        <div role="status" className="rounded-xl border border-danger-fg bg-panel p-3 text-body-ui text-ink">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold">{failures.length} {failures.length === 1 ? "task" : "tasks"} couldn&apos;t be updated</p>
            <Button variant="quiet" size="sm" onClick={onDismissFailures}>
              Dismiss
            </Button>
          </div>
          <ul className="mt-1 max-h-40 list-disc overflow-y-auto pl-5 text-ink-secondary">
            {failures.map((failure) => (
              <li key={`${failure.ref}-${failure.error}`}>
                <span className="font-semibold tabular-nums">{failure.ref}</span>: {failure.error}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {count > 0 ? (
        <div role="toolbar" aria-label="Bulk actions" className="flex flex-wrap items-center gap-2 rounded-xl border border-line-strong bg-panel px-3 py-2 shadow-float">
          <p className="mr-1 text-label font-semibold text-ink tabular-nums" aria-live="polite">
            {count} selected
            {notice ? <span className="ml-2 text-caption font-normal text-ink-muted">{notice} Max {MAX_BULK}.</span> : null}
          </p>
          <Menu>
            <MenuTrigger asChild disabled={busy}>
              {trigger("Move to column")}
            </MenuTrigger>
            <MenuContent align="start">
              {data.columns.map((column) => (
                <MenuItem key={column.id} onSelect={() => onRun([{ kind: "move", columnId: column.id }])}>
                  {column.name}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
          <Menu>
            <MenuTrigger asChild disabled={busy}>
              {trigger("Priority")}
            </MenuTrigger>
            <MenuContent align="start">
              {PRIORITIES.map((priority) => (
                <MenuItem key={priority} onSelect={() => onRun([{ kind: "priority", priority }])}>
                  {PRIORITY_LABELS[priority]}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
          <MultiSelect title="Add assignee" commitOnClose trigger={trigger("Add assignee")} items={items} selected={[]} onChange={(ids) => onRun(ids.map((userId) => ({ kind: "assign", userId })))} searchPlaceholder="Find a member" />
          <MultiSelect title="Remove assignee" commitOnClose trigger={trigger("Remove assignee")} items={assignedItems} selected={[]} onChange={(ids) => onRun(ids.map((userId) => ({ kind: "unassign", userId })))} emptyText="None of the selected tasks has an assignee." />
          {viewerId ? (
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => onRun([{ kind: "claim" }])}>
              Assign to me
            </Button>
          ) : null}
          {confirming ? (
            <>
              <Button variant="dangerSolid" size="sm" disabled={busy} onClick={() => { setConfirming(false); onRun([{ kind: "archive" }]); }}>
                Archive {count} {count === 1 ? "task" : "tasks"}
              </Button>
              <Button variant="quiet" size="sm" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="dangerOutline" size="sm" disabled={busy} onClick={() => setConfirming(true)}>
              Archive
            </Button>
          )}
          <Button variant="quiet" size="sm" className="ml-auto" onClick={onClear}>
            Clear
          </Button>
        </div>
      ) : null}
    </div>
  );
}
