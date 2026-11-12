import type { GroupKey } from "@/lib/tasks/filters";

/** Board swimlanes: only these groupings make sense as rows of columns. */
export const LANE_GROUPS = ["assignee", "priority"] as const satisfies readonly GroupKey[];

export const lanesFor = (group: GroupKey): "assignee" | "priority" | null => ((LANE_GROUPS as readonly string[]).includes(group) ? (group as "assignee" | "priority") : null);
