import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth", () => ({ auth: async () => (session.id ? { user: { id: session.id } } : null) }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

import { prisma } from "@/lib/db";
import { setInstanceSettings } from "@/lib/instanceSettings";
import { saveWorkspaceAnalytics } from "@/app/actions/workspaceObservability";
import { resolveWorkspaceConnection } from "@/lib/observability";
import { getWorkspaceAnalyticsView } from "@/lib/observability/workspaceStore";
import Page from "@/app/w/[workspaceSlug]/settings/analytics/page";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@o1-${suffix}.test`;
const slugA = `o1a-${suffix}`;
const slugB = `o1b-${suffix}`;
const HOST = "https://93.184.216.34";
let wsA = ""; let wsB = ""; let owner = ""; let admin = ""; let member = "";

const posthogOwn = { provider: "posthog", mode: "own", acknowledged: true, key: "phc_ownkey1234567", host: HOST };

describe.sequential("workspace connected analytics", () => {
  beforeAll(async () => {
    owner = (await createUser(`owner${domain}`)).id;
    admin = (await createUser(`admin${domain}`)).id;
    member = (await createUser(`member${domain}`)).id;
    const ownerB = (await createUser(`ownerb${domain}`)).id;
    wsA = (await createWorkspace(slugA, owner)).id;
    wsB = (await createWorkspace(slugB, ownerB)).id;
    await addMember(wsA, admin, "ADMIN");
    await addMember(wsA, member, "MEMBER");
    await setInstanceSettings({
      "obs.workspaceOverrides.allowed": "true", "obs.workspaceOverrides.providers": "posthog,clarity,grafana,metabase",
      "obs.workspaceOverrides.hostAllowlist": "93.184.216.34", "obs.posthog.enabled": "true", "obs.posthog.key": "phc_instancekey1234",
      "obs.clarity.enabled": "true", "obs.clarity.projectId": "inst1234",
    }, null);
  });
  afterAll(async () => {
    await prisma.instanceSetting.deleteMany({ where: { key: { startsWith: "obs." } } });
    await cleanup([slugA, slugB], domain);
  });

  it("a MEMBER cannot save and does not find the settings page", async () => {
    session.id = member;
    expect((await saveWorkspaceAnalytics(slugA, posthogOwn)).ok).toBe(false);
    await expect(Page({ params: Promise.resolve({ workspaceSlug: slugA }) })).rejects.toThrow();
    session.id = admin;
    await expect(Page({ params: Promise.resolve({ workspaceSlug: slugA }) })).resolves.toBeTruthy();
  });

  it("requires the acknowledgement and validates the host", async () => {
    session.id = admin;
    expect((await saveWorkspaceAnalytics(slugA, { ...posthogOwn, acknowledged: false })).ok).toBe(false);
    expect((await saveWorkspaceAnalytics(slugA, { ...posthogOwn, host: "https://elsewhere.example" })).ok).toBe(false);
    expect((await saveWorkspaceAnalytics(slugA, { ...posthogOwn, host: "http://93.184.216.34" })).ok).toBe(false);
    expect(await prisma.workspaceAnalyticsConnection.count({ where: { workspaceId: wsA } })).toBe(0);
  });

  it("own replaces the instance config for this workspace only", async () => {
    session.id = admin;
    expect((await saveWorkspaceAnalytics(slugA, posthogOwn)).ok).toBe(true);
    expect(await resolveWorkspaceConnection("posthog", wsA)).toMatchObject({ source: "workspace", config: { key: "phc_ownkey1234567", host: HOST } });
    expect(await resolveWorkspaceConnection("posthog", wsB)).toMatchObject({ source: "instance", config: { key: "phc_instancekey1234" } });
    expect((await saveWorkspaceAnalytics(slugA, { provider: "posthog", mode: "off", acknowledged: false })).ok).toBe(true);
    expect((await resolveWorkspaceConnection("posthog", wsA)).active).toBe(false);
  });

  it("only an owner can turn Clarity on; an admin can turn it off", async () => {
    session.id = admin;
    expect((await saveWorkspaceAnalytics(slugA, { provider: "clarity", mode: "inherit", acknowledged: true })).ok).toBe(false);
    session.id = owner;
    expect((await saveWorkspaceAnalytics(slugA, { provider: "clarity", mode: "inherit", acknowledged: true })).ok).toBe(true);
    expect((await resolveWorkspaceConnection("clarity", wsA)).active).toBe(true);
    expect((await resolveWorkspaceConnection("clarity", wsB)).active).toBe(false);
    session.id = admin;
    expect((await saveWorkspaceAnalytics(slugA, { provider: "clarity", mode: "off", acknowledged: false })).ok).toBe(true);
    expect((await resolveWorkspaceConnection("clarity", wsA)).active).toBe(false);
  });

  it("keeps secrets encrypted, write-only and out of audit events and the view", async () => {
    session.id = admin;
    const secret = "mb-embedding-secret-value-123456";
    const input = { provider: "metabase", mode: "own", acknowledged: true, siteUrl: HOST, dashboardIds: "7, 9", secret };
    expect((await saveWorkspaceAnalytics(slugA, input)).ok).toBe(true);
    const row = await prisma.workspaceAnalyticsConnection.findUniqueOrThrow({ where: { workspaceId_provider: { workspaceId: wsA, provider: "metabase" } } });
    expect(row.secretEnc).toBeTruthy();
    expect(row.secretEnc).not.toContain(secret);
    expect(JSON.stringify(row.publicConfig)).not.toContain(secret);
    expect(JSON.stringify(await getWorkspaceAnalyticsView(wsA))).not.toContain(secret);
    const resolved = await resolveWorkspaceConnection("metabase", wsA);
    expect(resolved).toMatchObject({ source: "workspace", secret, config: { dashboardIds: ["7", "9"] } });
    // Leaving the secret blank keeps it; cross-workspace reads never see it.
    expect((await saveWorkspaceAnalytics(slugA, { ...input, secret: "", dashboardIds: "7" })).ok).toBe(true);
    expect((await resolveWorkspaceConnection("metabase", wsA)).secret).toBe(secret);
    expect((await resolveWorkspaceConnection("metabase", wsB)).secret).not.toBe(secret);
    const audits = await prisma.auditEvent.findMany({ where: { workspaceId: wsA, action: "workspace.analytics_updated" } });
    expect(audits.length).toBeGreaterThan(0);
    expect(JSON.stringify(audits)).not.toContain(secret);
  });

  it("ignores workspace settings when the instance disallows overrides", async () => {
    await setInstanceSettings({ "obs.workspaceOverrides.allowed": "false" }, null);
    session.id = admin;
    expect((await saveWorkspaceAnalytics(slugA, posthogOwn)).ok).toBe(false);
    expect((await resolveWorkspaceConnection("metabase", wsA)).source).toBe("instance");
    await setInstanceSettings({ "obs.workspaceOverrides.allowed": "true" }, null);
  });
});
