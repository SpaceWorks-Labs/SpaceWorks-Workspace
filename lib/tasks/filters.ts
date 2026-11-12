import type { TaskPriority } from "@prisma/client";
import { dueBucket } from "@/lib/tasks/due";
import type { BoardTask, ColumnDTO, LabelRef, PersonRef } from "@/lib/tasks/types";

/**
 * Board and list filters, sorting and grouping (pure, client-safe). The
 * state lives in the URL so a filtered board can be shared:
 * `?assignee=me,<id>&label=<id>&type=<id>&priority=HIGH&due=overdue&q=motor&view=list&sort=due&group=assignee`.
 */

export const PRIORITIES: readonly TaskPriority[] = ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"] as const;
export const PRIORITY_LABELS: Record<TaskPriority, string> = { URGENT: "Urgent", HIGH: "High", MEDIUM: "Medium", LOW: "Low", NONE: "No priority" };
/** Higher = more urgent. */
export const PRIORITY_RANK: Record<TaskPriority, number> = { URGENT: 4, HIGH: 3, MEDIUM: 2, LOW: 1, NONE: 0 };

export type DueFilter = "overdue" | "today" | "week" | "none" | "scheduled";
export const DUE_FILTERS: ReadonlyArray<{ value: DueFilter; label: string }> = [
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Due today" },
  { value: "week", label: "Due this week" },
  { value: "scheduled", label: "Has a due date" },
  { value: "none", label: "No due date" },
];

export type SortKey = "manual" | "due" | "priority" | "number" | "updated" | "title" | "status" | "assignee" | "created";
export type SortDir = "asc" | "desc";
export const SORT_OPTIONS: ReadonlyArray<{ value: SortKey; label: string }> = [
  { value: "manual", label: "Board order" },
  { value: "due", label: "Due date" },
  { value: "priority", label: "Priority" },
  { value: "number", label: "Newest" },
  { value: "updated", label: "Recently updated" },
  { value: "title", label: "Title" },
  { value: "status", label: "Status (board order)" },
  { value: "assignee", label: "Assignee" },
  { value: "created", label: "Created" },
];

/** The list column each sortable header stands for. */
export const HEADER_SORTS = { task: "title", status: "status", priority: "priority", assignee: "assignee", due: "due" } as const satisfies Record<string, SortKey>;

/** Clicking a header: the same column flips the direction, another one starts ascending. */
export function nextHeaderSort(current: { sort: SortKey; dir: SortDir }, clicked: SortKey): { sort: SortKey; dir: SortDir } {
  if (current.sort === clicked) return { sort: clicked, dir: current.dir === "asc" ? "desc" : "asc" };
  return { sort: clicked, dir: "asc" };
}

export const ariaSort = (current: { sort: SortKey; dir: SortDir }, column: SortKey): "ascending" | "descending" | "none" =>
  current.sort !== column ? "none" : current.dir === "desc" ? "descending" : "ascending";

export type GroupKey = "column" | "assignee" | "priority" | "label" | "due" | "none";
export const GROUP_OPTIONS: ReadonlyArray<{ value: GroupKey; label: string }> = [
  { value: "none", label: "No grouping" },
  { value: "column", label: "Status" },
  { value: "assignee", label: "Assignee" },
  { value: "priority", label: "Priority" },
  { value: "label", label: "Label" },
  { value: "due", label: "Due date" },
];

export type TaskFilters = {
  /** User ids, "me" or "none" (unassigned). */
  assignees: string[];
  /** User ids or "me": who created the task. */
  creators: string[];
  labels: string[];
  /** Task type ids (the effective type, so legacy untyped tasks match the default). */
  types: string[];
  priorities: TaskPriority[];
  due: DueFilter | null;
  q: string;
};

export type TaskQuery = { filters: TaskFilters; sort: SortKey; dir: SortDir; group: GroupKey; view: "board" | "list" };

export const EMPTY_FILTERS: TaskFilters = { assignees: [], creators: [], labels: [], types: [], priorities: [], due: null, q: "" };

type ParamSource = URLSearchParams | Record<string, string | string[] | undefined>;

