import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { randomToken } from "@/lib/crypto";
import { cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const slug = `cc-${suffix}`;
const emailSuffix = `@cc-${suffix}.test`;

describe.sequential("campaign data and workspace deletion", () => {
  let wsId = "";
  beforeAll(async () => {
    const owner = await createUser(`owner${emailSuffix}`);
    wsId = (await createWorkspace(slug, owner.id)).id;
  });
  afterAll(async () => cleanup([slug], emailSuffix));

  it("deletes a workspace that has lists, campaigns and messages", async () => {
    const owner = await prisma.membership.findFirstOrThrow({ where: { workspaceId: wsId } });
    const list = await prisma.mailingList.create({ data: { workspaceId: wsId, name: "L", slug: "l", optIn: "SINGLE" } });
    const sub = await prisma.subscriber.create({ data: { workspaceId: wsId, email: `a${emailSuffix}`, emailDomain: emailSuffix.slice(1), publicToken: randomToken(16) } });
    const campaign = await prisma.campaign.create({
      data: { workspaceId: wsId, name: "C", subject: "S", fromName: "F", bodyHtml: "<p>x</p>", bodyText: "x", status: "FINISHED", createdById: owner.userId, lists: { create: [{ listId: list.id }] } },
    });
    await prisma.campaignMessage.create({ data: { campaignId: campaign.id, workspaceId: wsId, subscriberId: sub.id, emailSnapshot: sub.email, status: "SENT", token: randomToken(16) } });
    await prisma.workspace.delete({ where: { id: wsId } });
    expect(await prisma.campaignList.count({ where: { listId: list.id } })).toBe(0);
    expect(await prisma.mailingList.count({ where: { id: list.id } })).toBe(0);
    expect(await prisma.campaignMessage.count({ where: { campaignId: campaign.id } })).toBe(0);
  });
});
