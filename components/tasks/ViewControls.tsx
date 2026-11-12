"use client";

import { SegmentedControl } from "@/components/ui/choice";
import { Dropdown } from "@/components/ui/field";
import type { Density } from "@/lib/tasks/density";
import { GROUP_OPTIONS, SORT_OPTIONS, type GroupKey, type SortKey, type TaskQuery } from "@/lib/tasks/filters";
import { lanesFor } from "./board/lanes";

/** Grouping and sorting for the list; swimlanes and card density for the board. */
export function ViewControls({ query, onChange, density, onDensityChange }: { query: TaskQuery; onChange: (query: TaskQuery) => void; density: Density; onDensityChange: (density: Density) => void }) {
  if (query.view === "list") {
    return (
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
          <Dropdown aria-label="Sort by" value={query.sort} onChange={(event) => onChange({ ...query, sort: event.target.value as SortKey, dir: "asc" })}>
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {`Sort: ${option.label}`}
              </option>
            ))}
          </Dropdown>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 sm:ml-auto sm:border-l sm:border-line sm:pl-3">
      <div className="w-[200px]">
        <Dropdown aria-label="Group by" value={lanesFor(query.group) ?? "column"} onChange={(event) => onChange({ ...query, group: event.target.value as GroupKey })}>
          <option value="column">Group: None</option>
          <option value="assignee">Group: Assignee</option>
          <option value="priority">Group: Priority</option>
        </Dropdown>
      </div>
      <SegmentedControl
        ariaLabel="Card density"
        size="sm"
        value={density}
        onValueChange={onDensityChange}
        options={[
          { value: "comfortable", label: "Comfortable" },
          { value: "compact", label: "Compact" },
        ]}
      />
    </div>
  );
}
