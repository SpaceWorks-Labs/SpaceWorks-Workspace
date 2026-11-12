/** Pure helpers for the instance admin dashboard (client-safe, unit-tested). */
import { CLARITY_PROJECT_PATTERN } from "@/lib/observability/patterns";
import { DASHBOARD_RANGES, ORG_SORTS, type DashboardRange, type LimitKey, type LimitUse, type OrgSort, type OrgUsageRow, type SeriesPoint, type Trend } from "./types";

const DAY_MS = 86_400_000;
/** A limit counts as "near" from 80 % of its cap. */
export const NEAR_LIMIT_RATIO = 0.8;

const first = (raw: string | string[] | undefined) => (Array.isArray(raw) ? raw[0] : raw);

export function parseRange(raw: string | string[] | undefined): DashboardRange {
  const value = Number(first(raw));
  return (DASHBOARD_RANGES as readonly number[]).includes(value) ? (value as DashboardRange) : 30;
}

export function parseSort(raw: string | string[] | undefined): OrgSort {
  const value = first(raw);
  return (ORG_SORTS as readonly string[]).includes(value ?? "") ? (value as OrgSort) : "members";
}

export type DashboardWindow = { range: DashboardRange; since: Date; previousSince: Date; until: Date; bucketDays: number; monthStart: Date };

/** The selected period ends now and starts at UTC midnight `range - 1` days ago; the previous period is the same length before it. */
export function windowFor(range: DashboardRange, now = new Date()): DashboardWindow {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const since = new Date(today - (range - 1) * DAY_MS);
  return {
    range,
    since,
    previousSince: new Date(since.getTime() - range * DAY_MS),
    until: now,
    bucketDays: range > 30 ? 7 : 1,
    monthStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
  };
}

/** Every bucket from `since`, zero-filled, from rows already binned on the same origin. */
export function fillSeries(rows: Array<{ bucket: Date | string; n: number | bigint }>, window: Pick<DashboardWindow, "since" | "range" | "bucketDays">): SeriesPoint[] {
  const step = window.bucketDays * DAY_MS;
  const count = Math.ceil(window.range / window.bucketDays);
  const values = new Array<number>(count).fill(0);
  for (const row of rows) {
    const index = Math.floor((new Date(row.bucket).getTime() - window.since.getTime()) / step);
    if (index >= 0 && index < count) values[index] += Number(row.n);
  }
  return values.map((value, index) => ({ start: new Date(window.since.getTime() + index * step).toISOString().slice(0, 10), value }));
}

/** "Up 25% on the previous 30 days", "Down 3", "Same as the previous 30 days", "New this period". */
export function trendText(trend: Trend, range: number): string {
  const period = `the previous ${range} days`;
  const { current, previous } = trend;
  if (current === previous) return `Same as ${period}`;
  if (previous === 0) return `Up from none in ${period}`;
  const percent = Math.round((Math.abs(current - previous) / previous) * 100);
  return `${current > previous ? "Up" : "Down"} ${percent}% on ${period}`;
}

export type OrgLimitInput = {
  maxMembers: number | null;
  maxGuests: number | null;
  maxProjects: number | null;
  maxStorageBytes: number | null;
  assistantMonthlyTokens: number | null;
  monthlyEmailCap: number | null;
};

/** Usage against each capped limit, at or above NEAR_LIMIT_RATIO, highest ratio first. */
export function nearLimits(row: Pick<OrgUsageRow, "members" | "guests" | "projects" | "storageBytes" | "assistantMonth" | "emailsMonth">, limits: OrgLimitInput): LimitUse[] {
  const pairs: Array<[LimitKey, number, number | null]> = [
    ["members", row.members, limits.maxMembers],
    ["guests", row.guests, limits.maxGuests],
    ["projects", row.projects, limits.maxProjects],
    ["storage", row.storageBytes, limits.maxStorageBytes],
    ["assistant", row.assistantMonth, limits.assistantMonthlyTokens],
    ["emails", row.emailsMonth, limits.monthlyEmailCap],
  ];
  return pairs
    .flatMap(([key, used, max]) => {
      if (max === null) return [];
      const ratio = max === 0 ? (used > 0 ? Infinity : 1) : used / max;
      return ratio >= NEAR_LIMIT_RATIO ? [{ key, used, max, ratio: Number.isFinite(ratio) ? ratio : 1 }] : [];
    })
    .sort((a, b) => b.ratio - a.ratio);
}

