import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => ({ mfa: undefined as string | undefined, session: "" }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: (name: string) => (name === "sww.admin-mfa.v1" && request.mfa ? { value: request.mfa } : undefined) }),
}));
vi.mock("@/lib/auth", () => ({ auth: async () => (request.session ? { user: { id: request.session } } : null) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));

import { prisma } from "@/lib/db";
import { getWorkspaceForAction, type WorkspaceContext } from "@/lib/permissions";
import { createSuperAdminMfaProof } from "@/lib/superAdminMfa";
import { activeMemberOrSuperAdmin } from "@/lib/accessMember";
import { financeAccess, FinanceError } from "@/lib/finance/tools/access";
import { analyticsAccess, AnalyticsError } from "@/lib/analytics/access";
import { assertActor as governanceActor } from "@/lib/governance/service/access";
import { assertActor as meetingActor } from "@/lib/meetings/core";
import { controlsAccess } from "@/lib/moneyControls/access";
import { documentsAccess } from "@/lib/documents/access";
import { saveTeam } from "@/lib/teams/teams/mutations";
import { invoiceSchema } from "@/lib/finance/schemas";
import * as finance from "@/lib/finance/service";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@sa-access-${suffix}.test`;
const slug = `sa-access-${suffix}`;
let workspaceId: string;
let superId: string;
let outsiderId: string;
let ctx: WorkspaceContext;

beforeAll(async () => {
  process.env.SUPER_ADMIN_EMAIL = `root${domain}`;
  const ownerId = (await createUser(`owner${domain}`)).id;
  workspaceId = (await createWorkspace(slug, ownerId)).id;
  outsiderId = (await createUser(`out${domain}`)).id;
  await addMember(workspaceId, (await createUser(`member${domain}`)).id, "MEMBER");
  const root = await prisma.user.create({ data: { email: `root${domain}`, name: "Root", emailVerified: new Date(), mfaEnabledAt: new Date() } });
  superId = root.id;
  request.session = superId;
  request.mfa = createSuperAdminMfaProof(superId, root.sessionVersion);
  ctx = (await getWorkspaceForAction(slug))!;
}, 60_000);

afterAll(async () => {
  await cleanup([slug], domain);
  await prisma.$disconnect();
});

describe.sequential("super admin silent access across per-area helpers", () => {
  it("gets a synthetic OWNER context with no membership row", async () => {
    expect(ctx.membership).toMatchObject({ role: "OWNER", viaSuperAdmin: true, id: "" });
    expect(await prisma.membership.count({ where: { workspaceId, userId: superId } })).toBe(0);
  });

  it("views and manages finance", async () => {
    await expect(financeAccess(ctx, "VIEW")).resolves.toBeTruthy();
    await expect(financeAccess(ctx, "MANAGE")).resolves.toBeTruthy();
    await expect(financeAccess(ctx, "OWNER")).resolves.toBeTruthy();
    const values = invoiceSchema.parse({ clientName: "Maker partner", clientEmail: `client${domain}`, issuedOn: "2026-10-01", dueOn: "2026-10-18", items: [{ description: "Workshop", quantity: 1, unitPrice: "100" }] });
    expect((await finance.createInvoice(ctx, values)).ok).toBe(true);
  });

  it("views and manages analytics, controls, governance, meetings and documents", async () => {
    expect(await analyticsAccess(ctx)).toMatchObject({ role: "OWNER", admin: true, finance: true });
    expect((await controlsAccess(ctx)).manage).toBe(true);
    await expect(governanceActor(ctx)).resolves.toBeUndefined();
    await expect(meetingActor(ctx)).resolves.toBeUndefined();
    await expect(documentsAccess(ctx)).resolves.toBeTruthy();
  });

  it("manages people and teams", async () => {
    expect((await saveTeam(ctx, { name: "Fabrication crew", visibility: "PUBLIC" }, null)).ok).toBe(true);
  });

  it("views and manages payroll without a grant, while a real owner still needs one", async () => {
    await expect(financeAccess(ctx, "PAY_VIEW")).resolves.toMatchObject({ payrollView: true, payrollManage: true });
    await expect(financeAccess(ctx, "PAY_MANAGE")).resolves.toBeTruthy();
    const owner = await prisma.membership.findFirstOrThrow({ where: { workspaceId, role: "OWNER" }, include: { user: { select: { id: true, name: true } } } });
    await expect(financeAccess({ user: owner.user, workspace: ctx.workspace, membership: owner }, "PAY_VIEW")).rejects.toBeInstanceOf(FinanceError);
  });

  it("refuses an archived workspace even for the super admin context", async () => {
    await prisma.workspace.update({ where: { id: workspaceId }, data: { archivedAt: new Date() } });
    try {
      expect(await activeMemberOrSuperAdmin(prisma, ctx)).toBeNull();
      await expect(financeAccess(ctx, "VIEW")).rejects.toBeInstanceOf(FinanceError);
    } finally {
      await prisma.workspace.update({ where: { id: workspaceId }, data: { archivedAt: null } });
    }
  });

  it("does not give a non-member the same access, nor trust a forged flag-less actor", async () => {
    const stranger = { user: { id: outsiderId, name: null }, workspace: ctx.workspace, membership: { role: "OWNER" as const } };
    await expect(financeAccess(stranger, "VIEW")).rejects.toBeInstanceOf(FinanceError);
    await expect(analyticsAccess(stranger)).rejects.toBeInstanceOf(AnalyticsError);
    await expect(governanceActor(stranger)).rejects.toThrow();
    // The super admin without a fresh MFA proof is an ordinary non-member.
    request.mfa = undefined;
    request.session = outsiderId;
    expect(await getWorkspaceForAction(slug)).toBeNull();
    request.session = superId;
    expect(await getWorkspaceForAction(slug)).toBeNull();
  });
});
