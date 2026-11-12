import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Mail = { to: string; subject: string; html: string; text: string; headers: Record<string, string>; messageId: string };
const mock = vi.hoisted(() => ({ sent: [] as Mail[], onSend: null as null | ((mail: Mail) => Promise<void>), failWith: null as null | Record<string, unknown> }));
vi.mock("@/lib/campaigns/transport", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/campaigns/transport")>()),
  createCampaignSender: async () => ({
    shared: false,
    domain: "mail.test",
    send: async (mail: Mail) => {
      if (mock.failWith) throw Object.assign(new Error("smtp"), mock.failWith);
      await mock.onSend?.(mail);
      mock.sent.push(mail);
      return { providerMessageId: mail.messageId };
    },
  }),
}));

import { prisma } from "@/lib/db";
import { randomToken } from "@/lib/crypto";
import { invalidateLimits } from "@/lib/limits";
import { runCampaignSending } from "@/lib/campaigns/send/worker";
import { resetRateLimit } from "@/lib/campaigns/send/rate";
import { cancelCampaign, getCampaign } from "@/lib/campaigns/campaigns";
import { getCampaignStats } from "@/lib/campaigns/stats";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@e2-${suffix}.test`;
const slugs = [`e2-${suffix}`, `e2b-${suffix}`];
let ws = "";
let wsB = "";
let ownerId = "";
let n = 0;

async function mkList(workspaceId = ws) {
  return prisma.mailingList.create({ data: { workspaceId, name: `L${++n}`, slug: `l${n}-${suffix}`, optIn: "SINGLE" } });
}
async function mkSub(listIds: string[], status: "CONFIRMED" | "UNSUBSCRIBED" = "CONFIRMED", opts: { blocklisted?: boolean; workspaceId?: string } = {}) {
  const workspaceId = opts.workspaceId ?? ws;
  const email = `s${++n}${domain}`;
  const sub = await prisma.subscriber.create({ data: { workspaceId, email, emailDomain: domain.slice(1), publicToken: randomToken(16), name: `Sub ${n}`, status: opts.blocklisted ? "BLOCKLISTED" : "ACTIVE" } });
  for (const listId of listIds) await prisma.listSubscription.create({ data: { workspaceId, subscriberId: sub.id, listId, status, consentSource: "ADMIN" } });
  return sub;
}
async function mkCampaign(listIds: string[], over: Record<string, unknown> = {}) {
  return prisma.campaign.create({
    data: { workspaceId: ws, name: `C${++n}`, subject: "Hi {{first_name}}", fromName: "Acme", bodyHtml: "<p>Hello {{name}}</p>", bodyText: "Hello", status: "SCHEDULED", scheduledAt: new Date(Date.now() - 1000), createdById: ownerId, lists: { create: listIds.map((listId) => ({ listId })) }, ...over },
  });
}
const run = () => runCampaignSending(new Date(), { budgetMs: 20_000 });
const status = async (id: string) => (await prisma.campaign.findUniqueOrThrow({ where: { id } }));

describe.sequential("campaign sending worker", () => {
  beforeAll(async () => {
    ownerId = (await createUser(`owner${domain}`)).id;
    ws = (await createWorkspace(slugs[0]!, ownerId)).id;
    wsB = (await createWorkspace(slugs[1]!, (await createUser(`ownerb${domain}`)).id)).id;
    await addMember(ws, (await createUser(`member${domain}`)).id, "MEMBER");
    await prisma.campaignSettings.create({ data: { workspaceId: ws, footerAddress: "1 Main St, Kochi", sendPerMinute: 600, batchSize: 50, maxErrors: 2 } });
  });
  beforeEach(() => { mock.sent.length = 0; mock.onSend = null; mock.failWith = null; resetRateLimit(); });
  afterAll(async () => {
    await prisma.campaign.deleteMany({ where: { workspaceId: { in: [ws, wsB] } } });
    await prisma.workspaceLimits.deleteMany({ where: { workspaceId: { in: [ws, wsB] } } });
    await cleanup(slugs, domain);
  });

  it("sends to two overlapping lists once per subscriber and skips unsubscribed and blocklisted", async () => {
    const [a, b] = [await mkList(), await mkList()];
    const s1 = await mkSub([a.id]);
    const s2 = await mkSub([a.id, b.id]);
    const s3 = await mkSub([b.id]);
    await mkSub([a.id], "UNSUBSCRIBED");
    await mkSub([a.id], "CONFIRMED", { blocklisted: true });
    const c = await mkCampaign([a.id, b.id]);
    await run();
    const done = await status(c.id);
    expect(done.status).toBe("FINISHED");
    expect(done).toMatchObject({ totalRecipients: 3, sentCount: 3, failedCount: 0 });
    expect(mock.sent.map((m) => m.to).sort()).toEqual([s1.email, s2.email, s3.email].sort());
    const mail = mock.sent[0]!;
    expect(mail.headers["List-Unsubscribe"]).toMatch(/^<http:\/\/localhost:3100\/api\/public\/campaigns\/unsubscribe\//);
    expect(mail.headers["Message-ID"]).toMatch(/^<c-.+@mail\.test>$/);
    expect(mail.html).toContain("1 Main St, Kochi");
    expect(mail.subject).toMatch(/^Hi Sub$/);
    expect(mail.html).not.toContain("{{");
  });

  it("resumes after a crash without sending twice", async () => {
    const l = await mkList();
    const [s1, s2, s3] = [await mkSub([l.id]), await mkSub([l.id]), await mkSub([l.id])];
    const c = await mkCampaign([l.id], { status: "RUNNING", startedAt: new Date(), lastSubscriberId: "~" });
    const old = new Date(Date.now() - 11 * 60_000);
    const mk = (s: { id: string; email: string }, data: object) => prisma.campaignMessage.create({ data: { campaignId: c.id, workspaceId: ws, subscriberId: s.id, emailSnapshot: s.email, token: randomToken(16), ...data } });
    await mk(s1, { status: "SENT", sentAt: old, providerMessageId: "<done>" });
    await mk(s2, { status: "CLAIMED", claimedAt: old });
    await mk(s3, { status: "PENDING" });
    await run();
    expect(mock.sent.map((m) => m.to).sort()).toEqual([s2.email, s3.email].sort());
    expect(await status(c.id)).toMatchObject({ status: "FINISHED", sentCount: 3 });
  });

  it("does not send while paused and skips pending messages on cancel", async () => {
    const l = await mkList();
    const s = await mkSub([l.id]);
    const paused = await mkCampaign([l.id], { status: "PAUSED", pausedReason: "manual" });
    await run();
    expect(mock.sent).toHaveLength(0);
    const running = await mkCampaign([l.id], { status: "RUNNING", startedAt: new Date(), lastSubscriberId: "~" });
    await prisma.campaignMessage.create({ data: { campaignId: running.id, workspaceId: ws, subscriberId: s.id, emailSnapshot: s.email, token: randomToken(16) } });
    expect((await cancelCampaign({ workspaceId: ws, userId: ownerId, role: "OWNER", email: `owner${domain}` }, running.id)).ok).toBe(true);
    await run();
    expect(mock.sent).toHaveLength(0);
    expect(await prisma.campaignMessage.count({ where: { campaignId: running.id, status: "SKIPPED" } })).toBe(1);
    expect((await status(running.id)).status).toBe("CANCELLED");
    await prisma.campaign.update({ where: { id: paused.id }, data: { status: "CANCELLED" } });
  });

  it("pauses at promotion when the monthly cap is reached", async () => {
    const l = await mkList();
    await mkSub([l.id]);
    const used = await prisma.campaignMessage.count({ where: { workspaceId: ws, status: "SENT" } });
    await prisma.workspaceLimits.upsert({ where: { workspaceId: ws }, create: { workspaceId: ws, monthlyEmailCap: used }, update: { monthlyEmailCap: used } });
    invalidateLimits(ws);
    const c = await mkCampaign([l.id]);
    await run();
    expect(await status(c.id)).toMatchObject({ status: "PAUSED", pausedReason: "monthly_cap" });
    expect(mock.sent).toHaveLength(0);
    await prisma.workspaceLimits.delete({ where: { workspaceId: ws } });
    invalidateLimits(ws);
    await prisma.campaign.update({ where: { id: c.id }, data: { status: "CANCELLED" } });
  });

  it("pauses after too many consecutive failures and retries transient errors", async () => {
    const l = await mkList();
    for (let i = 0; i < 5; i++) await mkSub([l.id]);
    mock.failWith = { responseCode: 451 };
    const c = await mkCampaign([l.id]);
    await run();
    const after = await status(c.id);
    expect(after).toMatchObject({ status: "PAUSED", pausedReason: "max_errors" });
    const pending = await prisma.campaignMessage.findMany({ where: { campaignId: c.id, attempts: { gt: 0 } } });
    expect(pending.length).toBeGreaterThan(2);
    expect(pending.every((m) => m.status === "PENDING" && m.nextAttemptAt && m.nextAttemptAt.getTime() > Date.now())).toBe(true);
    await prisma.campaign.update({ where: { id: c.id }, data: { status: "CANCELLED" } });
  });

  it("marks a 5xx rejection FAILED with a HARD SMTP_REJECT bounce", async () => {
    const l = await mkList();
    const s = await mkSub([l.id]);
    mock.failWith = { responseCode: 550, response: "550 no such user" };
    const c = await mkCampaign([l.id]);
    await run();
    expect(await status(c.id)).toMatchObject({ status: "FINISHED", failedCount: 1, sentCount: 0 });
    const bounce = await prisma.campaignBounce.findFirstOrThrow({ where: { campaignId: c.id } });
    expect(bounce).toMatchObject({ kind: "HARD", source: "SMTP_REJECT", subscriberId: s.id, workspaceId: ws });
    expect((await getCampaignStats(ws, c.id))?.bounces.hard).toBe(1);
  });

  it("applies the bounce policy to a 5xx: subscriber BLOCKLISTED and the linked contact do-not-contact", async () => {
    const l = await mkList();
    const s = await mkSub([l.id]);
    const contact = await prisma.contact.create({ data: { workspaceId: ws, displayName: "Linked", createdById: ownerId } });
    await prisma.subscriber.update({ where: { id: s.id }, data: { contactId: contact.id } });
    mock.failWith = { responseCode: 550, response: "550 no such user" };
    const c = await mkCampaign([l.id]);
    await run();
    expect(await prisma.subscriber.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ status: "BLOCKLISTED", blocklistReason: "BOUNCE_HARD" });
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } })).doNotContact).toBe(true);
    expect(await prisma.campaignBounce.count({ where: { campaignId: c.id, subscriberId: s.id } })).toBe(1);
  });

  it("skips a subscriber who unsubscribes mid-run", async () => {
    const l = await mkList();
    const subs = [await mkSub([l.id]), await mkSub([l.id])];
    mock.onSend = async (mail) => {
      const other = subs.find((s) => s.email !== mail.to)!;
      await prisma.listSubscription.updateMany({ where: { subscriberId: other.id }, data: { status: "UNSUBSCRIBED" } });
    };
    const c = await mkCampaign([l.id]);
    await run();
    expect(mock.sent).toHaveLength(1);
    expect(await status(c.id)).toMatchObject({ status: "FINISHED", sentCount: 1, skippedCount: 1 });
  });

  it("never reaches another workspace", async () => {
    const l = await mkList();
    await mkSub([l.id]);
    const lb = await mkList(wsB);
    const foreign = await mkSub([lb.id], "CONFIRMED", { workspaceId: wsB });
    // A mismatched subscription row pointing a foreign subscriber at this workspace's list.
    await prisma.listSubscription.create({ data: { workspaceId: wsB, subscriberId: foreign.id, listId: l.id, status: "CONFIRMED", consentSource: "ADMIN" } });
    const c = await mkCampaign([l.id]);
    await run();
    expect(mock.sent.map((m) => m.to)).not.toContain(foreign.email);
    expect(await prisma.campaignMessage.count({ where: { campaignId: c.id, subscriberId: foreign.id } })).toBe(0);
    expect(await getCampaign(wsB, c.id)).toBeNull();
    expect(await getCampaignStats(wsB, c.id)).toBeNull();
    expect((await cancelCampaign({ workspaceId: wsB, userId: ownerId, role: "OWNER", email: "x@y.z" }, c.id)).ok).toBe(false);
  });
});
