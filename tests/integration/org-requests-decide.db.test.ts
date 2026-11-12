import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getEffectiveLimits } from "@/lib/limits";
import { applyNewOrgApproval, applyRequestDecision, createOrgRequest } from "@/lib/orgRequests/service";
import { loadPlanView } from "@/lib/orgRequests/plan";
import { cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@ord-${suffix}.test`;
const newSlug = `ord-new-${suffix}`;
const wsSlug = `ord-ws-${suffix}`;
let adminId: string;
let requesterId: string;
let ownerId: string;
let workspaceId: string;

describe.sequential("organisation requests: deciding", () => {
  beforeAll(async () => {
    adminId = (await createUser(`root${domain}`)).id;
    requesterId = (await createUser(`req${domain}`)).id;
    ownerId = (await createUser(`own${domain}`)).id;
    workspaceId = (await createWorkspace(wsSlug, ownerId)).id;
  });

  afterAll(async () => {
    await prisma.orgRequest.deleteMany({ where: { requestedBy: { email: { endsWith: domain } } } });
    await cleanup([newSlug, wsSlug, `${newSlug}-2`], domain);
    await prisma.$disconnect();
  });

  it("approving NEW_ORG creates the workspace, owner, default channels and notifies", async () => {
    const created = await createOrgRequest(requesterId, { kind: "NEW_ORG", name: "New Org", slug: newSlug });
    if (!created.ok) throw new Error(created.error);
    const done = await applyNewOrgApproval(created.data.requestId, adminId, "Welcome");
    expect(done).toMatchObject({ ok: true, data: { workspaceSlug: newSlug } });
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug: newSlug }, include: { memberships: true, channels: true } });
    expect(workspace.status).toBe("ACTIVE");
    expect(workspace.memberships).toMatchObject([{ userId: requesterId, role: "OWNER" }]);
    expect(workspace.channels.map((c) => c.slug)).toEqual(expect.arrayContaining(["general", "announcements"]));
    const request = await prisma.orgRequest.findUniqueOrThrow({ where: { id: created.data.requestId } });
    expect(request).toMatchObject({ status: "APPROVED", workspaceId: workspace.id, decidedById: adminId, decisionNote: "Welcome" });
    const mail = await prisma.outboxMessage.findFirst({ where: { kind: "email", payload: { path: ["to"], equals: `req${domain}` } } });
    expect(mail).not.toBeNull();
    const notification = await prisma.notificationEventRecord.findFirst({ where: { workspaceId: workspace.id, type: "org.request_decided" } });
    expect(notification).not.toBeNull();
  });

  it("refuses a second decision on the same request", async () => {
    const created = await createOrgRequest(requesterId, { kind: "NEW_ORG", name: "Twice", slug: `${newSlug}-2` });
    if (!created.ok) throw new Error(created.error);
    const [a, b] = await Promise.all([applyRequestDecision(created.data.requestId, "APPROVED", adminId), applyRequestDecision(created.data.requestId, "APPROVED", adminId)]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(await applyRequestDecision(created.data.requestId, "REJECTED", adminId, "late")).toMatchObject({ ok: false });
    expect(await prisma.workspace.count({ where: { slug: `${newSlug}-2` } })).toBe(1);
  });

  it("rejects with a note, and requires one", async () => {
    const created = await createOrgRequest(requesterId, { kind: "FEATURE", workspaceId, module: "vault" });
    // requester is not an owner of the workspace, so use the owner.
    expect(created.ok).toBe(false);
    const own = await createOrgRequest(ownerId, { kind: "FEATURE", workspaceId, module: "vault" });
    if (!own.ok) throw new Error(own.error);
    expect(await applyRequestDecision(own.data.requestId, "REJECTED", adminId)).toMatchObject({ ok: false });
    expect(await applyRequestDecision(own.data.requestId, "REJECTED", adminId, "Not on this plan")).toMatchObject({ ok: true });
    const row = await prisma.orgRequest.findUniqueOrThrow({ where: { id: own.data.requestId } });
    expect(row).toMatchObject({ status: "REJECTED", decisionNote: "Not on this plan" });
    const limits = await prisma.workspaceLimits.findUnique({ where: { workspaceId } });
    expect(limits).toBeNull();
  });

  it("approving MORE_LIMIT and FEATURE applies them", async () => {
    await prisma.workspaceLimits.create({ data: { workspaceId, disabledModules: ["vault", "social"], maxMembers: 5 } });
    const more = await createOrgRequest(ownerId, { kind: "MORE_LIMIT", workspaceId, limit: "maxStorageBytes", requested: 5_000_000_000 });
    const feature = await createOrgRequest(ownerId, { kind: "FEATURE", workspaceId, module: "vault" });
    if (!more.ok || !feature.ok) throw new Error("create failed");
    expect(await applyRequestDecision(more.data.requestId, "APPROVED", adminId)).toMatchObject({ ok: true });
    expect(await applyRequestDecision(feature.data.requestId, "APPROVED", adminId)).toMatchObject({ ok: true });
    const limits = await getEffectiveLimits(workspaceId);
    expect(limits.maxStorageBytes).toBe(5_000_000_000);
    expect(limits.maxMembers).toBe(5);
    expect(limits.disabledModules).toEqual(["social"]);
  });

  it("the plan loader works while the workspace is suspended", async () => {
    await prisma.workspace.update({ where: { id: workspaceId }, data: { status: "SUSPENDED", statusReason: "Unpaid", suspendedAt: new Date() } });
    const view = await loadPlanView(workspaceId);
    expect(view).toMatchObject({ status: "SUSPENDED", statusReason: "Unpaid" });
    expect(view.limits.find((row) => row.key === "maxMembers")).toMatchObject({ used: 1, limit: 5 });
    expect(view.limits.find((row) => row.key === "maxProjects")?.limit).toBeNull();
    expect(view.modules.find((m) => m.key === "vault")?.enabled).toBe(true);
    expect(view.modules.find((m) => m.key === "social")?.enabled).toBe(false);
    expect(view.requests.length).toBeGreaterThan(2);
  });
});