function read(source: ParamSource, key: string): string {
  if (source instanceof URLSearchParams) return source.get(key) ?? "";
  const value = source[key];
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const list = (value: string) => [...new Set(value.split(",").map((part) => part.trim()).filter((part) => ID.test(part)))].slice(0, 20);

export function parseTaskQuery(source: ParamSource): TaskQuery {
  const priorities = list(read(source, "priority").toUpperCase()).filter((value): value is TaskPriority => (PRIORITIES as readonly string[]).includes(value));
  const due = read(source, "due");
  const sort = read(source, "sort");
  const group = read(source, "group");
  return {
    filters: {
      assignees: list(read(source, "assignee")),
      creators: list(read(source, "creator")),
      labels: list(read(source, "label")),
      types: list(read(source, "type")),
      priorities,
      due: DUE_FILTERS.some((option) => option.value === due) ? (due as DueFilter) : null,
      q: read(source, "q").trim().slice(0, 100),
    },
    sort: SORT_OPTIONS.some((option) => option.value === sort) ? (sort as SortKey) : "manual",
    dir: read(source, "dir") === "desc" ? "desc" : "asc",
    group: GROUP_OPTIONS.some((option) => option.value === group) ? (group as GroupKey) : "column",
    view: read(source, "view") === "list" ? "list" : "board",
  };
}

export function taskQueryToParams(query: TaskQuery): URLSearchParams {
  const params = new URLSearchParams();
  const { filters } = query;
  if (query.view === "list") params.set("view", "list");
  if (filters.assignees.length) params.set("assignee", filters.assignees.join(","));
  if (filters.creators.length) params.set("creator", filters.creators.join(","));
  if (filters.labels.length) params.set("label", filters.labels.join(","));
  if (filters.types.length) params.set("type", filters.types.join(","));
  if (filters.priorities.length) params.set("priority", filters.priorities.join(","));
  if (filters.due) params.set("due", filters.due);
  if (filters.q) params.set("q", filters.q);
  if (query.sort !== "manual") params.set("sort", query.sort);
  if (query.sort !== "manual" && query.dir === "desc") params.set("dir", "desc");
  if (query.group !== "column") params.set("group", query.group);
  return params;
}

export function activeFilterCount(filters: TaskFilters): number {
  return filters.assignees.length + filters.creators.length + filters.labels.length + filters.types.length + filters.priorities.length + (filters.due ? 1 : 0) + (filters.q ? 1 : 0);
}

export type FilterContext = { userId: string; now: Date; timeZone: string };
export type FilterableTask = Pick<BoardTask, "number" | "title" | "priority" | "dueAt" | "assigneeIds" | "labelIds"> & { typeId?: string | null; creatorId?: string | null };

export function matchesFilters(task: FilterableTask, filters: TaskFilters, context: FilterContext): boolean {
  if (filters.assignees.length > 0) {
    const ok = filters.assignees.some((value) => {
      if (value === "none") return task.assigneeIds.length === 0;
      if (value === "me") return task.assigneeIds.includes(context.userId);
      return task.assigneeIds.includes(value);
    });
    if (!ok) return false;
  }
  if (filters.creators.length > 0 && !filters.creators.some((value) => (value === "me" ? task.creatorId === context.userId : task.creatorId === value))) return false;
  if (filters.labels.length > 0 && !filters.labels.some((id) => task.labelIds.includes(id))) return false;
  if (filters.types.length > 0 && !(task.typeId && filters.types.includes(task.typeId))) return false;
  if (filters.priorities.length > 0 && !filters.priorities.includes(task.priority)) return false;
  if (filters.due) {
    const bucket = dueBucket(task.dueAt, context.now, context.timeZone);
    if (filters.due === "none" && bucket !== "none") return false;
    if (filters.due === "scheduled" && bucket === "none") return false;
    if (filters.due === "overdue" && bucket !== "overdue") return false;
    if (filters.due === "today" && bucket !== "today") return false;
    if (filters.due === "week" && bucket !== "today" && bucket !== "week") return false;
  }
  if (filters.q) {
    const needle = filters.q.toLowerCase();
    const hay = `${task.title} ${task.number}`.toLowerCase();
    if (!needle.split(/\s+/).every((word) => hay.includes(word.replace(/^#/, "")))) return false;
  }
  return true;
}

const time = (value: string | null) => (value ? new Date(value).getTime() : Number.POSITIVE_INFINITY);

export type SortContext = { dir?: SortDir; columns?: readonly ColumnDTO[]; members?: readonly PersonRef[] };

/** Sort tasks. `dir: "desc"` reverses the column's natural order. `status` follows the board's column order. */
export function sortTasks<T extends BoardTask>(tasks: readonly T[], sort: SortKey, context: SortContext = {}): T[] {
  const copy = [...tasks];
  const byManual = (a: T, b: T) => a.position - b.position || a.number - b.number;
  const columnIndex = (task: T) => {
    const index = (context.columns ?? []).findIndex((column) => column.id === task.columnId);
    return index === -1 ? Number.POSITIVE_INFINITY : index;
  };
  const assigneeName = (task: T) => {
    const first = task.assigneeIds[0];
    if (!first) return null;
    return (context.members?.find((member) => member.id === first)?.name ?? "").toLowerCase();
  };
  let sorted: T[];
  switch (sort) {
    case "due":
      sorted = copy.sort((a, b) => time(a.dueAt) - time(b.dueAt) || PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || a.number - b.number);
      break;
    case "priority":
      sorted = copy.sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || time(a.dueAt) - time(b.dueAt) || a.number - b.number);
      break;
    case "number":
      sorted = copy.sort((a, b) => b.number - a.number);
      break;
    case "updated":
      sorted = copy.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      break;
    case "title":
      sorted = copy.sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base" }) || a.number - b.number);
      break;
    case "status":
      sorted = copy.sort((a, b) => columnIndex(a) - columnIndex(b) || byManual(a, b));
      break;
    case "assignee":
      sorted = copy.sort((a, b) => {
        const left = assigneeName(a);
        const right = assigneeName(b);
        if (left === null || right === null) return left === right ? a.number - b.number : left === null ? 1 : -1;
        return left.localeCompare(right, "en", { sensitivity: "base" }) || a.number - b.number;
      });
      break;
    case "created":
      sorted = copy.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.number - b.number);
      break;
    case "manual":
      return copy.sort(byManual);
  }
  return context.dir === "desc" ? sorted.reverse() : sorted;
}

export type TaskGroup<T> = { key: string; label: string; tasks: T[] };

/** Group (already sorted) tasks. A task with several assignees or labels appears under each. */
export function groupTasks<T extends BoardTask>(
  tasks: readonly T[],
  group: GroupKey,
  context: { columns: ColumnDTO[]; members: PersonRef[]; labels: LabelRef[]; now: Date; timeZone: string },
): TaskGroup<T>[] {
  if (group === "none") return [{ key: "all", label: "All tasks", tasks: [...tasks] }];
  if (group === "column") {
    const groups = context.columns.map((column) => ({ key: column.id, label: column.name, tasks: tasks.filter((task) => task.columnId === column.id) }));
    const orphans = tasks.filter((task) => !context.columns.some((column) => column.id === task.columnId));
    return orphans.length ? [...groups, { key: "none", label: "No status", tasks: orphans }] : groups;
  }
  if (group === "priority") {
    return PRIORITIES.map((priority) => ({ key: priority, label: PRIORITY_LABELS[priority], tasks: tasks.filter((task) => task.priority === priority) })).filter((g) => g.tasks.length > 0);
  }
  if (group === "due") {
    const labels = { overdue: "Overdue", today: "Today", week: "This week", later: "Later", none: "No due date" } as const;
    return (Object.keys(labels) as Array<keyof typeof labels>)
      .map((key) => ({ key, label: labels[key], tasks: tasks.filter((task) => dueBucket(task.dueAt, context.now, context.timeZone) === key) }))
      .filter((g) => g.tasks.length > 0);
  }
  if (group === "assignee") {
    const groups = context.members
      .map((member) => ({ key: member.id, label: member.name ?? "Member", tasks: tasks.filter((task) => task.assigneeIds.includes(member.id)) }))
      .filter((g) => g.tasks.length > 0);
    const unassigned = tasks.filter((task) => task.assigneeIds.length === 0);
    return unassigned.length ? [...groups, { key: "none", label: "Unassigned", tasks: unassigned }] : groups;
  }
  const groups = context.labels.map((label) => ({ key: label.id, label: label.name, tasks: tasks.filter((task) => task.labelIds.includes(label.id)) })).filter((g) => g.tasks.length > 0);
  const unlabelled = tasks.filter((task) => task.labelIds.length === 0);
  return unlabelled.length ? [...groups, { key: "none", label: "No label", tasks: unlabelled }] : groups;
}
