import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createCampaign, deleteCampaign, duplicateCampaign, getCampaign, listTemplates, pauseCampaign, saveTemplate, scheduleCampaign, sendTestEmail, updateCampaign, type Actor } from "@/lib/campaigns/campaigns";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@e2c-${suffix}.test`;
const slug = `e2c-${suffix}`;
let owner: Actor;
let member: Actor;
let listId = "";

const input = (over: Record<string, unknown> = {}) => ({ name: "News", subject: "Hello", fromName: "Acme", contentType: "RICHTEXT", bodySource: '<p>Hi</p><script>x()</script>', listIds: [listId], ...over });

describe.sequential("campaign CRUD and guards", () => {
  beforeAll(async () => {
    const ownerUser = await createUser(`owner${domain}`);
    const ws = await createWorkspace(slug, ownerUser.id);
    owner = { workspaceId: ws.id, userId: ownerUser.id, role: "OWNER", email: ownerUser.email };
    member = { ...owner, role: "MEMBER" };
    listId = (await prisma.mailingList.create({ data: { workspaceId: ws.id, name: "L", slug: "l" } })).id;
  });
  afterAll(async () => {
    await prisma.campaign.deleteMany({ where: { workspaceId: owner.workspaceId } });
    await cleanup([slug], domain);
  });

  it("creates a draft with sanitised body, edits it, and blocks edits after scheduling", async () => {
    const created = await createCampaign(member, input());
    expect(created.ok).toBe(true);
    const id = created.ok ? created.data!.id : "";
    const row = await getCampaign(owner.workspaceId, id);
    expect(row?.bodyHtml).toBe("<p>Hi</p>");
    expect(row?.bodyText).toBe("Hi");
    expect((await updateCampaign(member, id, input({ subject: "Changed" }))).ok).toBe(true);
    expect((await scheduleCampaign(owner, id, null)).ok).toBe(false); // no footer address, so the checklist blocks it
    await prisma.campaignSettings.create({ data: { workspaceId: owner.workspaceId, footerAddress: "1 Main St" } });
    await prisma.mailingList.update({ where: { id: listId }, data: {} });
    await prisma.campaign.update({ where: { id }, data: { status: "SCHEDULED", scheduledAt: new Date(Date.now() + 3_600_000) } });
    expect((await updateCampaign(owner, id, input())).ok).toBe(false);
    expect((await deleteCampaign(owner, id)).ok).toBe(false);
    expect((await pauseCampaign(owner, id)).ok).toBe(false);
  });

  it("restricts raw HTML to admins and rejects lists from another workspace", async () => {
    expect((await createCampaign(member, input({ contentType: "HTML" }))).ok).toBe(false);
    expect((await createCampaign(owner, input({ contentType: "HTML" }))).ok).toBe(true);
    expect((await createCampaign(owner, input({ listIds: ["not-a-list"] }))).ok).toBe(false);
  });

  it("duplicates into a draft and deletes drafts", async () => {
    const created = await createCampaign(owner, input());
    const copy = await duplicateCampaign(owner, created.ok ? created.data!.id : "");
    expect(copy.ok).toBe(true);
    const copyId = copy.ok ? copy.data!.id : "";
    expect((await getCampaign(owner.workspaceId, copyId))?.status).toBe("DRAFT");
    expect((await deleteCampaign(owner, copyId)).ok).toBe(true);
  });

  it("keeps one default template and sanitises template HTML", async () => {
    const a = await saveTemplate(owner, null, { name: "A", bodyHtml: "<div>{{content}}</div><script>x</script>", isDefault: true });
    const b = await saveTemplate(owner, null, { name: "B", bodyHtml: "<div>{{content}}</div>", isDefault: true });
    expect(a.ok && b.ok).toBe(true);
    const rows = await listTemplates(owner.workspaceId);
    expect(rows.filter((t) => t.isDefault).map((t) => t.name)).toEqual(["B"]);
    expect(rows.find((t) => t.name === "A")?.bodyHtml).not.toContain("script");
  });

  it("limits member test sends to themselves or workspace members, and rate limits them", async () => {
    const mu = await createUser(`mem${domain}`);
    await addMember(owner.workspaceId, mu.id);
    const peer = await createUser(`peer${domain}`);
    await addMember(owner.workspaceId, peer.id);
    const mem: Actor = { ...owner, userId: mu.id, role: "MEMBER", email: mu.email };
    const created = await createCampaign(mem, input());
    const id = created.ok ? created.data!.id : "";
    expect((await sendTestEmail(mem, id, { extra: ["outsider@elsewhere.test"] })).ok).toBe(false);
    expect((await sendTestEmail(mem, id, { extra: [peer.email.toUpperCase()] })).ok).toBe(true);
    expect((await sendTestEmail(owner, id, { extra: ["outsider@elsewhere.test"] })).ok).toBe(true);
    expect((await sendTestEmail(mem, id, {})).ok).toBe(true);
    // Budget is 20 recipients per user per day: 2 + 1 used so far.
    for (let i = 0; i < 17; i++) expect((await sendTestEmail(mem, id, {})).ok).toBe(true);
    expect((await sendTestEmail(mem, id, {})).ok).toBe(false);
  });
});
