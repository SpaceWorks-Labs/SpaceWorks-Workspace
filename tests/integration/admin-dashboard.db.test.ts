import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ allowed: true }));
vi.mock("@/lib/permissions", () => ({
  requireSuperAdminMfa: async () => {
    if (!state.allowed) throw new Error("NEXT_NOT_FOUND");
    return { user: { id: "admin", email: "admin@example.test" } };
  },
}));

import { prisma } from "@/lib/db";
import { loadAdminDashboard } from "@/lib/admin/dashboard";
import { resetDashboardCache } from "@/lib/admin/dashboard/cache";
import { windowFor } from "@/lib/admin/dashboard/compute";
import { loadGrowth, loadKpis } from "@/lib/admin/dashboard/kpis";
import { loadOrgUsageRows, moduleAdoption } from "@/lib/admin/dashboard/orgUsage";
import { loadAdminOverviewPage } from "@/lib/views/generated/admin-page-loadAdminOverviewPage";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@dash-${suffix}.test`;
const slugA = `dash-a-${suffix}`;
const slugB = `dash-b-${suffix}`;
let orgA: string;
let orgB: string;
let ownerId: string;

describe.sequential("admin dashboard loader", () => {
  beforeAll(async () => {
    ownerId = (await createUser(`owner${domain}`, "Dash Owner")).id;
    orgA = (await createWorkspace(slugA, ownerId)).id;
    orgB = (await createWorkspace(slugB, ownerId)).id;
    await addMember(orgA, (await createUser(`m1${domain}`)).id, "MEMBER");
    await addMember(orgA, (await createUser(`m2${domain}`)).id, "MEMBER");
    await addMember(orgA, (await createUser(`g1${domain}`)).id, "GUEST");
    await prisma.project.createMany({ data: [{ workspaceId: orgA, key: "DSA", name: "A" }, { workspaceId: orgA, key: "DSB", name: "B" }, { workspaceId: orgA, key: "DSC", name: "C", status: "ARCHIVED" }] });
    await prisma.fileObject.create({ data: { workspaceId: orgB, storageKey: `dash-${suffix}`, filename: "a.bin", contentType: "application/octet-stream", size: 900 } });
    await prisma.workspaceLimits.createMany({ data: [
      { workspaceId: orgA, maxMembers: 3, plan: "Community" },
      { workspaceId: orgB, maxStorageBytes: BigInt(1_000), disabledModules: ["vault"] },
    ] });
    await prisma.invitation.create({ data: { workspaceId: orgA, email: `invitee${domain}`, tokenHash: `dash-hash-${suffix}`, expiresAt: new Date(Date.now() + 86_400_000), invitedById: ownerId } });
    await prisma.activityEvent.create({ data: { workspaceId: orgA, actorId: ownerId, verb: "created", entityType: "project", entityId: "x", summary: "Dash test" } });
  });
  beforeEach(() => { state.allowed = true; resetDashboardCache(); });
  afterAll(async () => {
    await cleanup([slugA, slugB], domain);
    await prisma.$disconnect();
  });

  it("aggregates usage and limits per organisation without per-organisation reads", async () => {
    const { rows, modules } = await loadOrgUsageRows(windowFor(30));
    const a = rows.find((row) => row.id === orgA);
    const b = rows.find((row) => row.id === orgB);
    expect(a).toMatchObject({ members: 3, guests: 1, projects: 2, storageBytes: 0, plan: "Community" });
    expect(a?.near).toEqual([{ key: "members", used: 3, max: 3, ratio: 1 }]);
    expect(b).toMatchObject({ members: 1, storageBytes: 900 });
    expect(b?.near).toEqual([{ key: "storage", used: 900, max: 1_000, ratio: 0.9 }]);
    const adoption = moduleAdoption([modules.get(orgA)!, modules.get(orgB)!]);
    expect(adoption.find((m) => m.key === "vault")).toMatchObject({ on: 1, off: 1 });
    expect(adoption.find((m) => m.key === "chat")).toMatchObject({ on: 2, off: 0 });
  });

  it("counts this period's sign-ups, organisations, invitations and activity", async () => {
    const w = windowFor(30);
    const kpis = await loadKpis(w);
    expect(kpis.signUps.current).toBeGreaterThanOrEqual(4);
    expect(kpis.newOrgs.current).toBeGreaterThanOrEqual(2);
    expect(kpis.invitesSent.current).toBeGreaterThanOrEqual(1);
    expect(kpis.activeMembers.current).toBeGreaterThanOrEqual(1);
    expect(kpis.orgs.ACTIVE).toBeGreaterThanOrEqual(2);
    const growth = await loadGrowth(w);
    expect(growth.newOrgs).toHaveLength(30);
    expect(growth.newOrgs.at(-1)!.value).toBeGreaterThanOrEqual(2);
    expect(growth.activeMembers.at(-1)!.value).toBeGreaterThanOrEqual(1);
  });

  it("builds the whole view for a 90-day range with plain, secret-free values", async () => {
    const view = await loadAdminDashboard({ range: "90", sort: "storage" });
    expect(view.range).toBe(90);
    expect(view.growth.bucketDays).toBe(7);
    expect(view.growth.newUsers).toHaveLength(13);
    expect(view.usage.sort).toBe("storage");
    expect(view.health.database.ok).toBe(true);
    expect(view.platforms.map((p) => p.id)).toEqual(["sentry", "posthog", "clarity", "firebase", "metrics", "grafana", "metabase"]);
    expect(view.recent.signUps.length).toBeGreaterThan(0);
    const json = JSON.stringify(view);
    expect(JSON.parse(json)).toEqual(view);
    expect(json).not.toContain(`dash-hash-${suffix}`);
    expect(json).not.toMatch(/passwordHash|tokenHash|secretKey|"dsn"/);
  });

  it("serves the generated view only behind the super-admin guard", async () => {
    const view = await loadAdminOverviewPage({ searchParams: Promise.resolve({ range: "30" }) });
    expect(view.dashboard.range).toBe(30);
    state.allowed = false;
    await expect(loadAdminOverviewPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
