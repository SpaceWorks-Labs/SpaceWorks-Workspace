import { redactSensitiveText } from "@/lib/redactSensitiveText";
import { normalizePath } from "../routes";

/**
 * Event scrubbing for Sentry (server and browser). Removes cookies, auth
 * headers, request bodies, query strings, URL tokens and user data, and turns
 * paths into templates. Structural types so it works for any SDK event.
 */
type Loose = Record<string, unknown>;

const TOKENISH = /\b(?:Bearer\s+)?[A-Za-z0-9_-]{32,}\b/g;

export function scrubText(value: string): string {
  return redactSensitiveText(value).replace(TOKENISH, "[redacted token]");
}

/** A URL reduced to a templated path (no host, query, hash or ids). */
export function scrubUrl(value: string): string {
  try {
    return normalizePath(new URL(value, "http://local.invalid").pathname);
  } catch {
    return normalizePath(value);
  }
}

function scrubValues(node: unknown): void {
  if (!node || typeof node !== "object") return;
  for (const entry of Object.values(node as Loose)) {
    if (entry && typeof entry === "object") scrubValues(entry);
  }
  const list = (node as Loose).values;
  if (Array.isArray(list)) {
    for (const item of list as Loose[]) if (typeof item.value === "string") item.value = scrubText(item.value);
  }
}

export function scrubEvent<T extends object>(event: T): T {
  const e = event as Loose;
  const request = e.request as Loose | undefined;
  if (request) {
    delete request.cookies; delete request.headers; delete request.data; delete request.query_string; delete request.env;
    if (typeof request.url === "string") request.url = scrubUrl(request.url);
  }
  delete e.user; delete e.server_name; delete e.extra;
  if (typeof e.message === "string") e.message = scrubText(e.message);
  if (typeof e.transaction === "string" && e.transaction.includes("/")) e.transaction = scrubUrl(e.transaction);
  if (e.exception) scrubValues(e.exception);
  const contexts = e.contexts as Loose | undefined;
  if (contexts) { delete contexts.culture; delete contexts.device; }
  if (Array.isArray(e.breadcrumbs)) {
    e.breadcrumbs = (e.breadcrumbs as Loose[]).map((b) => scrubBreadcrumb(b)).filter(Boolean);
  }
  return event;
}

/** Console and input breadcrumbs are dropped; request breadcrumbs keep a templated path and the status only. */
export function scrubBreadcrumb<T extends object>(crumb: T): T | null {
  const b = crumb as Loose;
  if (b.category === "console" || String(b.category ?? "").startsWith("ui.")) return null;
  if (typeof b.message === "string") b.message = scrubText(b.message);
  const data = b.data as Loose | undefined;
  if (data) {
    const kept: Loose = {};
    for (const key of ["method", "status_code", "reason"]) if (key in data) kept[key] = data[key];
    for (const key of ["url", "from", "to"]) if (typeof data[key] === "string") kept[key] = scrubUrl(data[key] as string);
    b.data = kept;
  }
  return crumb;
}
