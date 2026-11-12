import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ adminId: "" as string | null }));
vi.mock("@/lib/permissions", () => ({
  requireSuperAdminMfa: async () => {
    if (!state.adminId) throw new Error("NEXT_NOT_FOUND");
    return { user: { id: state.adminId, email: "admin@example.test" } };
  },
}));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

import { prisma } from "@/lib/db";
import { getEffectiveLimits } from "@/lib/limits";
import { adminChangeRoleAction, adminRemoveMemberAction, reactivateOrgAction, saveOrgLimitsAction, suspendOrgAction, transferOwnershipAction } from "@/app/actions/adminOrgs";
import { decideRequestAction } from "@/app/actions/adminRequests";
import { listOrganisations } from "@/lib/admin/orgList";
import { listRequests } from "@/lib/admin/requestQueue";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@a2-${suffix}.test`;
const slug = `a2-${suffix}`;
let adminId: string;
let ownerId: string;
let memberId: string;
let workspaceId: string;
let ownerMembershipId: string;
let memberMembershipId: string;

const limits = (over: Record<string, unknown> = {}) => ({
  workspaceId, maxMembers: null, maxGuests: null, maxProjects: null, maxStorageMb: null, maxFileMb: null, maxApiTokens: null, maxWebhooks: null,
  assistantMonthlyTokens: null, monthlyEmailCap: null, assistantEnabled: "inherit", plan: null, modules: {}, ...over,
});

describe.sequential("admin organisations", () => {
  beforeAll(async () => {
    adminId = (await createUser(`admin${domain}`, "Admin")).id;
    ownerId = (await createUser(`owner${domain}`, "Owner")).id;
    memberId = (await createUser(`member${domain}`, "Member")).id;
    workspaceId = (await createWorkspace(slug, ownerId)).id;
    await addMember(workspaceId, memberId, "MEMBER");
    ownerMembershipId = (await prisma.membership.findFirstOrThrow({ where: { workspaceId, userId: ownerId } })).id;
    memberMembershipId = (await prisma.membership.findFirstOrThrow({ where: { workspaceId, userId: memberId } })).id;
  });
  beforeEach(() => { state.adminId = adminId; });
  afterAll(async () => {
    await prisma.orgRequest.deleteMany({ where: { requestedBy: { email: { endsWith: domain } } } });
    await cleanup([slug, `new-${slug}`], domain);
  });

  it("rejects callers who are not the super admin", async () => {
    state.adminId = null;
    await expect(suspendOrgAction({ workspaceId, reason: "No reason needed" })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(saveOrgLimitsAction(limits({ maxMembers: 1 }))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(decideRequestAction({ requestId: "x", decision: "APPROVED" })).rejects.toThrow("NEXT_NOT_FOUND");
    expect((await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).status).toBe("ACTIVE");
    expect(await prisma.workspaceLimits.findUnique({ where: { workspaceId } })).toBeNull();
  });

  it("suspends and reactivates with an audit trail", async () => {
    expect((await suspendOrgAction({ workspaceId, reason: "" })).ok).toBe(false);
    expect((await suspendOrgAction({ workspaceId, reason: "Unpaid invoice" })).ok).toBe(true);
    const suspended = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    expect(suspended).toMatchObject({ status: "SUSPENDED", statusReason: "Unpaid invoice" });
    expect(suspended.suspendedAt).not.toBeNull();
    expect((await suspendOrgAction({ workspaceId, reason: "Again please" })).ok).toBe(false);
    expect((await reactivateOrgAction({ workspaceId })).ok).toBe(true);
    expect(await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })).toMatchObject({ status: "ACTIVE", statusReason: null, suspendedAt: null });
    const actions = (await prisma.auditEvent.findMany({ where: { workspaceId } })).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["admin.workspace_suspended", "admin.workspace_reactivated"]));
  });

  it("keeps the last owner and transfers ownership under a lock", async () => {
    expect((await adminChangeRoleAction({ workspaceId, membershipId: ownerMembershipId, role: "ADMIN" })).ok).toBe(false);
    expect((await adminRemoveMemberAction({ workspaceId, membershipId: ownerMembershipId })).ok).toBe(false);
    expect((await transferOwnershipAction({ workspaceId, membershipId: memberMembershipId, demoteOthers: true })).ok).toBe(true);
    const roles = Object.fromEntries((await prisma.membership.findMany({ where: { workspaceId } })).map((m) => [m.userId, m.role]));
    expect(roles).toMatchObject({ [memberId]: "OWNER", [ownerId]: "ADMIN" });
    const event = await prisma.auditEvent.findFirstOrThrow({ where: { workspaceId, action: "admin.ownership_transferred" } });
    expect(event.actorId).toBe(adminId);
    // The synthetic admin never gets a Membership row.
    expect(await prisma.membership.count({ where: { workspaceId, userId: adminId } })).toBe(0);
    expect((await adminChangeRoleAction({ workspaceId, membershipId: memberMembershipId, role: "ADMIN" })).ok).toBe(false);
  });

  it("upserts limits, invalidates the cache and audits numbers only", async () => {
    expect((await getEffectiveLimits(workspaceId)).maxMembers).toBeNull();
    const result = await saveOrgLimitsAction(limits({ maxMembers: 7, maxStorageMb: 10, plan: "Pro", assistantEnabled: "off", modules: { campaigns: "off", "finance.payroll": "off", finance: "on" } }));
    expect(result.ok).toBe(true);
    const effective = await getEffectiveLimits(workspaceId);
    expect(effective).toMatchObject({ maxMembers: 7, maxStorageBytes: 10 * 1024 * 1024, plan: "Pro", assistantEnabled: false });
    expect(effective.disabledModules).toEqual(expect.arrayContaining(["campaigns", "finance.payroll"]));
    const row = await prisma.workspaceLimits.findUniqueOrThrow({ where: { workspaceId } });
    expect(row.updatedById).toBe(adminId);
    expect(row.enabledModules).toContain("finance");
    const event = await prisma.auditEvent.findFirstOrThrow({ where: { workspaceId, action: "admin.workspace_limits_updated" }, orderBy: { createdAt: "desc" } });
    expect(event.metadata).toMatchObject({ maxMembers_from: null, maxMembers_to: 7 });
    expect(JSON.stringify(event.metadata)).not.toMatch(/Pro|campaigns|@/);
    // Emptying a field inherits again.
    await saveOrgLimitsAction(limits());
    expect((await getEffectiveLimits(workspaceId)).maxMembers).toBeNull();
    expect((await saveOrgLimitsAction(limits({ modules: { bogus: "off" } }))).ok).toBe(false);
  });

  it("lists organisations with search by owner email and status filter", async () => {
    const byOwner = await listOrganisations({ q: `member${domain}` });
    expect(byOwner.rows.map((r) => r.slug)).toContain(slug);
    const byStatus = await listOrganisations({ status: "SUSPENDED", q: slug });
    expect(byStatus.rows).toHaveLength(0);
  });

  it("decides queue requests through the shared service", async () => {
    const approveMe = await prisma.orgRequest.create({ data: { kind: "NEW_ORG", requestedById: ownerId, requestedName: "New A2 Org", requestedSlug: `new-${slug}` } });
    const rejectMe = await prisma.orgRequest.create({ data: { kind: "FEATURE", workspaceId, requestedById: ownerId, payload: { module: "campaigns" } } });
    const queue = await listRequests({});
    const ids = queue.rows.map((r) => r.id);
    expect(ids.indexOf(approveMe.id)).toBeLessThan(ids.indexOf(rejectMe.id));

    expect((await decideRequestAction({ requestId: rejectMe.id, decision: "REJECTED" })).ok).toBe(false);
    expect((await decideRequestAction({ requestId: rejectMe.id, decision: "REJECTED", note: "Not this quarter" })).ok).toBe(true);
    expect(await prisma.orgRequest.findUniqueOrThrow({ where: { id: rejectMe.id } })).toMatchObject({ status: "REJECTED", decidedById: adminId, decisionNote: "Not this quarter" });

    const approved = await decideRequestAction({ requestId: approveMe.id, decision: "APPROVED", initialLimits: { maxMembers: 5, maxGuests: null, maxProjects: null, maxStorageMb: null, plan: "Starter" } });
    expect(approved.ok).toBe(true);
    const request = await prisma.orgRequest.findUniqueOrThrow({ where: { id: approveMe.id } });
    expect(request.status).toBe("APPROVED");
    expect(await prisma.workspaceLimits.findUnique({ where: { workspaceId: request.workspaceId! } })).toMatchObject({ maxMembers: 5, plan: "Starter" });
    expect((await decideRequestAction({ requestId: approveMe.id, decision: "APPROVED" })).ok).toBe(false);
  });
});
