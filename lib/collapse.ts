/** Pure helpers for remembering which groups are open or closed (stored as one JSON map per key). */

export type OpenMap = Record<string, boolean>;

export function parseOpenMap(raw: string | null | undefined): OpenMap {
  try {
    const value: unknown = JSON.parse(raw || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
  } catch {
    return {};
  }
}

/** Stored choice for `id`, else the default. */
export function resolveOpen(map: OpenMap, id: string, defaultOpen: boolean): boolean {
  return map[id] ?? defaultOpen;
}

export function withOpen(map: OpenMap, id: string, open: boolean): string {
  return JSON.stringify({ ...map, [id]: open });
}
