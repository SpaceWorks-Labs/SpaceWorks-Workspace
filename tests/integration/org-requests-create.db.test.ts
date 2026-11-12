import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { cancelOrgRequest, createOrgRequest, listRequestsForUser, listRequestsForWorkspace } from "@/lib/orgRequests/service";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@orq-${suffix}.test`;
const slugs = [`orq-a-${suffix}`, `orq-b-${suffix}`, `orq-c-${suffix}`, `orq-d-${suffix}`, `orq-e-${suffix}`, `orq-f-${suffix}`, `orq-auto-${suffix}`, `orq-lim-${suffix}`];
let userId: string;
let ownerId: string;
let memberId: string;
let workspaceId: string;

async function setSetting(key: string, value: string | null) {
  if (value === null) await prisma.instanceSetting.deleteMany({ where: { key } });
  else await prisma.instanceSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

describe.sequential("organisation requests: creating", () => {
  beforeAll(async () => {
    process.env.SUPER_ADMIN_EMAIL = `root${domain}`;
    userId = (await createUser(`req${domain}`)).id;
    ownerId = (await createUser(`own${domain}`)).id;
    memberId = (await createUser(`mem${domain}`)).id;
    workspaceId = (await createWorkspace(`orq-ws-${suffix}`, ownerId)).id;
    slugs.push(`orq-ws-${suffix}`);
    await addMember(workspaceId, memberId, "MEMBER");
  });

  afterAll(async () => {
    await setSetting("workspaces.requireApproval", null);
    await setSetting("limits.maxWorkspacesPerOwner", null);
    await prisma.orgRequest.deleteMany({ where: { requestedBy: { email: { endsWith: domain } } } });
    await cleanup(slugs, domain);
    await prisma.$disconnect();
  });

  it("creates a pending request and emails the super admin without a bearer token", async () => {
    const result = await createOrgRequest(userId, { kind: "NEW_ORG", name: "Org A", slug: slugs[0]!, message: "We need it" });
    expect(result).toMatchObject({ ok: true, data: { status: "PENDING" } });
    const mail = await prisma.outboxMessage.findFirst({ where: { kind: "email", payload: { path: ["to"], equals: `root${domain}` } } });
    expect(JSON.stringify(mail?.payload)).toContain("/admin/requests");
    expect(await prisma.workspace.findUnique({ where: { slug: slugs[0]! } })).toBeNull();
  });

  it("rejects reserved, invalid, taken and already-requested slugs", async () => {
    for (const slug of ["admin", "Bad Slug!", `orq-ws-${suffix}`, slugs[0]!]) {
      const result = await createOrgRequest(userId, { kind: "NEW_ORG", name: "Dup", slug, message: null });
      expect(result.ok, slug).toBe(false);
    }
  });

  it("caps pending requests at 3 per user and frees a slot on cancel", async () => {
    expect((await createOrgRequest(userId, { kind: "NEW_ORG", name: "Org B", slug: slugs[1]! })).ok).toBe(true);
    expect((await createOrgRequest(userId, { kind: "NEW_ORG", name: "Org C", slug: slugs[2]! })).ok).toBe(true);
    const over = await createOrgRequest(userId, { kind: "NEW_ORG", name: "Org D", slug: slugs[3]! });
    expect(over).toMatchObject({ ok: false });
    const mine = await listRequestsForUser(userId);
    expect(await cancelOrgRequest(userId, mine[0]!.id)).toMatchObject({ ok: true });
    expect(await cancelOrgRequest(userId, mine[0]!.id)).toMatchObject({ ok: false });
    expect((await createOrgRequest(userId, { kind: "NEW_ORG", name: "Org D", slug: slugs[3]! })).ok).toBe(true);
  });

  it("enforces limits.maxWorkspacesPerOwner including pending requests", async () => {
    await setSetting("limits.maxWorkspacesPerOwner", "1");
    // The owner already owns one active workspace.
    const result = await createOrgRequest(ownerId, { kind: "NEW_ORG", name: "Too many", slug: slugs[4]! });
    expect(result).toMatchObject({ ok: false });
    await setSetting("limits.maxWorkspacesPerOwner", null);
  });

  it("creates the workspace at once when approval is off", async () => {
    await setSetting("workspaces.requireApproval", "false");
    const auto = await createUser(`auto${domain}`);
    const result = await createOrgRequest(auto.id, { kind: "NEW_ORG", name: "Auto", slug: slugs[6]! });
    expect(result).toMatchObject({ ok: true, data: { status: "APPROVED", workspaceSlug: slugs[6] } });
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { slug: slugs[6]! }, include: { memberships: true } });
    expect(workspace.status).toBe("ACTIVE");
    expect(workspace.memberships[0]).toMatchObject({ userId: auto.id, role: "OWNER" });
    await setSetting("workspaces.requireApproval", null);
  });

  it("limits MORE_LIMIT and FEATURE requests to owners and caps 5 pending", async () => {
    expect(await createOrgRequest(memberId, { kind: "FEATURE", workspaceId, module: "vault" })).toMatchObject({ ok: false });
    expect(await createOrgRequest(ownerId, { kind: "FEATURE", workspaceId, module: "nope" })).toMatchObject({ ok: false });
    expect(await createOrgRequest(ownerId, { kind: "MORE_LIMIT", workspaceId, limit: "maxMembers", requested: 50 })).toMatchObject({ ok: true });
    expect(await createOrgRequest(ownerId, { kind: "MORE_LIMIT", workspaceId, limit: "maxMembers", requested: 60 })).toMatchObject({ ok: false });
    for (const key of ["vault", "secrets", "finance", "campaigns"]) {
      expect(await createOrgRequest(ownerId, { kind: "FEATURE", workspaceId, module: key })).toMatchObject({ ok: true });
    }
    expect(await createOrgRequest(ownerId, { kind: "FEATURE", workspaceId, module: "social" })).toMatchObject({ ok: false });
    expect(await listRequestsForWorkspace(workspaceId)).toHaveLength(5);
  });
});
