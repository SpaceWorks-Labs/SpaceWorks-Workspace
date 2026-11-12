import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { createList, validListIds } from "@/lib/campaigns/lists";
import { addSubscriber, eraseSubscriber, querySubscribers } from "@/lib/campaigns/subscribers";
import { importFromContacts, importSubscribersCsv } from "@/lib/campaigns/import";
import { exportSubscribers } from "@/lib/campaigns/export";
import { bounceSecretMatches, rotateBounceSecret, saveCampaignSettings } from "@/lib/campaigns/settings";
import { recordBounce } from "@/lib/campaigns/bounce/record";
import { handlePostmarkWebhook, handleSesWebhook } from "@/lib/campaigns/bounce/webhook";
import { deleteRelationship, saveContact } from "@/lib/contacts/contacts";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@e1aud-${suffix}.test`;
const slugA = `e1aa-${suffix}`;
const slugB = `e1ab-${suffix}`;
let wsA: string; let wsB: string; let admin: string; let listA: string; let listB: string;
const csv = (rows: string[]) => `email,name,plan\n${rows.join("\n")}\n`;
const sub = (email: string, workspaceId = wsA) => prisma.subscriber.findUnique({ where: { workspaceId_email: { workspaceId, email } }, include: { subscriptions: true } });
const hook = (secret: string, body: unknown) => new Request("http://x/hook", { method: "POST", headers: { "x-webhook-secret": secret, "content-type": "application/json" }, body: JSON.stringify(body) });
const actor = () => ({ workspace: { id: wsA, slug: slugA }, membership: { role: "ADMIN" }, user: { id: admin } }) as never;

describe.sequential("campaign audience", () => {
  beforeAll(async () => {
    admin = (await createUser(`admin${domain}`)).id;
    wsA = (await createWorkspace(slugA, admin)).id;
    wsB = (await createWorkspace(slugB, admin)).id;
    await addMember(wsA, (await createUser(`m${domain}`)).id);
    listA = ((await createList(wsA, admin, { name: "Everyone" })) as { data: { id: string } }).data.id;
    listB = ((await createList(wsB, admin, { name: "Other" })) as { data: { id: string } }).data.id;
  });
  afterAll(async () => { await cleanup([slugA, slugB], domain); });

  it("creates lists with unique slugs per workspace and keeps lists tenant-scoped", async () => {
    const again = (await createList(wsA, admin, { name: "Everyone" })) as { data: { slug: string } };
    expect(again.data.slug).toBe("everyone-2");
    expect(await validListIds(wsA, [listA, listB])).toEqual([listA]);
  });

  it("requires the permission attestation and caps the import at 10,000 rows", async () => {
    expect(await importSubscribersCsv(wsA, admin, { csv: csv([`a${domain},A,x`]), listIds: [listA], attest: false })).toMatchObject({ ok: false });
    const big = Array.from({ length: 10_001 }, (_, i) => `u${i}${domain}`).join("\n");
    expect(await importSubscribersCsv(wsA, admin, { csv: `email\n${big}`, listIds: [listA], attest: true })).toMatchObject({ ok: false });
    expect(await prisma.subscriber.count({ where: { workspaceId: wsA } })).toBe(0);
  });

  it("imports, dedupes, reports row errors and respects earlier unsubscribes and blocklisting", async () => {
    const r = await importSubscribersCsv(wsA, admin, { csv: csv([`one${domain},One,gold`, `two${domain},Two,`, `one${domain},Dup,`, "nope,Bad,"]), listIds: [listA], attest: true });
    expect(r).toMatchObject({ ok: true, data: { created: 2, existing: 0, problemCount: 2 } });
    expect((await sub(`one${domain}`))).toMatchObject({ source: "import", attributes: { plan: "gold" }, subscriptions: [{ status: "CONFIRMED", consentSource: "IMPORT" }] });
    await prisma.listSubscription.updateMany({ where: { workspaceId: wsA, subscriber: { email: `two${domain}` } }, data: { status: "UNSUBSCRIBED" } });
    await prisma.subscriber.updateMany({ where: { workspaceId: wsA, email: `one${domain}` }, data: { status: "BLOCKLISTED" } });
    const again = await importSubscribersCsv(wsA, admin, { csv: csv([`one${domain},One,`, `two${domain},Two,`, `three${domain},Three,`]), listIds: [listA], attest: true });
    expect(again).toMatchObject({ ok: true, data: { created: 1, existing: 2, skipped: 1 } });
    expect((await sub(`two${domain}`))?.subscriptions[0].status).toBe("UNSUBSCRIBED");
    await prisma.subscriber.updateMany({ where: { workspaceId: wsA, email: `one${domain}` }, data: { status: "ACTIVE" } });
  });

  it("imports consenting contacts only and applies the domain blocklist", async () => {
    const mk = (n: string, over: object) => prisma.contact.create({ data: { workspaceId: wsA, displayName: n, emails: [{ value: `${n}${domain}`, primary: true }], ...over } });
    await mk("granted", { consentStatus: "GRANTED" }); await mk("denied", { consentStatus: "DENIED" }); await mk("dnc", { consentStatus: "GRANTED", doNotContact: true }); await mk("unknown", { consentStatus: null });
    expect(await importFromContacts(wsA, admin, { listIds: [listA], attest: false })).toMatchObject({ ok: false });
    expect(await importFromContacts(wsA, admin, { listIds: [listA], attest: true })).toMatchObject({ ok: true, data: { created: 1 } });
    expect(await sub(`granted${domain}`)).toMatchObject({ source: "contact", subscriptions: [{ consentSource: "CONTACT" }] });
    expect(await sub(`denied${domain}`)).toBeNull();
    expect(await importFromContacts(wsA, admin, { listIds: [listA], attest: true, includeUnknown: true })).toMatchObject({ data: { created: 1 } });
    await saveCampaignSettings(wsA, admin, { trackOpens: false, trackClicks: false, individualTracking: false, recordConsentIp: false, sendPerMinute: 60, batchSize: 50, maxErrors: 20, softBounceLimit: 3, footerAddress: "1 Maker St", domainBlocklist: "blocked.test" });
    expect(await addSubscriber(wsA, admin, { email: "q@blocked.test", listIds: [listA], attest: true })).toMatchObject({ ok: false });
    expect(await addSubscriber(wsA, admin, { email: `added${domain}`, listIds: [listA], attest: true })).toMatchObject({ ok: true });
  });

  it("blocklists the subscriber when the contact becomes do-not-contact or is deleted", async () => {
    const c = await prisma.contact.findFirstOrThrow({ where: { workspaceId: wsA, displayName: "granted" } });
    const saved = await saveContact(actor(), { displayName: "granted", email: `granted${domain}`, doNotContact: true }, c.id);
    expect(saved.ok).toBe(true);
    expect(await sub(`granted${domain}`)).toMatchObject({ status: "BLOCKLISTED", blocklistReason: "CONTACT_DNC" });
    const u = await prisma.contact.findFirstOrThrow({ where: { workspaceId: wsA, displayName: "unknown" } });
    expect(await deleteRelationship(actor(), { type: "contact", id: u.id })).toEqual({ ok: true });
    expect(await sub(`unknown${domain}`)).toMatchObject({ status: "BLOCKLISTED", blocklistReason: "CONTACT_DNC" });
  });

  it("blocklists at once on HARD and complaints (and marks the contact), SOFT only at the threshold", async () => {
    const contact = await prisma.contact.create({ data: { workspaceId: wsA, displayName: "bc", emails: [{ value: `hard${domain}` }] } });
    for (const [e, contactId] of [[`hard${domain}`, contact.id], [`soft${domain}`, null], [`comp${domain}`, null]] as const) await prisma.subscriber.create({ data: { workspaceId: wsA, email: e, publicToken: `bp-${e}`, contactId } });
    expect(await recordBounce(wsA, { email: `hard${domain}`, kind: "HARD", source: "SES", providerEventId: "e1" })).toBe("recorded");
    expect(await sub(`hard${domain}`)).toMatchObject({ status: "BLOCKLISTED", blocklistReason: "BOUNCE_HARD" });
    expect((await prisma.contact.findUnique({ where: { id: contact.id } }))?.doNotContact).toBe(true);
    expect(await recordBounce(wsA, { email: `hard${domain}`, kind: "HARD", source: "SES", providerEventId: "e1" })).toBe("duplicate");
    for (let i = 0; i < 2; i++) await recordBounce(wsA, { email: `soft${domain}`, kind: "SOFT", source: "SES", providerEventId: `s${i}` });
    expect((await sub(`soft${domain}`))?.status).toBe("ACTIVE");
    await recordBounce(wsA, { email: `soft${domain}`, kind: "SOFT", source: "SES", providerEventId: "s2" });
    expect(await sub(`soft${domain}`)).toMatchObject({ status: "BLOCKLISTED", blocklistReason: "BOUNCE_SOFT_LIMIT" });
    await recordBounce(wsA, { email: `comp${domain}`, kind: "COMPLAINT", source: "POSTMARK" });
    expect((await sub(`comp${domain}`))?.blocklistReason).toBe("COMPLAINT");
    expect(await recordBounce(wsB, { email: `soft${domain}`, kind: "HARD", source: "SES" })).toBe("unknown_subscriber");
    expect(await prisma.auditEvent.findFirst({ where: { workspaceId: wsA, action: "campaigns.bounce" } })).toMatchObject({ metadata: { kind: expect.any(String) } });
  });

  it("checks the Postmark secret, dedupes by event id, and rejects unsigned SNS", async () => {
    await prisma.subscriber.create({ data: { workspaceId: wsA, email: `pm${domain}`, publicToken: `pm-${suffix}` } });
    expect((await handlePostmarkWebhook(hook("x", {}), wsA)).status).toBe(401);
    const secret = await rotateBounceSecret(wsA, admin);
    expect((await prisma.campaignSettings.findUniqueOrThrow({ where: { workspaceId: wsA } })).bounceWebhookSecretEnc).not.toContain(secret);
    expect(decryptSecret("campaign.bounce", (await prisma.campaignSettings.findUniqueOrThrow({ where: { workspaceId: wsA } })).bounceWebhookSecretEnc!)).toBe(secret);
    expect(await bounceSecretMatches(wsA, "wrong")).toBe(false);
    expect((await handlePostmarkWebhook(hook("wrong", {}), wsA)).status).toBe(401);
    expect((await handlePostmarkWebhook(hook(secret, {}), wsB)).status).toBe(401);
    expect((await handlePostmarkWebhook(hook(secret, {}), `missing-${suffix}`)).status).toBe(401);
    expect((await handlePostmarkWebhook(new Request(`http://x/hook?secret=${secret}`, { method: "POST", body: "{}" }), wsA)).status).toBe(401);
    expect((await handlePostmarkWebhook(new Request("http://x/hook", { method: "POST", headers: { authorization: `Basic ${Buffer.from(`u:${secret}`).toString("base64")}` }, body: "{}" }), wsA)).status).toBe(200);
    const body = { RecordType: "Bounce", TypeCode: 1, Email: `pm${domain}`, ID: 99 };
    expect(await (await handlePostmarkWebhook(hook(secret, body), wsA)).json()).toMatchObject({ outcome: "recorded" });
    expect(await (await handlePostmarkWebhook(hook(secret, body), wsA)).json()).toMatchObject({ outcome: "duplicate" });
    expect(await prisma.campaignBounce.count({ where: { workspaceId: wsA, providerEventId: "postmark:99" } })).toBe(1);
    const sns = { Type: "Notification", MessageId: "m", Message: "{}", Signature: "AAAA", SignatureVersion: "2", SigningCertURL: "https://evil.test/c.pem" };
    expect((await handleSesWebhook(hook(secret, sns), wsA)).status).toBe(403);
  });

  it("exports neutralised CSV, lists with filters, and erases a subscriber fully", async () => {
    await addSubscriber(wsA, admin, { email: `evil${domain}`, name: "=HYPERLINK(1)", listIds: [listA], attest: true });
    const exp = await exportSubscribers(wsA, admin);
    expect(exp.ok && exp.data?.content).toContain("'=HYPERLINK(1)");
    expect((await querySubscribers(wsA, { status: "BLOCKLISTED" })).rows.every((r) => r.status === "BLOCKLISTED")).toBe(true);
    expect((await querySubscribers(wsB, {})).total).toBe(0);
    const s = (await sub(`evil${domain}`))!;
    const camp = await prisma.campaign.create({ data: { workspaceId: wsA, name: "c", subject: "s", fromName: "f" } });
    const m = await prisma.campaignMessage.create({ data: { campaignId: camp.id, workspaceId: wsA, subscriberId: s.id, emailSnapshot: `evil${domain}`, token: `tk-${suffix}` } });
    await prisma.campaignEngagement.create({ data: { campaignId: camp.id, workspaceId: wsA, messageId: m.id, kind: "OPEN" } });
    expect(await eraseSubscriber(wsB, admin, s.id)).toMatchObject({ ok: false });
    expect(await eraseSubscriber(wsA, admin, s.id)).toEqual({ ok: true });
    expect(await sub(`evil${domain}`)).toBeNull();
    expect((await prisma.campaignMessage.findUniqueOrThrow({ where: { id: m.id } })).emailSnapshot).toBe("erased");
    expect(await prisma.campaignEngagement.count({ where: { campaignId: camp.id } })).toBe(0);
    expect(await prisma.auditEvent.findFirst({ where: { workspaceId: wsA, action: "campaigns.subscriber_erased" } })).toBeTruthy();
    await prisma.campaign.deleteMany({ where: { workspaceId: wsA } });
  });
});
