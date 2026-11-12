import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const sessionUser = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth", () => ({ auth: async () => (sessionUser.id ? { user: { id: sessionUser.id } } : null) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: () => undefined }));
vi.mock("@/lib/assistant/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/assistant/client")>();
  const message = { id: "m", type: "message", role: "assistant", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 30, output_tokens: 12 } };
  return {
    ...actual,
    getAssistantConfig: async () => ({ apiKey: "k", model: "claude-opus-5-5", jobModel: "claude-haiku-5-5" }),
    createAnthropicClient: () => ({ beta: { messages: { stream: () => ({ async *[Symbol.asyncIterator]() {}, finalMessage: async () => message }) } } }),
  };
});

import { prisma } from "@/lib/db";
import { invalidateLimits } from "@/lib/limits";
import { acceptInvitation, createInvitation } from "@/lib/invitations";
import { createInvitationToken, invitationExpiry } from "@/lib/invitationTokens";
import { changeMemberRole, setMemberStatus } from "@/lib/membership";
import { createProject } from "@/lib/projects/service";
import { deleteObjects, uploadWorkspaceFile } from "@/lib/storage";
import { createApiTokenAction } from "@/app/actions/apiTokens";
import { updateRouting } from "@/app/actions/notificationRouting";
import { createBoardroomSessionAction } from "@/app/actions/boardroom";
import { runBoardroomSession } from "@/lib/assistant/boardroom";
import { runChatTurn, type ChatStreamEvent } from "@/lib/assistant/chat";
import { workspaceUsage } from "@/lib/limits/usage";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@lme-${suffix}.test`;
const slug = `lme-${suffix}`;
let workspaceId: string;
let ownerId: string;
let ownerMembership: Awaited<ReturnType<typeof addMember>>;
const keys: string[] = [];

async function setLimits(data: Record<string, unknown>) {
  await prisma.workspaceLimits.upsert({ where: { workspaceId }, create: { workspaceId, ...data }, update: data });
  invalidateLimits(workspaceId);
}
const invite = (email: string, role: "MEMBER" | "GUEST" = "MEMBER") =>
  createInvitation({ workspace: { id: workspaceId, name: "Kochi" }, email: `${email}${domain}`, role, invitedBy: { id: ownerId, name: "Owner" } });
async function seedInvitation(email: string) {
  const { token, tokenHash } = createInvitationToken();
  await prisma.invitation.create({ data: { workspaceId, email: `${email}${domain}`, role: "MEMBER", tokenHash, expiresAt: invitationExpiry(), invitedById: ownerId } });
  return token;
}
async function chatOnce(conversationId: string) {
  const events: ChatStreamEvent[] = [];
  const workspace = { id: workspaceId, slug, name: "Kochi", timezone: "UTC", currency: "INR", financeVisibleToMembers: false };
  await runChatTurn({ principal: { kind: "user", workspace, userId: ownerId, userName: "Owner", role: "OWNER" }, conversationId, text: "hello", emit: (e) => events.push(e) });
  return events;
}

describe.sequential("limits enforcement", () => {
  beforeAll(async () => {
    ownerId = (await createUser(`owner${domain}`, "Owner")).id;
    workspaceId = (await createWorkspace(slug, ownerId)).id;
    ownerMembership = await prisma.membership.findFirstOrThrow({ where: { workspaceId, userId: ownerId } });
  });
  beforeEach(async () => {
    vi.stubEnv("S3_BUCKET", "");
    sessionUser.id = "";
    await prisma.workspaceLimits.deleteMany({ where: { workspaceId } });
    invalidateLimits(workspaceId);
  });
  afterAll(async () => {
    await deleteObjects(keys).catch(() => undefined);
    await prisma.outboxMessage.deleteMany({ where: { payload: { path: ["to"], string_contains: domain } } });
    await cleanup([slug], domain);
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  it("caps members on invite, counting pending invitations, and lets a re-invite replace its own", async () => {
    await setLimits({ maxMembers: 3 });
    expect((await invite("m1")).ok).toBe(true);
    expect((await invite("m2")).ok).toBe(true);
    expect(await invite("m3")).toMatchObject({ ok: false, error: expect.stringContaining("member limit (3)") });
    expect((await invite("m2")).ok).toBe(true);
    expect((await invite("g1", "GUEST")).ok).toBe(true);
    await prisma.invitation.deleteMany({ where: { workspaceId } });
  });

  it("caps guests on invite", async () => {
    await setLimits({ maxGuests: 1 });
    expect((await invite("g1", "GUEST")).ok).toBe(true);
    expect(await invite("g2", "GUEST")).toMatchObject({ ok: false, error: expect.stringContaining("guest limit (1)") });
    await prisma.invitation.deleteMany({ where: { workspaceId } });
  });

  it("lets only one of two racing acceptances take the last member slot", async () => {
    const tokens = [await seedInvitation("race-a"), await seedInvitation("race-b")];
    await setLimits({ maxMembers: 2 });
    const results = await Promise.all(tokens.map((token, i) => acceptInvitation(token, { kind: "new", name: `Racer ${i}`, password: "correct horse battery" })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ error: expect.stringContaining("member limit (2)") });
    expect((await workspaceUsage(workspaceId)).members).toBe(2);
    expect(await prisma.invitation.count({ where: { workspaceId, acceptedAt: null } })).toBe(1);
    await prisma.membership.deleteMany({ where: { workspaceId, role: "MEMBER" } });
    await prisma.invitation.deleteMany({ where: { workspaceId } });
  });

  it("blocks role changes into a full class and reactivation past the cap; existing rows stay readable", async () => {
    const guest = await addMember(workspaceId, (await createUser(`guest${domain}`)).id, "GUEST");
    const member = await addMember(workspaceId, (await createUser(`mem${domain}`)).id, "MEMBER");
    await setLimits({ maxMembers: 2, maxGuests: 1 });
    expect(await changeMemberRole({ actor: ownerMembership, membershipId: guest.id, role: "MEMBER" })).toMatchObject({ ok: false, error: expect.stringContaining("member limit") });
    expect(await changeMemberRole({ actor: ownerMembership, membershipId: member.id, role: "GUEST" })).toMatchObject({ ok: false, error: expect.stringContaining("guest limit") });
    await setLimits({ maxMembers: 3 });
    expect((await setMemberStatus({ actor: ownerMembership, membershipId: member.id, status: "SUSPENDED" })).ok).toBe(true);
    await setLimits({ maxMembers: 1 });
    expect(await setMemberStatus({ actor: ownerMembership, membershipId: member.id, status: "ACTIVE" })).toMatchObject({ ok: false, error: expect.stringContaining("member limit (1)") });
    expect(await prisma.membership.count({ where: { workspaceId } })).toBe(3);
    expect((await workspaceUsage(workspaceId)).guests).toBe(1);
    await prisma.membership.deleteMany({ where: { workspaceId, role: { not: "OWNER" } } });
  });

  it("caps projects without touching existing ones", async () => {
    const actor = { user: { id: ownerId }, workspace: { id: workspaceId, slug }, membership: { role: "OWNER" } } as never;
    await setLimits({ maxProjects: 1 });
    expect((await createProject(actor, { name: "First", key: "FST" })).ok).toBe(true);
    expect(await createProject(actor, { name: "Second", key: "SND" })).toMatchObject({ ok: false, error: expect.stringContaining("project limit (1)") });
    await setLimits({ maxProjects: 0 });
    expect(await prisma.project.count({ where: { workspaceId } })).toBe(1);
  });

  it("enforces file size and storage quota in uploadWorkspaceFile", async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
    const file = () => new File([new Uint8Array(png)], "pic.png", { type: "image/png" });
    await setLimits({ maxFileBytes: png.length - 1 });
    expect(await uploadWorkspaceFile({ workspaceId, uploadedById: ownerId, file: file() })).toMatchObject({ ok: false, error: expect.stringContaining("limit for one file") });
    await setLimits({ maxFileBytes: png.length, maxStorageBytes: png.length * 2 - 1 });
    const first = await uploadWorkspaceFile({ workspaceId, uploadedById: ownerId, file: file() });
    expect(first.ok).toBe(true);
    if (first.ok) keys.push(first.file.storageKey);
    expect(await uploadWorkspaceFile({ workspaceId, uploadedById: ownerId, file: file() })).toMatchObject({ ok: false, error: expect.stringContaining("storage allowance") });
    expect(await prisma.fileObject.count({ where: { workspaceId } })).toBe(1);
  });

  it("caps API tokens and webhook destinations", async () => {
    sessionUser.id = ownerId;
    await setLimits({ maxApiTokens: 1, maxWebhooks: 1 });
    const token = { name: "ci", scopes: ["read:tasks"], expiresInDays: 30 as const };
    expect((await createApiTokenAction(slug, token)).ok).toBe(true);
    expect(await createApiTokenAction(slug, token)).toMatchObject({ ok: false, error: expect.stringContaining("API token limit (1)") });
    await prisma.notificationDestination.create({ data: { workspaceId, name: "hook", kind: "WEBHOOK", config: {}, enabled: true } });
    expect(await updateRouting(slug, { operation: "destination", data: { name: "Second", kind: "WEBHOOK" } })).toMatchObject({ ok: false, error: expect.stringContaining("webhook limit (1)") });
    expect(await prisma.notificationDestination.count({ where: { workspaceId } })).toBe(1);
  });

  it("refuses the assistant when switched off or over budget, and counts boardroom usage", async () => {
    sessionUser.id = ownerId;
    const conversation = await prisma.assistantConversation.create({ data: { workspaceId, userId: ownerId } });
    const board = { question: "Should we buy a second laser cutter?", rounds: 1, seats: [{ name: "Maker", persona: "Wants every tool available." }, { name: "Treasurer", persona: "Guards the kitty carefully." }] };
    await setLimits({ assistantEnabled: false });
    expect((await chatOnce(conversation.id)).find((e) => e.type === "error")).toMatchObject({ message: expect.stringContaining("switched off") });
    expect(await createBoardroomSessionAction(slug, board)).toMatchObject({ ok: false, error: expect.stringContaining("switched off") });

    await setLimits({ assistantEnabled: true, assistantMonthlyTokens: 100 });
    expect((await chatOnce(conversation.id)).find((e) => e.type === "done")).toBeTruthy();
    expect((await workspaceUsage(workspaceId)).assistantTokensThisMonth).toBe(42);

    // Boardroom: 2 seats + moderator = 3 model calls of 42 tokens each.
    const created = await createBoardroomSessionAction(slug, board);
    expect(created.ok).toBe(true);
    if (!created.ok || !created.data) return;
    expect(await runBoardroomSession(created.data.id)).toBe("done");
    expect((await workspaceUsage(workspaceId)).assistantTokensThisMonth).toBe(42 + 3 * 42);

    // Budget spent: new work is refused, existing data is still there.
    expect((await chatOnce(conversation.id)).find((e) => e.type === "error")).toMatchObject({ message: expect.stringContaining("monthly assistant allowance") });
    expect(await createBoardroomSessionAction(slug, board)).toMatchObject({ ok: false });
    expect(await prisma.boardroomSession.count({ where: { workspaceId, status: "DONE" } })).toBe(1);
    expect(await prisma.assistantMessage.count({ where: { conversationId: conversation.id } })).toBeGreaterThan(0);
    const queued = await prisma.boardroomSession.create({ data: { workspaceId, title: "t", question: "A long enough question?", rounds: 1, createdById: ownerId, seats: { create: [{ name: "a", persona: "persona one", position: 0 }] } }, select: { id: true } });
    expect(await runBoardroomSession(queued.id)).toBe("failed");
  });
});
