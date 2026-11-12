import { parseTaskQuery, taskQueryToParams, type TaskQuery } from "@/lib/tasks/filters";

/**
 * Remember the board/list view, filters, sort and grouping per project
 * (pure parts; the browser storage calls live in components/tasks/useRememberedTaskQuery).
 * The URL always wins: a remembered query is only applied when the URL has none.
 */

export const storageKey = (workspaceSlug: string, projectKey: string) => `sww.tasks.view.${workspaceSlug}.${projectKey}`;

const QUERY_PARAMS = ["view", "assignee", "creator", "label", "type", "priority", "due", "q", "sort", "dir", "group"] as const;

/** True when the URL already carries any view, filter, sort or group parameter. */
export function urlHasQuery(params: URLSearchParams): boolean {
  return QUERY_PARAMS.some((name) => params.has(name));
}

export const sameQuery = (a: TaskQuery, b: TaskQuery) => taskQueryToParams(a).toString() === taskQueryToParams(b).toString();

export function serializeQuery(query: TaskQuery): string {
  return JSON.stringify({ view: query.view, filters: query.filters, sort: query.sort, dir: query.dir, group: query.group });
}

/** Parse a stored value; anything malformed or unexpected becomes null (never throws). */
export function deserializeQuery(raw: string | null): TaskQuery | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { view?: unknown; filters?: Record<string, unknown>; sort?: unknown; dir?: unknown; group?: unknown } | null;
    if (!value || typeof value !== "object") return null;
    const filters = value.filters && typeof value.filters === "object" ? value.filters : {};
    const text = (input: unknown) => (Array.isArray(input) ? input.filter((part): part is string => typeof part === "string").join(",") : "");
    const params = new URLSearchParams();
    if (value.view === "list") params.set("view", "list");
    if (text(filters.assignees)) params.set("assignee", text(filters.assignees));
    if (text(filters.creators)) params.set("creator", text(filters.creators));
    if (text(filters.labels)) params.set("label", text(filters.labels));
    if (text(filters.types)) params.set("type", text(filters.types));
    if (text(filters.priorities)) params.set("priority", text(filters.priorities));
    if (typeof filters.due === "string") params.set("due", filters.due);
    if (typeof filters.q === "string") params.set("q", filters.q);
    if (typeof value.sort === "string") params.set("sort", value.sort);
    if (value.dir === "desc") params.set("dir", "desc");
    if (typeof value.group === "string") params.set("group", value.group);
    return parseTaskQuery(params);
  } catch {
    return null;
  }
}
