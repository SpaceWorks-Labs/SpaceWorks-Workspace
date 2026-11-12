import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => ({ path: null as string | null, mfa: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(request.path ? { "x-sw-path": request.path } : {}),
  cookies: async () => ({ get: (name: string) => (name === "sww.admin-mfa.v1" && request.mfa ? { value: request.mfa } : undefined) }),
}));
vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import { listAuditEvents } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { invalidateLimits } from "@/lib/limits";
import { findWorkspaceForUser } from "@/lib/permissions";
import { createSuperAdminMfaProof } from "@/lib/superAdminMfa";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@gate-${suffix}.test`;
const slug = `gate-${suffix}`;
let workspaceId: string;
let ownerId: string;
let memberId: string;
let adminId: string;
let superId: string;
let outsiderId: string;
const base = `/w/${slug}`;

const setStatus = async (status: "ACTIVE" | "PENDING" | "REJECTED" | "SUSPENDED") => {
  await prisma.workspace.update({ where: { id: workspaceId }, data: { status } });
};

describe.sequential("workspace status, module and super-admin gates", () => {
  beforeAll(async () => {
    process.env.SUPER_ADMIN_EMAIL = `root${domain}`;
    ownerId = (await createUser(`owner${domain}`)).id;
    workspaceId = (await createWorkspace(slug, ownerId)).id;
    memberId = (await createUser(`member${domain}`)).id;
    adminId = (await createUser(`admin${domain}`)).id;
    outsiderId = (await createUser(`out${domain}`)).id;
    await addMember(workspaceId, memberId, "MEMBER");
    await addMember(workspaceId, adminId, "ADMIN");
    superId = (await prisma.user.create({ data: { email: `root${domain}`, name: "Root", emailVerified: new Date(), mfaEnabledAt: new Date() } })).id;
  });

  beforeEach(async () => {
    request.path = `${base}/projects`;
    request.mfa = undefined;
    await setStatus("ACTIVE");
    await prisma.workspaceLimits.deleteMany({ where: { workspaceId } });
    invalidateLimits(workspaceId);
  });

  afterAll(async () => {
    await cleanup([slug], domain);
    await prisma.$disconnect();
  });

  it("hides pending and rejected workspaces from everyone", async () => {
    for (const status of ["PENDING", "REJECTED"] as const) {
      await setStatus(status);
      expect(await findWorkspaceForUser(slug, ownerId)).toBeNull();
      expect(await findWorkspaceForUser(slug, memberId)).toBeNull();
    }
  });

  it("lets only owners and admins reach settings and plan when suspended", async () => {
    await setStatus("SUSPENDED");
    request.path = `${base}/settings/plan`;
    expect(await findWorkspaceForUser(slug, ownerId)).not.toBeNull();
    expect(await findWorkspaceForUser(slug, adminId)).not.toBeNull();
    expect(await findWorkspaceForUser(slug, memberId)).toBeNull();
    request.path = `${base}/settings`;
    expect(await findWorkspaceForUser(slug, ownerId)).not.toBeNull();
    request.path = `${base}/projects`;
    expect(await findWorkspaceForUser(slug, ownerId)).toBeNull();
    request.path = null;
    expect(await findWorkspaceForUser(slug, ownerId)).toBeNull();
  });

  it("gates disabled modules by path or option, never core", async () => {
    await prisma.workspaceLimits.create({ data: { workspaceId, disabledModules: ["projects", "finance"] } });
    invalidateLimits(workspaceId);
    expect(await findWorkspaceForUser(slug, memberId)).toBeNull();
    request.path = `${base}/members`;
    expect(await findWorkspaceForUser(slug, memberId)).not.toBeNull();
    expect(await findWorkspaceForUser(slug, memberId, { module: "finance" })).toBeNull();
    expect(await findWorkspaceForUser(slug, memberId, { module: "core" })).not.toBeNull();
    request.path = `${base}/chat`;
    expect(await findWorkspaceForUser(slug, memberId)).not.toBeNull();
  });

  it("gives the super admin silent access without a membership row, audited once", async () => {
    const before = await prisma.auditEvent.count({ where: { workspaceId, action: "admin.workspace_accessed" } });
    expect(await findWorkspaceForUser(slug, superId)).toBeNull();
    request.mfa = createSuperAdminMfaProof(superId, 0);
    const hit = await findWorkspaceForUser(slug, superId);
    expect(hit?.membership).toMatchObject({ role: "OWNER", status: "ACTIVE", viaSuperAdmin: true });
    await findWorkspaceForUser(slug, superId);
    expect(await prisma.membership.count({ where: { workspaceId, userId: superId } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { workspaceId, action: "admin.workspace_accessed", actorId: superId } })).toBe(before + 1);
    expect((await listAuditEvents(workspaceId, { take: 200 })).some((event) => event.action === "admin.workspace_accessed")).toBe(false);
    await setStatus("PENDING");
    expect(await findWorkspaceForUser(slug, superId)).not.toBeNull();
  });

  it("does not change access for other non-members", async () => {
    request.mfa = createSuperAdminMfaProof(outsiderId, 0);
    expect(await findWorkspaceForUser(slug, outsiderId)).toBeNull();
    expect((await findWorkspaceForUser(slug, memberId))?.membership.viaSuperAdmin).toBeUndefined();
  });

  it("elevates the super admin over a lower real membership, only with a valid proof", async () => {
    await addMember(workspaceId, superId, "MEMBER");
    expect((await findWorkspaceForUser(slug, superId))?.membership.viaSuperAdmin).toBeUndefined();
    request.mfa = createSuperAdminMfaProof(superId, 0);
    expect((await findWorkspaceForUser(slug, superId))?.membership).toMatchObject({ role: "OWNER", viaSuperAdmin: true });
    await prisma.membership.update({ where: { userId_workspaceId: { userId: superId, workspaceId } }, data: { role: "OWNER" } });
    expect((await findWorkspaceForUser(slug, superId))?.membership.viaSuperAdmin).toBeUndefined();
    await prisma.membership.delete({ where: { userId_workspaceId: { userId: superId, workspaceId } } });
  });

  it("retries the access audit after a failed write", async () => {
    const audit = await import("@/lib/audit");
    const spy = vi.spyOn(audit, "recordAuditEvent").mockRejectedValueOnce(new Error("db down"));
    const count = () => prisma.auditEvent.count({ where: { workspaceId, action: "admin.workspace_accessed", actorId: superId } });
    const before = await count();
    request.mfa = createSuperAdminMfaProof(superId, 0);
    await prisma.auditEvent.deleteMany({ where: { workspaceId, action: "admin.workspace_accessed", actorId: superId } });
    (globalThis as Record<symbol, Map<string, number> | undefined>)[Symbol.for("sww.superAdminAccess")]?.clear();
    expect(await findWorkspaceForUser(slug, superId)).not.toBeNull();
    expect(await count()).toBe(0);
    expect(await findWorkspaceForUser(slug, superId)).not.toBeNull();
    expect(await count()).toBe(1);
    spy.mockRestore();
    void before;
  });
});
