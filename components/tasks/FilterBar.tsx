"use client";

import { useEffect, useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/choice";
import { Avatar } from "@/components/ui/display";
import { Dropdown, SearchInput } from "@/components/ui/field";
import { activeFilterCount, DUE_FILTERS, EMPTY_FILTERS, GROUP_OPTIONS, PRIORITIES, PRIORITY_LABELS, SORT_OPTIONS, type DueFilter, type GroupKey, type SortKey, type TaskQuery } from "@/lib/tasks/filters";
import type { LabelRef, PersonRef } from "@/lib/tasks/types";
import type { TaskTypeRef } from "@/lib/tasks/taskTypes";
import { MultiSelect } from "./MultiSelect";
import { useRememberedTaskQuery } from "./useRememberedTaskQuery";

/** A Button element (not a component) so the popover trigger can attach its ref and ARIA. */
function filterTrigger(label: string, count: number) {
  return (
    <Button variant="secondary" size="sm" endIcon={<ChevronsUpDown />} aria-label={count ? `${label}, ${count} selected` : label}>
      {label}
      {count ? <span className="rounded-full bg-primary px-1.5 text-xs tabular-nums text-on-primary">{count}</span> : null}
    </Button>
  );
}

/** Search, filters and (in list view) sorting and grouping. State lives in the URL (lib/tasks/filters) and is remembered per project when the URL has none. */
export function FilterBar({ query, onChange, members, labels, taskTypes = [] }: { query: TaskQuery; onChange: (query: TaskQuery) => void; members: PersonRef[]; labels: LabelRef[]; taskTypes?: TaskTypeRef[] }) {
  const { filters } = query;
  useRememberedTaskQuery(query, onChange);
  const [text, setText] = useState(filters.q);
  const [seen, setSeen] = useState(filters.q);
  if (seen !== filters.q) {
    setSeen(filters.q);
    setText(filters.q);
  }
  useEffect(() => {
    if (text === filters.q) return;
    const timer = setTimeout(() => onChange({ ...query, filters: { ...filters, q: text.trim() } }), 250);
    return () => clearTimeout(timer);
  }, [text, filters, query, onChange]);
  const set = (patch: Partial<typeof filters>) => onChange({ ...query, filters: { ...filters, ...patch } });
  const count = activeFilterCount(filters);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <SearchInput value={text} onChange={(event) => setText(event.target.value)} onClear={() => setText("")} placeholder="Search tasks by title or number" aria-label="Search tasks" />
        </div>
        <SegmentedControl
          ariaLabel="View"
          value={query.view}
          onValueChange={(view) => onChange({ ...query, view })}
          options={[
            { value: "board", label: "Board" },
            { value: "list", label: "List" },
          ]}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <MultiSelect
          title="Assignee"
          trigger={filterTrigger("Assignee", filters.assignees.length)}
          items={[
            { id: "me", label: "Me" },
            { id: "none", label: "Unassigned" },
            ...members.map((member) => ({ id: member.id, label: member.name ?? "Member", leading: <Avatar name={member.name} src={member.image} size="xs" /> })),
          ]}
          selected={filters.assignees}
          onChange={(assignees) => set({ assignees })}
          searchPlaceholder="Find a member"
        />
        <MultiSelect
          title="Priority"
          trigger={filterTrigger("Priority", filters.priorities.length)}
          items={PRIORITIES.map((priority) => ({ id: priority, label: PRIORITY_LABELS[priority] }))}
          selected={filters.priorities}
          onChange={(priorities) => set({ priorities: priorities as typeof filters.priorities })}
        />
        <div className="w-[200px]">
          <Dropdown aria-label="Due date" value={filters.due ?? ""} onChange={(event) => set({ due: (event.target.value || null) as DueFilter | null })}>
            <option value="">Any due date</option>
            {DUE_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Dropdown>
        </div>
        {taskTypes.length ? (
          <MultiSelect
            title="Type"
            trigger={filterTrigger("Type", filters.types.length)}
            items={taskTypes.map((type) => ({ id: type.id, label: type.name }))}
            selected={filters.types}
            onChange={(types) => set({ types })}
          />
        ) : null}
        <MultiSelect
          title="Label"
          trigger={filterTrigger("Label", filters.labels.length)}
          items={labels.map((label) => ({ id: label.id, label: label.name }))}
          selected={filters.labels}
          onChange={(selected) => set({ labels: selected })}
          emptyText="No labels yet. Admins add them in settings."
        />
        {count > 0 ? (
          <Button variant="quiet" size="sm" onClick={() => onChange({ ...query, filters: EMPTY_FILTERS })}>
            Clear filters
          </Button>
        ) : null}
        {query.view === "list" ? (
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto sm:border-l sm:border-line sm:pl-3">
            <div className="w-[200px]">
              <Dropdown aria-label="Group by" value={query.group} onChange={(event) => onChange({ ...query, group: event.target.value as GroupKey })}>
                {GROUP_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {`Group: ${option.label}`}
                  </option>
                ))}
              </Dropdown>
            </div>
            <div className="w-[200px]">
              <Dropdown aria-label="Sort by" value={query.sort} onChange={(event) => onChange({ ...query, sort: event.target.value as SortKey })}>
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {`Sort: ${option.label}`}
                  </option>
                ))}
              </Dropdown>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