const SORT_FIELD: Record<OrgSort, keyof OrgUsageRow> = {
  members: "members", storage: "storageBytes", projects: "projects", tasks: "tasks", emails: "emailsMonth", assistant: "assistantMonth",
};

/** The `limit` organisations with the highest value for `sort`, ties broken by name. Zero rows are left out. */
export function topOrganisations(rows: OrgUsageRow[], sort: OrgSort, limit = 10): OrgUsageRow[] {
  const field = SORT_FIELD[sort];
  return rows
    .filter((row) => Number(row[field]) > 0)
    .sort((a, b) => Number(b[field]) - Number(a[field]) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** Organisations with a near-limit flag, the closest to (or furthest over) a cap first. */
export function nearLimitOrganisations(rows: OrgUsageRow[], limit = 10): OrgUsageRow[] {
  return rows
    .filter((row) => row.near.length > 0)
    .sort((a, b) => b.near[0].ratio - a.near[0].ratio || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export const LIMIT_LABELS: Record<LimitKey, string> = {
  members: "Members", guests: "Guests", projects: "Projects", storage: "Storage", assistant: "Assistant tokens this month", emails: "Campaign emails this month",
};

export const SORT_LABELS: Record<OrgSort, string> = {
  members: "Members", storage: "Storage", projects: "Projects", tasks: "Tasks created", emails: "Emails this month", assistant: "Assistant tokens",
};

/** "admin.workspace_suspended" → "Workspace suspended". */
export function auditLabel(action: string): string {
  const text = action.replace(/^admin\./, "").replace(/[._]+/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : action;
}

/** "outbox-scheduler" → "Outbox scheduler". */
export function heartbeatLabel(key: string): string {
  const text = key.replace(/[-_.]+/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : key;
}

/** Compact counts: 950, 12.4k, 3.1M. */
export function compactNumber(value: number): string {
  return new Intl.NumberFormat("en-GB", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function httpsUrl(value: string | null | undefined): URL | null {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/**
 * Provider dashboard link built only from non-secret settings, or null when
 * none names one. PostHog Cloud ingest hosts (`eu.i.posthog.com`) map to
 * their app host; a self-hosted PostHog is its own app.
 */
export function providerDashboardUrl(provider: string, s: { posthogHost?: string | null; clarityProjectId?: string | null; grafanaUrl?: string | null; grafanaPath?: string | null; metabaseSiteUrl?: string | null }): string | null {
  if (provider === "posthog") {
    const url = httpsUrl(s.posthogHost);
    return url ? `https://${url.hostname.replace(/\.i\.posthog\.com$/, ".posthog.com")}` : null;
  }
  if (provider === "clarity") return s.clarityProjectId && CLARITY_PROJECT_PATTERN.test(s.clarityProjectId) ? `https://clarity.microsoft.com/projects/view/${s.clarityProjectId}/dashboard` : null;
  if (provider === "grafana") {
    const url = httpsUrl(s.grafanaUrl);
    if (!url) return null;
    const path = s.grafanaPath?.startsWith("/") ? s.grafanaPath : "";
    return httpsUrl(`${url.origin}${url.pathname.replace(/\/$/, "")}${path}`)?.toString() ?? null;
  }
  if (provider === "metabase") return httpsUrl(s.metabaseSiteUrl)?.origin ?? null;
  return null;
}

/** `/admin` with the range and ranking in the query, defaults left out. */
export function dashboardHref(range: number, sort: OrgSort, hash = ""): string {
  const params = new URLSearchParams();
  if (range !== 30) params.set("range", String(range));
  if (sort !== "members") params.set("sort", sort);
  const query = params.toString();
  return `/admin${query ? `?${query}` : ""}${hash}`;
}
