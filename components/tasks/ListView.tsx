"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import { Checkbox } from "@/components/ui/choice";
import { CollapsibleSection, useOpenState } from "@/components/ui/collapsible-section";
import { EmptyState } from "@/components/ui/display";
import { Table, TBody, TH, THead } from "@/components/ui/table";
import { groupTasks, sortTasks, type GroupKey, type SortKey } from "@/lib/tasks/filters";
import { taskReference } from "@/lib/tasks/links";
import { triState } from "@/lib/tasks/selection";
import type { BoardData, BoardTask } from "@/lib/tasks/types";
import { BulkBar } from "./BulkBar";
import { assigneeItems } from "./ListCells";
import { isSelectable, ListRow, type RowContext } from "./ListRow";
import { useBulkActions } from "./useBulkActions";
import { useListEdits } from "./useListEdits";
import { useNow } from "./useNow";
import { useListSelection } from "./useListSelection";

/**
 * Sortable, groupable table of the board's tasks. Status, priority,
 * assignees and due date edit in place (optimistic, rolled back on a refusal);
 * the checkbox column selects up to 50 rows for bulk edits.
 *
 * `slug`, `viewerId` and `onChanged` come from the board: without a slug the
 * route's own is used, without a viewer the "Me" shortcuts are hidden, and
 * without `onChanged` fresh data arrives through the board's realtime refetch.
 */
export function ListView({
  data,
  tasks: incoming,
  sort,
  group,
  timeZone,
  slug: slugProp,
  viewerId,
  onChanged,
  onOpen,
  onComplete,
}: {
  data: BoardData;
  tasks: BoardTask[];
  sort: SortKey;
  group: GroupKey;
  timeZone: string;
  slug?: string;
  viewerId?: string;
  onChanged?: () => void | Promise<void>;
  onOpen: (number: number) => void;
  onComplete: (task: BoardTask, completed: boolean) => void;
}) {
  const params = useParams<{ workspaceSlug?: string }>();
  const slug = slugProp ?? params.workspaceSlug ?? "";
  const now = useNow();
  const edits = useListEdits({ slug, viewerId, data, tasks: incoming, timeZone, onChanged });
  const tasks = edits.tasks;
  const groups = useMemo(
    () => groupTasks(sortTasks(tasks, sort), group, { columns: data.columns, members: data.members, labels: data.labels, now, timeZone }),
    [tasks, sort, group, data.columns, data.members, data.labels, now, timeZone],
  );
  const collapse = useOpenState("sw:collapse:list");
  const groupId = (key: string) => `${data.project.id}:${group}:${key}`;
  const grouped = group !== "none";
  const isGroupOpen = (key: string) => !grouped || collapse.isOpen(groupId(key), true);
  // Rows in a collapsed group are not selectable.
  const ordered = useMemo(
    () => [...new Set(groups.filter((section) => !grouped || collapse.isOpen(groupId(section.key), true)).flatMap((section) => section.tasks.filter((task) => isSelectable(data, task)).map((task) => task.id)))],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, data, grouped, collapse.isOpen, group],
  );
  const selection = useListSelection(ordered);
  const selectedTasks = useMemo(() => tasks.filter((task) => selection.selected.has(task.id)), [tasks, selection.selected]);
  const bulk = useBulkActions({ slug, data, selected: selection.selected, viewerId, patchMany: edits.patchMany, hide: edits.hide, deselect: selection.deselect, onChanged });
  const items = useMemo(() => assigneeItems(data.members, viewerId), [data.members, viewerId]);

  if (tasks.length === 0) return <EmptyState title="No tasks match.">Try clearing a filter.</EmptyState>;
  const claim = edits.claim;
  const ctx: RowContext = {
    data,
    timeZone,
    now,
    assignees: items,
    onOpen,
    onComplete,
    change: (task, patch) => void edits.change(task, patch),
    claim: claim ? (task) => void claim({ id: task.id, reference: taskReference(data.project.key, task.number), assigneeIds: task.assigneeIds }, "claim") : null,
  };

  return (
    <div className="flex flex-col gap-6">
      {groups.map((section) => {
        const selectable = section.tasks.filter((task) => isSelectable(data, task)).map((task) => task.id);
        const content =
          section.tasks.length === 0 ? (
            <p className="text-body-ui text-ink-muted">Nothing here.</p>
          ) : (
            <Table label={`${section.label} tasks`}>
              <THead>
                <tr>
                  <TH className="w-12">
                    {selectable.length > 0 ? (
                      <Checkbox
                        checked={triState(selection.selected, selectable)}
                        aria-label={`Select all ${section.label} tasks`}
                        onCheckedChange={() => selection.toggleSection(selectable)}
                      />
                    ) : (
                      <span className="sr-only">Select</span>
                    )}
                  </TH>
                  <TH className="w-12">
                    <span className="sr-only">Done</span>
                  </TH>
                  <TH>Task</TH>
                  <TH>Status</TH>
                  <TH>Priority</TH>
                  <TH>Assignees</TH>
                  <TH>Due</TH>
                </tr>
              </THead>
              <TBody>
                {section.tasks.map((task) => (
                  <ListRow key={`${section.key}-${task.id}`} task={task} ctx={ctx} selected={selection.selected.has(task.id)} onSelect={(shift) => selection.toggle(task.id, shift)} />
                ))}
              </TBody>
            </Table>
          );
        if (!grouped) {
          return (
            <section key={section.key} aria-label={section.label} className="flex flex-col gap-2">
              {content}
            </section>
          );
        }
        return (
          <section key={section.key} aria-label={section.label}>
            <CollapsibleSection
              id={`list-${section.key}`}
              heading="h3"
              open={isGroupOpen(section.key)}
              onOpenChange={(open) => {
                if (!open) selection.deselect(selectable);
                collapse.setOpen(groupId(section.key), open);
              }}
              title={section.label}
              count={section.tasks.length}
              className="flex flex-col gap-2"
              toggleClassName="text-title text-ink"
              bodyClassName="flex flex-col gap-2"
            >
              {content}
            </CollapsibleSection>
          </section>
        );
      })}
      <BulkBar
        data={data}
        selectedTasks={selectedTasks}
        viewerId={viewerId}
        notice={selection.notice}
        busy={bulk.busy}
        failures={bulk.failures}
        onRun={(ops) => void bulk.run(ops)}
        onClear={selection.clear}
        onDismissFailures={bulk.dismissFailures}
      />
    </div>
  );
}
