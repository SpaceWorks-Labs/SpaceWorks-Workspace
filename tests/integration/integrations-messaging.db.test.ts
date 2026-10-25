import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import type { MessagingConnection } from "@prisma/client";
import type { WorkspaceContext } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";
import { hasRoleAtLeast } from "@/lib/roles";
const auth = vi.hoisted(() => ({ context: null as WorkspaceContext | null }));
vi.mock("@/lib/permissions", () => ({ getWorkspaceForAction: vi.fn(async (_slug: string, role: Parameters<typeof hasRoleAtLeast>[1]) => auth.context && hasRoleAtLeast(auth.context.membership.role, role) ? auth.context : null) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { updateRouting } from "@/app/actions/notificationRouting";
import { updateMessaging } from "@/app/actions/messaging";
import { updateIntegrations } from "@/app/actions/integrations";
import { saveDestination, saveRule } from "@/lib/integrations/routing/service";
import { sendRoutingReminders } from "@/lib/integrations/routing/reminders";
import { syncSeoSite, runSeoAudit } from "@/lib/seo/service";
import { dispatch, sendTest } from "@/lib/notify";
import { deliverOutboxBatch } from "@/lib/outbox";
import { newLinkCode, redeemLinkCode } from "@/lib/messaging/linking";
import { inboundRequest, type InboundMessage } from "@/lib/messaging/inbound";
import { processInboundBatch, processInboundMessage } from "@/lib/messaging/processor";
import { bridgeInbound, bridgeOutbound } from "@/lib/messaging/bridging";
import { beginGoogle, consumeOAuthState, completeGoogle } from "@/lib/integrations/google/oauth";
import { encryptSecret, sha256Hex } from "@/lib/crypto";
import { receiveGithub, dispatchGithubEvents } from "@/lib/integrations/github/webhook";
import { whatsappAdapter } from "@/lib/notify/adapters/whatsapp";
import { registerMessagingAssistantRunner } from "@/lib/integrations/assistant";
import type { AdapterSendInput } from "@/lib/notify/adapters/types";
const suffix = uniqueSuffix(); const domain = `@integrations-${suffix}.test`; const slug = `int-${suffix}`; const foreignSlug = `int-other-${suffix}`;
let workspaceId: string; let foreignId: string; let ownerId: string; let memberId: string; let guestId: string; let channelId: string; let connection: MessagingConnection; let destinationId: string;
const fetchMock = vi.fn<typeof fetch>();
async function actAs(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  const membership = await prisma.membership.findFirstOrThrow({ where: { workspaceId, userId } });
  auth.context = { user, workspace, membership };
}
const inbound = (text = "hello"): InboundMessage => ({ eventId: "e1", userId: "101", channelId: "101", messageId: "1", text, private: true, mention: false, bot: false });
async function codeFor(userId = memberId) { const c = newLinkCode(); await prisma.linkCode.create({ data: { workspaceId, userId, connectionId: connection.id, provider: "TELEGRAM", codeHash: c.codeHash, expiresAt: c.expiresAt } }); return c; }
function request(update: number, text: string, token = "webhook-secret") { return new Request("https://workspace.example.org/events", { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": token }, body: JSON.stringify({ update_id: update, message: { message_id: update, from: { id: 101 }, chat: { id: 101, type: "private" }, text } }) }); }
describe.sequential("integrations messaging", () => {
  beforeAll(async () => {
    ownerId = (await createUser(`owner${domain}`)).id; memberId = (await createUser(`member${domain}`)).id; guestId = (await createUser(`guest${domain}`)).id;
    workspaceId = (await createWorkspace(slug, ownerId)).id; foreignId = (await createWorkspace(foreignSlug, ownerId)).id;
    await addMember(workspaceId, memberId); await addMember(workspaceId, guestId, "GUEST");
    channelId = (await prisma.channel.findFirstOrThrow({ where: { workspaceId, slug: "general" } })).id;
    connection = await prisma.messagingConnection.create({ data: { workspaceId, provider: "TELEGRAM", label: "Crew bot", credentialsEnc: encryptSecret("messaging-credentials", JSON.stringify({ botToken: "123:TEST", webhookSecret: "webhook-secret" })), lastVerifiedAt: new Date(), botExternalId: "999" } });
  });
  beforeEach(async () => { await actAs(ownerId); vi.stubEnv("ALLOW_PRIVATE_WEBHOOK_TARGETS", "true"); vi.stubGlobal("fetch", fetchMock.mockImplementation(async () => Response.json({ ok: true, result: { message_id: 42 } }))); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); fetchMock.mockReset(); });
  afterAll(async () => { await cleanup([slug, foreignSlug], domain); await prisma.$disconnect(); }, 30000);
  it("denies routing changes to members and guests", async () => {
    for (const user of [memberId, guestId]) { await actAs(user); expect(await updateRouting(slug, { operation: "destination", data: { name: "No", kind: "EMAIL", config: { to: ["test@example.org"] } } })).toMatchObject({ ok: false }); }
    expect(await prisma.notificationDestination.count({ where: { workspaceId } })).toBe(0);
  });
  it("saves encrypted write-only destination secrets with an audit event", async () => {
    destinationId = await saveDestination(workspaceId, ownerId, { name: "Signed receiver", kind: "WEBHOOK", config: {}, secrets: { webhookUrl: "https://hooks.example.org/private", signingSecret: "receiver-signing-secret" } });
    const row = await prisma.notificationDestination.findFirstOrThrow({ where: { workspaceId, id: destinationId } });
    expect(row.secretEnc).not.toContain("receiver-signing-secret"); expect(JSON.stringify(row.config)).not.toContain("/private");
    expect(await prisma.auditEvent.count({ where: { workspaceId, targetId: destinationId, action: "integrations.destination_saved" } })).toBe(1);
  });
  it("preserves saved secrets when editing a name", async () => {
    const before = await prisma.notificationDestination.findUniqueOrThrow({ where: { id: destinationId } });
    await saveDestination(workspaceId, ownerId, { id: destinationId, name: "Renamed receiver", kind: "WEBHOOK", config: {}, secrets: {} });
    const after = await prisma.notificationDestination.findUniqueOrThrow({ where: { id: destinationId } });
    expect(after.secretEnc).not.toBeNull(); expect(before.name).not.toBe(after.name);
  });
  it("rejects foreign channels, connections, destinations and filters", async () => {
    const otherChannel = await prisma.channel.findFirstOrThrow({ where: { workspaceId: foreignId } });
    await expect(saveDestination(workspaceId, ownerId, { name: "Foreign channel", kind: "WORKSPACE_CHANNEL", config: { channelId: otherChannel.id } })).rejects.toThrow("this workspace");
    await expect(saveDestination(foreignId, ownerId, { name: "Foreign bot", kind: "TELEGRAM", connectionId: connection.id, config: { chatId: "101" } })).rejects.toThrow("this workspace");
    await expect(saveRule(foreignId, ownerId, { name: "Foreign rule", eventTypes: ["*"], destinationIds: [destinationId], minSeverity: "INFO", dedupeWindowSec: 0, reminderIntervalMin: 0 })).rejects.toThrow("this workspace");
  });
  it("cannot edit a foreign destination or test or delete it through actions", async () => {
    const other = await prisma.notificationDestination.create({ data: { workspaceId: foreignId, name: "Other", kind: "EMAIL", config: { to: ["test@example.org"] } } });
    expect(await updateRouting(slug, { operation: "test", id: other.id })).toMatchObject({ ok: false });
    await updateRouting(slug, { operation: "deleteDestination", id: other.id });
    expect(await prisma.notificationDestination.count({ where: { workspaceId: foreignId, id: other.id } })).toBe(1);
    await expect(saveDestination(workspaceId, ownerId, { id: other.id, name: "Stolen", kind: "EMAIL", config: { to: ["x@example.org"] } })).rejects.toThrow("not found");
  });
  it("allows an admin to save routing through the action and prevents a second Telegram bot", async () => {
    expect(await updateRouting(slug, { operation: "destination", data: { name: "Admin email", kind: "EMAIL", config: { to: ["admin@example.org"] } } })).toMatchObject({ ok: true });
    const result = await updateMessaging(slug, { operation: "save", data: { provider: "TELEGRAM", label: "Another bot", credentials: { botToken: "123:TEST" }, config: {} } });
    expect(result).toMatchObject({ ok: false }); expect(await prisma.messagingConnection.count({ where: { workspaceId, provider: "TELEGRAM" } })).toBe(1);
  });
  it("sends through the outbox and honours a provider 429 before a successful retry", async () => {
    const sent = await sendTest(workspaceId, destinationId, ownerId); const deliveryId = sent.deliveries[0]!.id!;
    const job = await prisma.outboxMessage.findFirstOrThrow({ where: { kind: "notify.deliver", payload: { path: ["deliveryId"], equals: deliveryId } } });
    fetchMock.mockReset().mockResolvedValueOnce(new Response("slow", { status: 429, headers: { "Retry-After": "45" } }));
    await deliverOutboxBatch(20, { ids: [job.id] });
    const retry = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
    expect(retry).toMatchObject({ status: "PENDING", attempts: 1 }); expect(retry.nextAttemptAt!.getTime() - retry.lastAttemptAt!.getTime()).toBe(45000);
    await prisma.outboxMessage.update({ where: { id: job.id }, data: { availableAt: new Date(0) } });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await deliverOutboxBatch(20, { ids: [job.id] }); expect(await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: deliveryId } })).toMatchObject({ status: "SENT", attempts: 2 });
  });
  it("persists editor rating and severity filters and routes only matching review events", async () => {
    await actAs(ownerId);
    const result = await updateRouting(slug, { operation: "rule", data: { name: "Low ratings", eventTypes: ["app_review.*"], minSeverity: "WARNING", filters: { ratings: [1, 2] }, destinationIds: [destinationId], dedupeWindowSec: 0, reminderIntervalMin: 0 } });
    expect(result.ok).toBe(true);
    const saved = await prisma.notificationRule.findFirstOrThrow({ where: { workspaceId, name: "Low ratings" } });
    expect(saved).toMatchObject({ minSeverity: "WARNING", filters: { ratings: [1, 2] } });
    for (const [rating, severity, expected] of [[1, "warning", 1], [2, "critical", 1], [5, "warning", 0], [1, "info", 0]] as const) {
      const sent = await dispatch(workspaceId, { type: "app_review.received", title: "Review filter fixture", severity, scope: { rating }, data: { app: "Fixture", platform: "APPLE", rating, author: "Member", excerpt: "Feedback", link: `/w/${slug}/app-reviews` } });
      expect(sent.deliveries.filter(d => d.target === `destination:${destinationId}`)).toHaveLength(expected);
    }
    await expect(saveRule(workspaceId, ownerId, { name: "Invalid rating", eventTypes: ["app_review.*"], minSeverity: "INFO", filters: { ratings: [6] }, destinationIds: [destinationId], dedupeWindowSec: 0, reminderIntervalMin: 0 })).rejects.toThrow();
  });
  it("fails closed on an invalid inbound token before storing any payload", async () => {
    expect((await inboundRequest(request(1, "secret", "wrong"), "telegram", connection.id)).status).toBe(401);
    expect(await prisma.inboundEvent.count({ where: { connectionId: connection.id } })).toBe(0);
  });
  it("deduplicates inbound events and never stores the raw linking capability", async () => {
    const code = await codeFor();
    expect((await inboundRequest(request(2, `/link ${code.code}`), "telegram", connection.id)).status).toBe(200);
    expect((await inboundRequest(request(2, `/link ${code.code}`), "telegram", connection.id)).status).toBe(200);
    const rows = await prisma.inboundEvent.findMany({ where: { connectionId: connection.id, externalEventId: "2" } });
    expect(rows).toHaveLength(1); expect(JSON.stringify(rows)).not.toContain(code.code);
    await processInboundBatch();
    expect(await prisma.externalIdentityLink.findFirst({ where: { workspaceId, userId: memberId, connectionId: connection.id } })).toMatchObject({ externalUserId: "101", dmChannelId: "101" });
  });
  it("makes link codes single use, expiring and connection scoped", async () => {
    const code = await codeFor(ownerId); expect(await redeemLinkCode({ ...connection, workspaceId: foreignId }, code.code, "202", "202")).toBe(false);
    expect(await redeemLinkCode(connection, code.code, "202", "202")).toBe(true); expect(await redeemLinkCode(connection, code.code, "202", "202")).toBe(false);
    const expired = await codeFor(ownerId); await prisma.linkCode.updateMany({ where: { codeHash: expired.codeHash }, data: { expiresAt: new Date(0) } }); expect(await redeemLinkCode(connection, expired.code, "202", "202")).toBe(false);
  });
  it("rejects suspended member linking and identity reassignment", async () => {
    const code = await codeFor(ownerId); expect(await redeemLinkCode(connection, code.code, "101", "101")).toBe(false);
    await prisma.membership.updateMany({ where: { workspaceId, userId: memberId }, data: { status: "SUSPENDED" } });
    const suspended = await codeFor(); expect(await redeemLinkCode(connection, suspended.code, "303", "303")).toBe(false);
    await prisma.membership.updateMany({ where: { workspaceId, userId: memberId }, data: { status: "ACTIVE" } });
  });
  it("members can unlink only their own identity", async () => {
    const identity = await prisma.externalIdentityLink.findFirstOrThrow({ where: { workspaceId, userId: ownerId, connectionId: connection.id } });
    await actAs(memberId); await updateMessaging(slug, { operation: "unlink", id: identity.id }); expect(await prisma.externalIdentityLink.count({ where: { id: identity.id } })).toBe(1);
  });
  it("bridges inbound once and excludes mirrored rows from outbound sends", async () => {
    const bridge = await prisma.bridgedChannel.create({ data: { workspaceId, workspaceChannelId: channelId, connectionId: connection.id, externalChannelId: "-100123", direction: "BOTH" } });
    const m = { ...inbound("A build-night update"), private: false, channelId: "-100123", messageId: "bridge-1" };
    await bridgeInbound(connection, m); await bridgeInbound(connection, m);
    expect(await prisma.bridgedMessage.count({ where: { bridgedChannelId: bridge.id } })).toBe(1);
    const before = fetchMock.mock.calls.length; await bridgeOutbound(); expect(fetchMock.mock.calls.length).toBe(before);
    expect(await bridgeInbound(connection, { ...m, messageId: "echo", bot: true })).toBe(false);
    const local = await prisma.message.create({ data: { workspaceId, channelId, authorId: memberId, body: "Hello from the workbench" } });
    await bridgeOutbound(); await bridgeOutbound(); expect(await prisma.bridgedMessage.count({ where: { bridgedChannelId: bridge.id, workspaceMessageId: local.id } })).toBe(1);
  });
  it("routes assistant messages as the linked user and keeps a verified conversation", async () => {
    const conversation = await prisma.assistantConversation.create({ data: { workspaceId, userId: memberId, title: "Messaging" } });
    const runner = vi.fn(async () => ({ text: "Welcome to the workbench.", conversationId: conversation.id })); registerMessagingAssistantRunner(runner);
    await processInboundMessage(connection, inbound("/ask What can I build?"));
    expect(runner).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, userId: memberId, text: "What can I build?" }));
    expect(await prisma.messagingConversation.findFirst({ where: { connectionId: connection.id, userId: memberId } })).toMatchObject({ assistantConversationId: conversation.id });
  });
  it("creates hashed OAuth state with encrypted PKCE and consumes it once for its user", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-test"); vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret-test");
    const url = new URL(await beginGoogle(workspaceId, ownerId, slug)); const state = url.searchParams.get("state")!;
    expect(url.searchParams.get("code_challenge_method")).toBe("S256"); expect(url.searchParams.get("access_type")).toBe("offline");
    const stored = await prisma.oAuthState.findUniqueOrThrow({ where: { stateHash: sha256Hex(state) } }); expect(stored.stateHash).not.toBe(state); expect(stored.redirectPath).not.toContain('"verifier":');
    expect(await consumeOAuthState(state, memberId, "GOOGLE")).toBeNull(); expect(await consumeOAuthState(state, ownerId, "GITHUB")).toBeNull();
    const claimed = await consumeOAuthState(state, ownerId, "GOOGLE"); expect(claimed).not.toBeNull(); expect(await consumeOAuthState(state, ownerId, "GOOGLE")).toBeNull();
    fetchMock.mockReset().mockResolvedValueOnce(Response.json({ access_token: "access-test", refresh_token: "refresh-test", expires_in: 3600 })).mockResolvedValueOnce(Response.json({ sub: "google-owner", email: `owner${domain}` }));
    await completeGoogle(claimed!, "authorisation-code"); const account = await prisma.integrationConnection.findFirstOrThrow({ where: { workspaceId, provider: "GOOGLE" } }); expect(account.accessTokenEnc).not.toContain("access-test"); expect(account.refreshTokenEnc).not.toContain("refresh-test");
  });
  it("does not let another admin read the connecting admin's Gmail", async () => {
    await prisma.membership.updateMany({ where: { workspaceId, userId: memberId }, data: { role: "ADMIN" } }); await actAs(memberId);
    const before = fetchMock.mock.calls.length; expect(await updateIntegrations(slug, { operation: "gmail" })).toMatchObject({ ok: false }); expect(fetchMock.mock.calls.length).toBe(before);
  });
  it("accepts a signed GitHub webhook once, isolates installations and dispatches a feed event", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "github-test-secret");
    const github = await prisma.integrationConnection.create({ data: { workspaceId, provider: "GITHUB", externalId: "123", accountLabel: "Space Works" } });
    const repo = await prisma.githubRepo.create({ data: { workspaceId, connectionId: github.id, installationId: "123", fullName: "SpaceWorks-Labs/Workspace" } });
    const payload = JSON.stringify({ action: "opened", installation: { id: 123 }, repository: { full_name: repo.fullName }, pull_request: { title: "Add a build night", number: 1, html_url: "https://github.com/SpaceWorks-Labs/Workspace/pull/1" }, sender: { login: "maker" } });
    const send = (signature = "sha256=" + createHmac("sha256", "github-test-secret").update(payload).digest("hex")) => receiveGithub(new Request("https://workspace.example.org/github", { method: "POST", headers: { "x-hub-signature-256": signature, "x-github-delivery": `delivery-${suffix}`, "x-github-event": "pull_request" }, body: payload }));
    expect((await send("wrong")).status).toBe(401); expect((await send()).status).toBe(200); await send();
    expect(await prisma.githubEvent.count({ where: { workspaceId, repoId: repo.id } })).toBe(1); expect(await prisma.githubEvent.count({ where: { workspaceId: foreignId } })).toBe(0);
    await dispatchGithubEvents(); await dispatchGithubEvents(); expect(await prisma.notificationEventRecord.count({ where: { workspaceId, type: "github.pr.opened" } })).toBe(1);
  });
  it("uses WhatsApp templates outside the service window and text inside it", async () => {
    const wa = await prisma.messagingConnection.create({ data: { workspaceId, provider: "WHATSAPP", label: "WhatsApp", credentialsEnc: encryptSecret("messaging-credentials", JSON.stringify({ accessToken: "wa-test", appSecret: "test", verifyToken: "test" })), lastVerifiedAt: new Date(), config: { phoneNumberId: "12345", templateName: "spaceworks_notification" } } });
    const input = { deliveryId: "wa-test", event: { id: "e1", type: "notification.test" }, message: { title: "Build night", text: "See you at the bench", url: null, severity: "info", severityLabel: "Info", fields: [], actions: [], eventType: "notification.test", workspace: { id: workspaceId, slug, name: "Space Works" } }, isTest: true, thread: null, target: { type: "destination", destination: { id: "wa-destination", name: "Maker", kind: "WHATSAPP", connection: wa, config: { to: "+919999999999" }, secretEnc: null } } } as AdapterSendInput;
    fetchMock.mockReset().mockImplementation(async () => Response.json({ messages: [{ id: "wamid-test" }] }));
    expect(await whatsappAdapter.send(input)).toMatchObject({ ok: true }); expect(JSON.parse(String(fetchMock.mock.calls.at(-1)![1]?.body)).type).toBe("template");
    await prisma.inboundEvent.create({ data: { provider: "WHATSAPP", connectionId: wa.id, externalEventId: "wa-inbound", kind: "whatsapp:919999999999", payload: {} } });
    expect(await whatsappAdapter.send(input)).toMatchObject({ ok: true }); expect(JSON.parse(String(fetchMock.mock.calls.at(-1)![1]?.body)).type).toBe("text");
  });
  it("sends bounded thread reminders once per interval and stops after a newer status", async () => {
    const ruleId = await saveRule(workspaceId, ownerId, { name: "Critical reminders", eventTypes: ["monitor.*"], minSeverity: "WARNING", destinationIds: [destinationId], dedupeWindowSec: 0, reminderIntervalMin: 10 });
    const at = new Date(Date.now() - 20 * 60000);
    const sent = await dispatch(workspaceId, { type: "monitor.down", title: "Website down", scope: { monitorId: "monitor-test" }, threadKey: "monitor-test-thread", data: { monitorId: "monitor-test", incidentId: null, statusCode: 503, error: null } }, { now: at });
    await prisma.notificationEventRecord.updateMany({ where: { id: sent.eventId, workspaceId }, data: { createdAt: at } });
    await prisma.notificationDelivery.updateMany({ where: { eventId: sent.eventId, workspaceId }, data: { status: "SENT", ruleId } });
    await sendRoutingReminders(); await sendRoutingReminders();
    expect(await prisma.notificationEventRecord.count({ where: { workspaceId, reminderOf: sent.eventId } })).toBe(1);
    await dispatch(workspaceId, { type: "monitor.up", title: "Website recovered", scope: { monitorId: "monitor-test" }, threadKey: "monitor-test-thread", data: { monitorId: "monitor-test", incidentId: null, downtimeSec: 1200 } });
    await sendRoutingReminders(new Date(Date.now() + 20 * 60000));
    expect(await prisma.notificationEventRecord.count({ where: { workspaceId, reminderOf: sent.eventId } })).toBe(1);
  });
  it("synchronises Search Console totals, queries and pages independently and audits public HTML", async () => {
    const google = await prisma.integrationConnection.findFirstOrThrow({ where: { workspaceId, provider: "GOOGLE" } });
    const site = await prisma.seoSite.create({ data: { workspaceId, connectionId: google.id, siteUrl: "https://example.org/", verified: true } });
    fetchMock.mockReset().mockImplementation(async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      const dimensions = payload.dimensions as string[];
      return Response.json({ rows: [{ keys: ["2026-10-16", ...(dimensions[1] === "query" ? ["makers"] : dimensions[1] === "page" ? ["https://example.org/build"] : [])], clicks: 10, impressions: 100, ctr: 0.1, position: 4 }] });
    });
    await syncSeoSite(workspaceId, site.id, new Date("2026-10-19T12:00:00Z"));
    expect(await prisma.seoMetricDaily.count({ where: { siteId: site.id } })).toBe(3);
    await expect(syncSeoSite(foreignId, site.id)).rejects.toThrow("Connect this site");
    fetchMock.mockReset().mockImplementation(async () => new Response('<html lang="en"><title>Space Works build nights</title><h1>Build nights</h1></html>', { headers: { "content-type": "text/html" } }));
    const audit = await runSeoAudit(workspaceId, site.id, ownerId, "https://example.org/build"); expect(audit.score).toBeGreaterThan(0);
    await expect(runSeoAudit(workspaceId, site.id, ownerId, "https://evil.test/")).rejects.toThrow("property");
    expect(await prisma.seoAudit.count({ where: { siteId: site.id, site: { workspaceId }, status: "done" } })).toBe(1);
  });

});
