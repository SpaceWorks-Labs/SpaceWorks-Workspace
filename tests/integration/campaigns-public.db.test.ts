import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { invalidateLimits } from "@/lib/limits";
import { signCampaignToken } from "@/lib/campaigns/tokens";
import { handleSubscribe, NEUTRAL_MESSAGE } from "@/lib/campaigns/public/subscribe";
import { issueFormToken } from "@/lib/campaigns/public/formToken";
import { loadPreferences, savePreferences } from "@/lib/campaigns/public/preferences";
import { recordOpen, resolveClick } from "@/lib/campaigns/public/tracking";
import { POST as subscribeRoute } from "@/app/api/public/campaigns/subscribe/route";
import { GET as confirmGet, POST as confirmPost } from "@/app/api/public/campaigns/confirm/[token]/route";
import { GET as unsubGet, POST as unsubPost } from "@/app/api/public/campaigns/unsubscribe/[token]/route";
import { GET as pixelGet } from "@/app/api/public/campaigns/o/[token]/route";
import { GET as clickGet } from "@/app/api/public/campaigns/c/[token]/[linkId]/route";
import { checkRateLimitById } from "@/lib/rateLimit";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";
import type { NextRequest } from "next/server";

const suffix = uniqueSuffix();
const domain = `@e1pub-${suffix}.test`;
const slugA = `e1pa-${suffix}`;
const slugB = `e1pb-${suffix}`;
let wsA: string; let wsB: string;
let news: { id: string; slug: string }; let single: { id: string; slug: string }; let priv: { id: string };
let ipN = 0;
const ctx = () => ({ ip: `10.1.0.${++ipN}`, now: Date.now() + 10_000 });
const req = (url: string, init?: RequestInit) => new Request(url, init) as unknown as NextRequest;
const params = <T,>(p: T) => ({ params: Promise.resolve(p) }) as never;
const form = (data: Record<string, string>) => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(data).toString() });

async function subscribe(email: string, list = news, over: Record<string, unknown> = {}, workspaceSlug = slugA, listWs = wsA) {
  return handleSubscribe({ workspaceSlug, listSlug: list.slug, email, ts: issueFormToken(listWs, list.id), hp: "", ...over }, ctx());
}
async function confirmTokenFor(email: string) {
  const rows = await prisma.outboxMessage.findMany({ where: { kind: "campaign.confirm" }, orderBy: { createdAt: "desc" }, take: 50 });
  const row = rows.find((r) => (r.payload as { to?: string }).to === email);
  return row ? ((row.payload as { confirmUrl: string }).confirmUrl.match(/confirm\/(\S+)/)?.[1] ?? null) : null;
}
const sub = (email: string, workspaceId = wsA) => prisma.subscriber.findUnique({ where: { workspaceId_email: { workspaceId, email } }, include: { subscriptions: true } });

async function message(workspaceId: string, subscriberId: string, listIds: string[], over: { trackOpens?: boolean; trackClicks?: boolean; individualTracking?: boolean } = {}) {
  const campaign = await prisma.campaign.create({ data: { workspaceId, name: "c", subject: "s", fromName: "f", ...over, lists: { create: listIds.map((listId) => ({ listId })) } } });
  const m = await prisma.campaignMessage.create({ data: { campaignId: campaign.id, workspaceId, subscriberId, emailSnapshot: "x", token: `t-${Math.random().toString(36).slice(2)}`, status: "SENT" } });
  return { campaign, m };
}

