import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getEffectiveLimits, invalidateLimits } from "@/lib/limits";
import { assertWithinLimit } from "@/lib/limits/enforce";
import { getWorkspaceModules } from "@/lib/limits/modules";
import { workspaceUsage } from "@/lib/limits/usage";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@lim-${suffix}.test`;
const slug = `lim-${suffix}`;
let workspaceId: string;
let ownerId: string;

describe.sequential("limits and usage", () => {
  beforeAll(async () => {
    ownerId = (await createUser(`owner${domain}`)).id;
    workspaceId = (await createWorkspace(slug, ownerId)).id;
    await addMember(workspaceId, (await createUser(`g${domain}`)).id, "GUEST");
    const suspended = await addMember(workspaceId, (await createUser(`s${domain}`)).id, "MEMBER");
    await prisma.membership.update({ where: { id: suspended.id }, data: { status: "SUSPENDED" } });
  });

  afterAll(async () => {
    await cleanup([slug], domain);
    await prisma.$disconnect();
  });

  it("counts members, guests, projects, storage and tokens", async () => {
    await prisma.project.createMany({ data: [{ workspaceId, key: "AAA", name: "A" }, { workspaceId, key: "BBB", name: "B", status: "ARCHIVED" }] });
    const file = await prisma.fileObject.create({ data: { workspaceId, storageKey: `k-${suffix}-1`, filename: "a.txt", contentType: "text/plain", size: 100, deletedAt: new Date() } });
    await prisma.fileVersion.createMany({ data: [
      { fileId: file.id, version: 1, storageKey: `k-${suffix}-0`, size: 40, contentType: "text/plain" },
      { fileId: file.id, version: 2, storageKey: `k-${suffix}-1`, size: 100, contentType: "text/plain" },
    ] });
    await prisma.apiToken.createMany({ data: [{ workspaceId, name: "t1", prefix: `p1-${suffix}`, secretHash: "x" }, { workspaceId, name: "t2", prefix: `p2-${suffix}`, secretHash: "x", revokedAt: new Date() }] });
    const usage = await workspaceUsage(workspaceId);
    expect(usage).toMatchObject({ members: 1, guests: 1, projects: 1, storageBytes: 140, apiTokens: 1, webhooks: 0, assistantTokensThisMonth: 0, emailsThisMonth: 0 });
  });

  it("sums assistant tokens this month only", async () => {
    const conversation = await prisma.assistantConversation.create({ data: { workspaceId, userId: ownerId } });
    const old = new Date(Date.UTC(2020, 0, 5));
    await prisma.assistantMessage.createMany({ data: [
      { conversationId: conversation.id, role: "ASSISTANT", content: [], tokensIn: 10, tokensOut: 5 },
      { conversationId: conversation.id, role: "ASSISTANT", content: [], tokensIn: 99, tokensOut: 99, createdAt: old },
    ] });
    expect((await workspaceUsage(workspaceId)).assistantTokensThisMonth).toBe(15);
  });

  it("enforces an override and merges modules", async () => {
    expect(await assertWithinLimit("members", workspaceId)).toEqual({ ok: true });
    await prisma.workspaceLimits.create({ data: { workspaceId, maxMembers: 1, disabledModules: ["vault"] } });
    invalidateLimits(workspaceId);
    expect((await getEffectiveLimits(workspaceId)).maxMembers).toBe(1);
    expect(await assertWithinLimit("members", workspaceId)).toMatchObject({ ok: false });
    expect(await assertWithinLimit("guests", workspaceId)).toEqual({ ok: true });
    expect((await getWorkspaceModules(workspaceId)).disabledModules).toContain("vault");
  });
});
