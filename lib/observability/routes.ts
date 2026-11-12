/**
 * Where consent-gated client analytics (PostHog, Clarity, Firebase) may run,
 * and how a pathname is turned into a template that carries no ids or slugs.
 * Pure and edge-safe. Allow-list first, deny-list as a second lock.
 */

/** Workspace areas where a page view is fine. Everything else is off by default. */
export const ANALYTICS_ALLOWED_SECTIONS: readonly string[] = [
  "", "projects", "t", "my-tasks", "cycles", "goals", "docs", "documents", "notepad", "files", "calendar", "meetings", "polls",
  "announcements", "ideas", "templates", "members", "teams", "activity", "analytics", "search", "notifications", "changelog",
  "links", "forms", "catalogue", "services", "requests", "assistant", "onboarding", "volunteering", "rota", "leave", "attendance",
];

/** Areas that hold secrets, money, private conversations or sensitive people data. */
const DENY = /^\/w\/[^/]+\/(?:vault|secrets|finance|chat|dm|money-controls|safeguarding|safety|hiring|funding|payroll|governance|boardroom|settings|sign|org-people|people-tools|contacts|pipeline|escalation)(?:\/|$)/i;
const ADMIN = /^\/admin(?:\/|$)/i;

/** Words that may stay in a templated path; any other segment becomes `:id`. */
const KNOWN_SEGMENTS = new Set([
  ...ANALYTICS_ALLOWED_SECTIONS.filter(Boolean),
  "api", "v1", "new", "edit", "board", "list", "timeline", "reports", "overview", "settings", "w", "archive", "templates", "calendar", "mine", "all", "inbox",
]);

export function stripQueryAndHash(path: string): string {
  const cut = path.search(/[?#]/);
  return cut === -1 ? path : path.slice(0, cut);
}

/** `/w/acme/projects/ck123/edit?x=1` becomes `/w/:workspace/projects/:id/edit`. */
export function normalizePath(path: string): string {
  const clean = stripQueryAndHash(path.trim());
  const parts = clean.split("/").filter(Boolean);
  if (parts.length === 0) return "/";
  const out = parts.map((segment, index) => {
    if (index === 0 && segment === "w") return "w";
    if (index === 1 && parts[0] === "w") return ":workspace";
    return KNOWN_SEGMENTS.has(segment.toLowerCase()) ? segment.toLowerCase() : ":id";
  });
  return `/${out.join("/")}`;
}

/** The workspace slug of a `/w/<slug>/...` path, or null. */
export function workspaceSlugFromPath(path: string): string | null {
  const match = /^\/w\/([^/?#]+)/.exec(path);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
}

/** True only for an allow-listed workspace area that is not on the deny-list. */
export function isAnalyticsRouteAllowed(path: string): boolean {
  const clean = stripQueryAndHash(path);
  if (ADMIN.test(clean) || DENY.test(clean)) return false;
  const match = /^\/w\/[^/]+(?:\/([^/]+))?/.exec(clean);
  if (!match) return false;
  return ANALYTICS_ALLOWED_SECTIONS.includes((match[1] ?? "").toLowerCase());
}