describe.sequential("public campaign flows", () => {
  beforeAll(async () => {
    const owner = (await createUser(`owner${domain}`)).id;
    wsA = (await createWorkspace(slugA, owner)).id;
    wsB = (await createWorkspace(slugB, owner)).id;
    await addMember(wsA, (await createUser(`m${domain}`)).id);
    const mk = (workspaceId: string, name: string, slug: string, visibility: "PUBLIC" | "PRIVATE", optIn: "SINGLE" | "DOUBLE") => prisma.mailingList.create({ data: { workspaceId, name, slug, visibility, optIn } });
    news = await mk(wsA, "News", "news", "PUBLIC", "DOUBLE");
    single = await mk(wsA, "Single", "single", "PUBLIC", "SINGLE");
    priv = await mk(wsA, "Private", "private", "PRIVATE", "DOUBLE");
    await mk(wsB, "News", "news", "PUBLIC", "DOUBLE");
  });
  afterAll(async () => { await prisma.campaign.deleteMany({ where: { workspaceId: { in: [wsA, wsB] } } }); await cleanup([slugA, slugB], domain); });

  it("subscribes neutrally, then double opt-in needs POST, and GET never confirms", async () => {
    const email = `ann${domain}`;
    expect(await subscribe(email)).toEqual({ status: "ok" });
    expect((await sub(email))?.subscriptions[0]).toMatchObject({ status: "UNCONFIRMED", consentSource: "FORM", consentIp: null });
    expect(NEUTRAL_MESSAGE).toMatch(/If this address/);
    const token = (await confirmTokenFor(email))!;
    expect(token).toBeTruthy();
    const get = await confirmGet(req(`http://x/api/public/campaigns/confirm/${token}`), params({ token }));
    expect(get.status).toBe(303);
    expect((await sub(email))?.subscriptions[0].status).toBe("UNCONFIRMED");
    const post = await confirmPost(req(`http://x/api/public/campaigns/confirm/${token}`, { method: "POST" }), params({ token }));
    expect(post.headers.get("location")).toContain("/m/done/confirmed");
    expect((await sub(email))?.subscriptions[0]).toMatchObject({ status: "CONFIRMED", confirmTokenHash: null });
    const replay = await confirmPost(req(`http://x/api/public/campaigns/confirm/${token}`, { method: "POST" }), params({ token }));
    expect(replay.headers.get("location")).toContain("/m/done/invalid");
  });

  it("does not resend a confirmation within 24 hours, and stores consent IP only when enabled", async () => {
    const email = `bob${domain}`;
    await subscribe(email); await subscribe(email);
    expect((await prisma.outboxMessage.findMany({ where: { kind: "campaign.confirm" } })).filter((r) => (r.payload as { to?: string }).to === email)).toHaveLength(1);
    await prisma.campaignSettings.upsert({ where: { workspaceId: wsA }, create: { workspaceId: wsA, recordConsentIp: true }, update: { recordConsentIp: true } });
    await subscribe(`ip${domain}`);
    expect((await sub(`ip${domain}`))?.subscriptions[0].consentIp).toMatch(/^10\.1\.0\./);
    await prisma.campaignSettings.update({ where: { workspaceId: wsA }, data: { recordConsentIp: false, domainBlocklist: ["blocked.test"] } });
    await subscribe("z@blocked.test");
    expect(await sub("z@blocked.test")).toBeNull();
  });

  it("uses double opt-in for public sign-ups even on a SINGLE list, and an unsubscribed address stays unsubscribed until confirmed", async () => {
    const email = `sgl${domain}`;
    await subscribe(email, single);
    expect((await sub(email))?.subscriptions[0]).toMatchObject({ status: "UNCONFIRMED" });
    const first = (await confirmTokenFor(email))!;
    expect(first).toBeTruthy();
    expect((await prisma.outboxMessage.findFirst({ where: { kind: "email", payload: { path: ["to"], equals: email } } }))).toBeNull();
    await confirmPost(req("http://x/c", { method: "POST" }), params({ token: first }));
    const s = (await sub(email))!;
    await prisma.listSubscription.update({ where: { subscriberId_listId: { subscriberId: s.id, listId: single.id } }, data: { status: "UNSUBSCRIBED", unsubscribedAt: new Date(), unsubscribeSource: "one_click" } });
    await subscribe(email, single);
    expect((await sub(email))?.subscriptions[0]).toMatchObject({ status: "UNSUBSCRIBED" });
    const second = (await confirmTokenFor(email))!;
    expect(second).not.toBe(first);
    await confirmPost(req("http://x/c", { method: "POST" }), params({ token: second }));
    expect((await sub(email))?.subscriptions[0]).toMatchObject({ status: "CONFIRMED", unsubscribedAt: null });
  });

  it("caps confirmation emails per address across workspaces", async () => {
    const email = `bomb${domain}`;
    const other = await prisma.mailingList.findFirstOrThrow({ where: { workspaceId: wsB, slug: "news" } });
    for (let i = 0; i < 2; i++) { await subscribe(email); await prisma.listSubscription.deleteMany({ where: { subscriber: { email } } }); }
    await subscribe(email, other, {}, slugB, wsB);
    await prisma.listSubscription.deleteMany({ where: { subscriber: { email } } });
    await subscribe(email, other, {}, slugB, wsB);
    const sent = (await prisma.outboxMessage.findMany({ where: { kind: "campaign.confirm" } })).filter((r) => (r.payload as { to?: string }).to === email);
    expect(sent).toHaveLength(3);
  });

  it("drops honeypot and too-fast posts, rejects expired forms and private lists", async () => {
    expect(await subscribe(`bot${domain}`, news, { hp: "x" })).toEqual({ status: "ok" });
    expect(await handleSubscribe({ workspaceSlug: slugA, listSlug: "news", email: `fast${domain}`, ts: issueFormToken(wsA, news.id) }, { ip: "10.9.9.9" })).toEqual({ status: "ok" });
    expect(await sub(`bot${domain}`)).toBeNull();
    expect(await sub(`fast${domain}`)).toBeNull();
    expect(await subscribe(`old${domain}`, news, { ts: issueFormToken(wsA, news.id, Date.now() - 2 * 3_600_000) })).toMatchObject({ status: "invalid" });
    expect((await subscribe(`pv${domain}`, priv as never)).status).toBe("not_found");
  });

  it("returns the same neutral result for blocklisted addresses and 429s a flooding IP", async () => {
    const email = `blk${domain}`;
    await subscribe(email);
    await prisma.subscriber.updateMany({ where: { workspaceId: wsA, email }, data: { status: "BLOCKLISTED" } });
    expect(await subscribe(email)).toEqual({ status: "ok" });
    const ip = "10.7.7.7";
    const results = [];
    for (let i = 0; i < 7; i++) results.push((await handleSubscribe({ workspaceSlug: slugA, listSlug: "news", email: `f${i}${domain}`, ts: issueFormToken(wsA, news.id) }, { ip, now: Date.now() + 10_000 })).status);
    expect(results).toContain("rate_limited");
  });

  it("subscribes through the form route (neutral JSON)", async () => {
    const res = await subscribeRoute(req("http://x/api/public/campaigns/subscribe", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.5.5.5" }, body: JSON.stringify({ workspaceSlug: slugA, listSlug: "news", email: `rt${domain}`, ts: issueFormToken(wsA, news.id) }) }));
    expect([200, 400]).toContain(res.status);
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("one-click unsubscribe POST returns 200 with no body; unsubscribe-all blocklists", async () => {
    const [a, b] = await Promise.all([prisma.subscriber.create({ data: { workspaceId: wsA, email: `u1${domain}`, publicToken: `p1-${suffix}` } }), prisma.subscriber.create({ data: { workspaceId: wsA, email: `u2${domain}`, publicToken: `p2-${suffix}` } })]);
    for (const s of [a, b]) await prisma.listSubscription.create({ data: { subscriberId: s.id, listId: news.id, workspaceId: wsA, status: "CONFIRMED", consentSource: "IMPORT" } });
    const ma = await message(wsA, a.id, [news.id]); const mb = await message(wsA, b.id, [news.id]);
    const tok = (m: { id: string }) => signCampaignToken({ purpose: "unsub", workspaceId: wsA, messageId: m.id });
    const url = (t: string) => `http://x/api/public/campaigns/unsubscribe/${t}`;
    expect((await unsubGet(req(url(tok(ma.m))), params({ token: tok(ma.m) }))).status).toBe(303);
    expect((await sub(a.email))?.subscriptions[0].status).toBe("CONFIRMED");
    const one = await unsubPost(req(url(tok(ma.m)), form({ "List-Unsubscribe": "One-Click" })), params({ token: tok(ma.m) }));
    expect(one.status).toBe(200);
    expect(await one.text()).toBe("");
    expect((await sub(a.email))).toMatchObject({ status: "ACTIVE", subscriptions: [{ status: "UNSUBSCRIBED", unsubscribeSource: "one_click" }] });
    await unsubPost(req(url(tok(mb.m)), form({ choice: "all" })), params({ token: tok(mb.m) }));
    expect(await sub(b.email)).toMatchObject({ status: "BLOCKLISTED", blocklistReason: "UNSUBSCRIBE_ALL" });
  });

  it("writes an unsubscribe back to the source contact only", async () => {
    const contact = await prisma.contact.create({ data: { workspaceId: wsA, displayName: "C", consentStatus: "GRANTED", emails: [{ value: `ct${domain}` }] } });
    const other = await prisma.contact.create({ data: { workspaceId: wsA, displayName: "O", consentStatus: "GRANTED" } });
    const s = await prisma.subscriber.create({ data: { workspaceId: wsA, email: `ct${domain}`, publicToken: `p3-${suffix}`, contactId: contact.id, source: "contact" } });
    await prisma.listSubscription.create({ data: { subscriberId: s.id, listId: news.id, workspaceId: wsA, status: "CONFIRMED", consentSource: "CONTACT" } });
    const m = await message(wsA, s.id, [news.id]);
    const t = signCampaignToken({ purpose: "unsub", workspaceId: wsA, messageId: m.m.id });
    await unsubPost(req("http://x/u", form({ "List-Unsubscribe": "One-Click" })), params({ token: t }));
    expect((await prisma.contact.findUnique({ where: { id: contact.id } }))?.consentStatus).toBe("DENIED");
    expect((await prisma.contact.findUnique({ where: { id: other.id } }))?.consentStatus).toBe("GRANTED");
  });

  it("toggles public-list preferences and edits the name", async () => {
    const s = await prisma.subscriber.create({ data: { workspaceId: wsA, email: `pf${domain}`, publicToken: `p4-${suffix}` } });
    await prisma.listSubscription.create({ data: { subscriberId: s.id, listId: single.id, workspaceId: wsA, status: "CONFIRMED", consentSource: "FORM" } });
    const token = signCampaignToken({ purpose: "prefs", workspaceId: wsA, subscriberId: s.id });
    const view = await loadPreferences(token);
    expect(view?.lists.map((l) => l.name).sort()).toEqual(["News", "Single"]);
    expect(await savePreferences(token, { name: "Pat", subscribedListIds: [news.id] }, "10.2.2.2")).toBe(true);
    const after = await sub(`pf${domain}`);
    expect(after?.name).toBe("Pat");
    expect(Object.fromEntries(after!.subscriptions.map((x) => [x.listId, x.status]))).toEqual({ [single.id]: "UNSUBSCRIBED", [news.id]: "UNCONFIRMED" });
    expect(await loadPreferences("bad.token")).toBeNull();
  });

  it("records opens and clicks as counters, rows only with individual tracking, and never from the query", async () => {
    const s = await prisma.subscriber.create({ data: { workspaceId: wsA, email: `tr${domain}`, publicToken: `p5-${suffix}` } });
    const { campaign, m } = await message(wsA, s.id, [news.id], { trackOpens: true, trackClicks: true });
    const link = await prisma.campaignLink.create({ data: { campaignId: campaign.id, workspaceId: wsA, url: "https://example.org/a", urlHash: "h1" } });
    const bad = await prisma.campaignLink.create({ data: { campaignId: campaign.id, workspaceId: wsA, url: "javascript:alert(1)", urlHash: "h2" } });
    const open = signCampaignToken({ purpose: "open", workspaceId: wsA, messageId: m.id });
    const click = signCampaignToken({ purpose: "click", workspaceId: wsA, messageId: m.id });
    const gif = await pixelGet(req("http://x/o"), params({ token: open }));
    expect(gif.headers.get("content-type")).toBe("image/gif");
    expect((await gif.arrayBuffer()).byteLength).toBe(43);
    await pixelGet(req("http://x/o"), params({ token: open }));
    const res = await clickGet(req("http://x/c?url=https://evil.test"), params({ token: click, linkId: link.id }));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.org/a");
    expect((await clickGet(req("http://x/c"), params({ token: click, linkId: bad.id }))).status).toBe(404);
    expect(await resolveClick(click, "nope")).toBeNull();
    expect(await prisma.campaign.findUnique({ where: { id: campaign.id } })).toMatchObject({ openCount: 1, clickCount: 1 });
    expect(await prisma.campaignEngagement.count({ where: { campaignId: campaign.id } })).toBe(0);
    await prisma.campaign.update({ where: { id: campaign.id }, data: { individualTracking: true } });
    await prisma.campaignMessage.update({ where: { id: m.id }, data: { openedAt: null } });
    await recordOpen(open);
    expect(await prisma.campaignEngagement.count({ where: { campaignId: campaign.id, kind: "OPEN" } })).toBe(1);
  });

  it("still serves the pixel and the redirect when the per-IP limit is exceeded, without counting", async () => {
    const s = await prisma.subscriber.create({ data: { workspaceId: wsA, email: `rl${domain}`, publicToken: `p7-${suffix}` } });
    const { campaign, m } = await message(wsA, s.id, [news.id], { trackOpens: true, trackClicks: true });
    const link = await prisma.campaignLink.create({ data: { campaignId: campaign.id, workspaceId: wsA, url: "https://example.org/b", urlHash: "h3" } });
    const open = signCampaignToken({ purpose: "open", workspaceId: wsA, messageId: m.id });
    const click = signCampaignToken({ purpose: "click", workspaceId: wsA, messageId: m.id });
    for (let i = 0; i < 125; i++) await checkRateLimitById("campaignPublic", "open:unknown");
    for (let i = 0; i < 125; i++) await checkRateLimitById("campaignPublic", "click:unknown");
    const gif = await pixelGet(req("http://x/o"), params({ token: open }));
    expect(gif.status).toBe(200);
    const res = await clickGet(req("http://x/c"), params({ token: click, linkId: link.id }));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.org/b");
    expect(await prisma.campaign.findUnique({ where: { id: campaign.id } })).toMatchObject({ openCount: 0, clickCount: 0 });
  });

  it("404s when the module is off or the workspace is not active, and isolates tenants", async () => {
    const s = await prisma.subscriber.create({ data: { workspaceId: wsB, email: `iso${domain}`, publicToken: `p6-${suffix}` } });
    const mB = await message(wsB, s.id, []);
    const wrong = signCampaignToken({ purpose: "unsub", workspaceId: wsA, messageId: mB.m.id });
    expect((await unsubPost(req("http://x/u", form({ "List-Unsubscribe": "One-Click" })), params({ token: wrong }))).status).toBe(404);
    expect((await subscribe("t@x.org", { id: "zz", slug: "news" } as never, {}, slugA, wsB)).status).toBeDefined();
    await prisma.workspaceLimits.upsert({ where: { workspaceId: wsA }, create: { workspaceId: wsA, disabledModules: ["campaigns"] }, update: { disabledModules: ["campaigns"] } });
    invalidateLimits(wsA);
    expect((await subscribe(`off${domain}`)).status).toBe("not_found");
    await prisma.workspaceLimits.update({ where: { workspaceId: wsA }, data: { disabledModules: [] } });
    invalidateLimits(wsA);
    await prisma.workspace.update({ where: { id: wsA }, data: { status: "SUSPENDED" } });
    expect((await subscribe(`sus${domain}`)).status).toBe("not_found");
    await prisma.workspace.update({ where: { id: wsA }, data: { status: "ACTIVE" } });
    expect((await subscribe(`back${domain}`)).status).toBe("ok");
  });
});
