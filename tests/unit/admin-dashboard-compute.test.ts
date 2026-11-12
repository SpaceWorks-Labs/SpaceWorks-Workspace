import { describe, expect, it } from "vitest";
import {
  auditLabel, dashboardHref, fillSeries, heartbeatLabel, nearLimitOrganisations, nearLimits, parseRange, parseSort,
  providerDashboardUrl, topOrganisations, trendText, windowFor,
} from "@/lib/admin/dashboard/compute";
import type { OrgUsageRow } from "@/lib/admin/dashboard/types";

const noLimits = { maxMembers: null, maxGuests: null, maxProjects: null, maxStorageBytes: null, assistantMonthlyTokens: null, monthlyEmailCap: null };
const usage = { members: 0, guests: 0, projects: 0, storageBytes: 0, assistantMonth: 0, emailsMonth: 0 };
const row = (name: string, over: Partial<OrgUsageRow> = {}): OrgUsageRow => ({
  id: name, name, slug: name.toLowerCase(), status: "ACTIVE", plan: null, ...usage, tasks: 0, near: [], ...over,
});

describe("admin dashboard query parsing", () => {
  it("accepts only the offered ranges and rankings", () => {
    expect(parseRange("90")).toBe(90);
    expect(parseRange(["90", "30"])).toBe(90);
    expect(parseRange("7")).toBe(30);
    expect(parseRange(undefined)).toBe(30);
    expect(parseSort("storage")).toBe("storage");
    expect(parseSort("passwordHash")).toBe("members");
  });

  it("builds links that leave the defaults out", () => {
    expect(dashboardHref(30, "members")).toBe("/admin");
    expect(dashboardHref(90, "storage", "#usage")).toBe("/admin?range=90&sort=storage#usage");
  });
});

describe("admin dashboard windows and series", () => {
  const now = new Date("2026-11-12T15:30:00Z");

  it("starts the period at UTC midnight and mirrors it for the previous period", () => {
    const w = windowFor(30, now);
    expect(w.since.toISOString()).toBe("2026-10-14T00:00:00.000Z");
    expect(w.previousSince.toISOString()).toBe("2026-09-14T00:00:00.000Z");
    expect(w.bucketDays).toBe(1);
    expect(w.monthStart.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(windowFor(90, now).bucketDays).toBe(7);
  });

  it("zero-fills buckets and ignores rows outside the window", () => {
    const w = windowFor(30, now);
    const series = fillSeries([
      { bucket: new Date("2026-10-14T00:00:00Z"), n: 2 },
      { bucket: "2026-11-12T00:00:00Z", n: BigInt(5) },
      { bucket: new Date("2026-09-01T00:00:00Z"), n: 9 },
    ], w);
    expect(series).toHaveLength(30);
    expect(series[0]).toEqual({ start: "2026-10-14", value: 2 });
    expect(series[29]).toEqual({ start: "2026-11-12", value: 5 });
    expect(series.reduce((sum, p) => sum + p.value, 0)).toBe(7);
  });

  it("bins a 90-day period into 13 weekly buckets", () => {
    const w = windowFor(90, now);
    const series = fillSeries([{ bucket: new Date(w.since.getTime() + 7 * 86_400_000), n: 4 }], w);
    expect(series).toHaveLength(13);
    expect(series[1].value).toBe(4);
  });
});

describe("admin dashboard trends and labels", () => {
  it("describes change against the previous period", () => {
    expect(trendText({ current: 15, previous: 12 }, 30)).toBe("Up 25% on the previous 30 days");
    expect(trendText({ current: 3, previous: 4 }, 90)).toBe("Down 25% on the previous 90 days");
    expect(trendText({ current: 4, previous: 4 }, 30)).toBe("Same as the previous 30 days");
    expect(trendText({ current: 2, previous: 0 }, 30)).toBe("Up from none in the previous 30 days");
  });

  it("humanises audit actions and heartbeat keys", () => {
    expect(auditLabel("admin.workspace_suspended")).toBe("Workspace suspended");
    expect(heartbeatLabel("outbox-scheduler")).toBe("Outbox scheduler");
  });
});

describe("admin dashboard limits and ranking", () => {
  it("flags limits at 80% or more, highest first, and skips unlimited ones", () => {
    const near = nearLimits({ ...usage, members: 9, projects: 4, storageBytes: 1_100 }, { ...noLimits, maxMembers: 10, maxProjects: 10, maxStorageBytes: 1_000 });
    expect(near.map((use) => use.key)).toEqual(["storage", "members"]);
    expect(near[0]).toMatchObject({ used: 1_100, max: 1_000, ratio: 1.1 });
    expect(nearLimits({ ...usage, members: 500 }, noLimits)).toEqual([]);
  });

  it("treats a zero cap as at the limit", () => {
    expect(nearLimits({ ...usage, emailsMonth: 3 }, { ...noLimits, monthlyEmailCap: 0 })).toEqual([{ key: "emails", used: 3, max: 0, ratio: 1 }]);
  });

  it("ranks by the chosen field, leaves out zeros and caps the list", () => {
    const rows = [row("Beta", { members: 3, storageBytes: 10 }), row("Alpha", { members: 3 }), row("Gamma", { members: 9 }), row("Idle")];
    expect(topOrganisations(rows, "members").map((r) => r.name)).toEqual(["Gamma", "Alpha", "Beta"]);
    expect(topOrganisations(rows, "storage").map((r) => r.name)).toEqual(["Beta"]);
    expect(topOrganisations(rows, "members", 1)).toHaveLength(1);
  });

  it("orders near-limit organisations by their worst limit", () => {
    const rows = [
      row("Calm"),
      row("Close", { near: [{ key: "members", used: 8, max: 10, ratio: 0.8 }] }),
      row("Over", { near: [{ key: "storage", used: 12, max: 10, ratio: 1.2 }] }),
    ];
    expect(nearLimitOrganisations(rows).map((r) => r.name)).toEqual(["Over", "Close"]);
  });
});

describe("provider dashboard links", () => {
  it("builds links only from non-secret https settings", () => {
    expect(providerDashboardUrl("posthog", { posthogHost: "https://eu.i.posthog.com" })).toBe("https://eu.posthog.com");
    expect(providerDashboardUrl("posthog", { posthogHost: "https://ph.example.org" })).toBe("https://ph.example.org");
    expect(providerDashboardUrl("posthog", { posthogHost: "http://ph.example.org" })).toBeNull();
    expect(providerDashboardUrl("clarity", { clarityProjectId: "abc123xyz" })).toBe("https://clarity.microsoft.com/projects/view/abc123xyz/dashboard");
    expect(providerDashboardUrl("clarity", { clarityProjectId: "../x" })).toBeNull();
    expect(providerDashboardUrl("grafana", { grafanaUrl: "https://grafana.example.org/", grafanaPath: "/d/spaceworks-overview" })).toBe("https://grafana.example.org/d/spaceworks-overview");
    expect(providerDashboardUrl("grafana", { grafanaUrl: "javascript:alert(1)" })).toBeNull();
    expect(providerDashboardUrl("metabase", { metabaseSiteUrl: "https://mb.example.org/some/path" })).toBe("https://mb.example.org");
    expect(providerDashboardUrl("sentry", {})).toBeNull();
  });
});
