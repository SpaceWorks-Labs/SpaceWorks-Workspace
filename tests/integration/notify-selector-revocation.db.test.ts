import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { dispatch } from "@/lib/notify/dispatch";
import { processNotifyDelivery } from "@/lib/notify/deliver";
import { deliverOutboxBatch } from "@/lib/outbox";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const { send } = vi.hoisted(() => ({ send: vi.fn<(to: string) => Promise<void>>(async () => undefined) }));
vi.mock("@/lib/email/send", () => ({ sendRenderedEmail: send }));

const suffix = uniqueSuffix();
const domain = `@notify-selector-${suffix}.test`;
const slug = `notify-selector-${suffix}`;
const recipientEmail = `recipient${domain}`;
let workspaceId: string;
let ownerId: string;
let userId: string;
let teamId: string;
let sequence = 0;

async function queued(config: Prisma.InputJsonValue = { roles: ["ADMIN"] }, to = recipientEmail) {
  const destination = await prisma.notificationDestination.create({
    data: { workspaceId, name: `Audit destination ${++sequence}`, kind: "EMAIL", config, createdById: ownerId },
  });
  const event = await dispatch(workspaceId, {
    type: "notification.test", title: "Private operating update", data: { destinationId: destination.id },
  }, { onlyDestinationIds: [destination.id] });
  const deliveryId = event.deliveries[0].id!;
  await processNotifyDelivery(deliveryId);
  const email = await prisma.outboxMessage.findFirstOrThrow({
    where: { kind: "email", AND: [
      { payload: { path: ["notificationDeliveryId"], equals: deliveryId } },
      { payload: { path: ["to"], equals: to } },
    ] },
  });
  return { destinationId: destination.id, emailId: email.id, to };
}

async function deliver(email: Awaited<ReturnType<typeof queued>>, allowed: boolean) {
  await deliverOutboxBatch(1, { ids: [email.emailId] });
  expect(send).toHaveBeenCalledTimes(allowed ? 1 : 0);
  if (allowed) {
    expect(send.mock.calls[0][0]).toBe(email.to);
    expect(await prisma.outboxMessage.findUniqueOrThrow({ where: { id: email.emailId } })).toMatchObject({ status: "SENT" });
  } else {
    expect(await prisma.outboxMessage.findUnique({ where: { id: email.emailId } })).toBeNull();
  }
}

describe.sequential("destination email selectors are checked again before SMTP", () => {
  beforeAll(async () => {
    ownerId = (await createUser(`owner${domain}`)).id;
    workspaceId = (await createWorkspace(slug, ownerId)).id;
    userId = (await createUser(recipientEmail)).id;
    await addMember(workspaceId, userId, "ADMIN");
    teamId = (await prisma.team.create({ data: { workspaceId, name: "Audit team", slug: "audit-team", createdById: ownerId } })).id;
  });

  beforeEach(async () => {
    send.mockClear();
    await prisma.workspace.update({ where: { id: workspaceId }, data: { archivedAt: null } });
    await prisma.user.update({ where: { id: userId }, data: { email: recipientEmail, disabledAt: null } });
    await prisma.membership.upsert({
      where: { userId_workspaceId: { userId, workspaceId } },
      create: { userId, workspaceId, role: "ADMIN" }, update: { role: "ADMIN", status: "ACTIVE" },
    });
    await prisma.teamMember.upsert({
      where: { teamId_userId: { teamId, userId } }, create: { teamId, userId }, update: {},
    });
  });

  afterAll(async () => {
    await cleanup([slug], domain);
    await prisma.$disconnect();
  });

  it.each(["role", "team", "user"])("delivers to an unchanged %s selector recipient", async (selector) => {
    const config = selector === "role" ? { roles: ["ADMIN"] } : selector === "team" ? { teamIds: [teamId] } : { userIds: [userId] };
    await deliver(await queued(config), true);
  });

  it.each(["demoted", "disabled", "suspended", "removed", "email changed", "archived"])("rejects a role-selected recipient after access is %s", async (change) => {
    const email = await queued();
    if (change === "demoted") await prisma.membership.update({ where: { userId_workspaceId: { userId, workspaceId } }, data: { role: "MEMBER" } });
    if (change === "disabled") await prisma.user.update({ where: { id: userId }, data: { disabledAt: new Date() } });
    if (change === "suspended") await prisma.membership.update({ where: { userId_workspaceId: { userId, workspaceId } }, data: { status: "SUSPENDED" } });
    if (change === "removed") await prisma.membership.delete({ where: { userId_workspaceId: { userId, workspaceId } } });
    if (change === "email changed") await prisma.user.update({ where: { id: userId }, data: { email: `changed${domain}` } });
    if (change === "archived") await prisma.workspace.update({ where: { id: workspaceId }, data: { archivedAt: new Date() } });
    await deliver(email, false);
  });

  it("rejects a team-selected recipient who leaves that team", async () => {
    const email = await queued({ teamIds: [teamId] });
    await prisma.teamMember.delete({ where: { teamId_userId: { teamId, userId } } });
    await deliver(email, false);
  });

  it.each(["role", "team", "user", "cleared"])("honors the current %s selector config", async (selector) => {
    const initial = selector === "team" ? { teamIds: [teamId] } : selector === "user" ? { userIds: [userId] } : { roles: ["ADMIN"] };
    const email = await queued(initial);
    const config = selector === "role" ? { roles: ["OWNER"] } : selector === "team" ? { teamIds: [] } : selector === "user" ? { userIds: [ownerId] } : {};
    await prisma.notificationDestination.update({ where: { id: email.destinationId }, data: { config } });
    await deliver(email, false);
  });

  it.each(["disabled", "removed", "type changed", "address removed"])("cancels queued email when its destination is %s", async (change) => {
    const email = await queued({ to: [recipientEmail] });
    if (change === "disabled") await prisma.notificationDestination.update({ where: { id: email.destinationId }, data: { enabled: false } });
    if (change === "removed") await prisma.notificationDestination.delete({ where: { id: email.destinationId } });
    if (change === "type changed") await prisma.notificationDestination.update({ where: { id: email.destinationId }, data: { kind: "WEBHOOK" } });
    if (change === "address removed") await prisma.notificationDestination.update({ where: { id: email.destinationId }, data: { config: { to: [] } } });
    await deliver(email, false);
  });

  it.each(["demoted", "disabled", "removed", "email changed"])("preserves explicit static overlap after a selected member is %s", async (change) => {
    const email = await queued({ roles: ["ADMIN"], to: [recipientEmail.toUpperCase()] });
    if (change === "demoted") await prisma.membership.update({ where: { userId_workspaceId: { userId, workspaceId } }, data: { role: "MEMBER" } });
    if (change === "disabled") await prisma.user.update({ where: { id: userId }, data: { disabledAt: new Date() } });
    if (change === "removed") await prisma.membership.delete({ where: { userId_workspaceId: { userId, workspaceId } } });
    if (change === "email changed") await prisma.user.update({ where: { id: userId }, data: { email: `changed${domain}` } });
    await deliver(email, true);
  });

  it("keeps explicitly configured external static recipients", async () => {
    const external = `external${domain}`;
    await deliver(await queued({ to: [external] }, external), true);
  });

  it("honors an address explicitly added to static recipients after routing", async () => {
    const email = await queued();
    await prisma.user.update({ where: { id: userId }, data: { disabledAt: new Date() } });
    await prisma.notificationDestination.update({ where: { id: email.destinationId }, data: { config: { to: [recipientEmail] } } });
    await deliver(email, true);
  });
});
