import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdminDashboard } from "@/components/admin/dashboard/AdminDashboard";
import type { AdminDashboardView, OrgUsageRow } from "@/lib/admin/dashboard/types";

const now = new Date().toISOString();
const trend = (current: number, previous: number) => ({ current, previous });
const series = (values: number[]) => values.map((value, i) => ({ start: `2026-10-${String(14 + i).padStart(2, "0")}`, value }));
const org = (over: Partial<OrgUsageRow>): OrgUsageRow => ({
  id: "org1", name: "TinkerSpace Kochi", slug: "tinkerspace", status: "ACTIVE", plan: "Community", members: 9, guests: 1, projects: 4,
  storageBytes: 5 * 1024 ** 2, tasks: 12, emailsMonth: 40, assistantMonth: 1_500, near: [], ...over,
});

const view: AdminDashboardView = {
  range: 30,
  generatedAt: now,
  kpis: {
    orgs: { ACTIVE: 3, PENDING: 2, SUSPENDED: 1, REJECTED: 0 },
    users: { total: 40, disabled: 2, active7: 12, active30: 25 },
    signUps: trend(6, 4), newOrgs: trend(2, 2), activeMembers: trend(18, 0), invitesSent: trend(10, 5), invitesAccepted: trend(7, 3),
    pendingRequests: 2,
  },
  growth: { bucketDays: 1, newOrgs: series([0, 1, 1]), newUsers: series([2, 0, 4]), activeMembers: series([5, 6, 7]) },
  usage: {
    sort: "members",
    top: [org({})],
    nearLimit: [org({ id: "org2", name: "Busy Lab", slug: "busy", near: [{ key: "members", used: 10, max: 10, ratio: 1 }, { key: "storage", used: 900, max: 1000, ratio: 0.9 }] })],
    nearLimitTotal: 1,
    activeOrgs: 3,
    adoption: [{ key: "vault", label: "Vault", on: 2, off: 1, optIn: false }, { key: "secrets", label: "Secrets", on: 0, off: 3, optIn: true }],
  },
  totals: {
    campaignSent: trend(120, 100), transactionalSent: trend(30, 30), transactionalByKind: [{ kind: "invite", count: 20 }],
    assistantUsed: trend(5_000, 2_000), tasksCreated: trend(50, 40), storageBytes: 10 * 1024 ** 2, openProjects: 7,
    payments: [{ provider: "RAZORPAY", currency: "INR", paidCount: 3, paidMinor: 150_000, refundedMinor: 0 }],
    paymentLinks: [{ status: "PAID", count: 3 }, { status: "CREATED", count: 1 }],
  },
  health: {
    version: "0.10.0",
    database: { ok: true, latencyMs: 3 },
    redis: { configured: true, reachable: true },
    queues: [{ name: "outbox", waiting: 1, active: 0, delayed: 0, failed: 2, paused: false }],
    outbox: { pending: 1, processing: 0, failed: 1, sent: 99, oldestPendingAt: now },
    heartbeats: [{ key: "outbox-scheduler", label: "Outbox scheduler", lastSucceededAt: now, fresh: true }],
    storageConfigured: true,
    emailConfigured: false,
  },
  platforms: [
    { id: "posthog", title: "PostHog", enabled: true, configured: true, missing: [], lastTest: { ok: true, at: now }, dashboardUrl: "https://eu.posthog.com", detail: null },
    { id: "sentry", title: "Sentry", enabled: true, configured: false, missing: ["A valid https DSN"], lastTest: null, dashboardUrl: null, detail: "The DSN is write-only, so open Sentry from your own account." },
  ],
  recent: {
    audit: [{ id: "a1", action: "admin.workspace_suspended", at: now, actor: { name: "Ops", email: "ops@example.test" }, org: { id: "org1", name: "TinkerSpace Kochi" } }],
    requests: [{ id: "r1", kind: "NEW_ORG", status: "PENDING", name: "New Lab", at: now, requester: { name: "Meera", email: "meera@example.test" } }],
    signUps: [{ id: "u1", name: null, email: "new@example.test", at: now, verified: false }],
  },
  metabase: null,
};

describe("admin dashboard view", () => {
  const html = renderToStaticMarkup(createElement(AdminDashboard, { data: view }));

  it("renders every section", () => {
    for (const heading of ["Platform at a glance", "Growth", "System health", "Analytics platforms", "Usage across organisations", "Near limits", "Instance usage", "Module adoption", "Admin actions", "Organisation requests", "New sign-ups"]) {
      expect(html, heading).toContain(heading);
    }
  });

  it("links KPIs, limits and provider dashboards", () => {
    expect(html).toContain('href="/admin/requests"');
    expect(html).toContain('href="/admin/organisations/org2?tab=limits"');
    expect(html).toContain('href="https://eu.posthog.com"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('href="/admin?range=90"');
    expect(html).toContain('href="/admin?sort=storage#usage"');
  });

  it("pairs every status with a word and shows trends", () => {
    expect(html).toContain("At limit: Members 10 of 10");
    expect(html).toContain("Near limit: Storage 900 bytes of 1000 bytes");
    expect(html).toContain("Needs setup");
    expect(html).toContain("Not set up");
    expect(html).toContain("Up 50% on the previous 30 days");
    expect(html).toMatch(/₹\s?1,500(\.00)?/);
  });

  it("keeps charts accessible with a table fallback", () => {
    expect(html.match(/role="img"/g)?.length).toBe(3);
    expect(html).toContain("View chart data");
    expect(html).toContain("New people: 6 in total over 3 days");
  });
});
