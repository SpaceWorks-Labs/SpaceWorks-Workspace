import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { dispatch } from "@/lib/notify/dispatch";
import { processNotifyDelivery } from "@/lib/notify/deliver";
import { deliverOutboxBatch } from "@/lib/outbox";
import { mayDeliverNotification } from "@/lib/notify/access";
import { emailAdapter } from "@/lib/notify/adapters/email";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const { send } = vi.hoisted(() => ({ send: vi.fn<(to: string) => Promise<void>>(async () => undefined) }));
vi.mock("@/lib/email/send", () => ({ sendRenderedEmail: send }));

const suffix = uniqueSuffix();
const domain = `@notify-revoke-${suffix}.test`;
const slug = `notify-revoke-${suffix}`;
let workspaceId: string;
let userId: string;

async function queued() {
  const event = await dispatch(workspaceId, {
    type: "it.review_due", title: "Private access review", recipients: [userId],
    data: { recordId: "review", dueOn: "2026-10-29" },
  });
  return prisma.notificationDelivery.findFirstOrThrow({ where: { eventId: event.eventId, personalChannel: "EMAIL" } });
}

async function emailFor(deliveryId: string) {
  return prisma.outboxMessage.findFirstOrThrow({
    where: { kind: "email", payload: { path: ["notificationDeliveryId"], equals: deliveryId } },
  });
}

describe.sequential("queued notifications respect revoked access", () => {
  beforeAll(async () => {
    const owner = await createUser(`owner${domain}`);
    workspaceId = (await createWorkspace(slug, owner.id)).id;
    userId = (await createUser(`recipient${domain}`)).id;
    await addMember(workspaceId, userId, "ADMIN");
  });

  beforeEach(async () => {
    send.mockClear();
    await prisma.workspace.update({ where: { id: workspaceId }, data: { archivedAt: null } });
    await prisma.user.update({ where: { id: userId }, data: { disabledAt: null, email: `recipient${domain}` } });
    await prisma.membership.update({ where: { userId_workspaceId: { userId, workspaceId } }, data: { role: "ADMIN", status: "ACTIVE" } });
  });

  afterAll(async () => {
    await cleanup([slug], domain);
    await prisma.$disconnect();
  });

  it.each(["disabled", "demoted", "suspended", "archived"])("cancels routing after access is %s", async (change) => {
    const delivery = await queued();
    if (change === "disabled") await prisma.user.update({ where: { id: userId }, data: { disabledAt: new Date() } });
    if (change === "demoted") await prisma.membership.update({ where: { userId_workspaceId: { userId, workspaceId } }, data: { role: "GUEST" } });
    if (change === "suspended") await prisma.membership.update({ where: { userId_workspaceId: { userId, workspaceId } }, data: { status: "SUSPENDED" } });
    if (change === "archived") await prisma.workspace.update({ where: { id: workspaceId }, data: { archivedAt: new Date() } });
    await processNotifyDelivery(delivery.id);
    expect(await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).toMatchObject({ status: "CANCELLED" });
    expect(send).not.toHaveBeenCalled();
  });

  it.each(["disabled", "email changed", "demoted", "archived", "removed"])("rechecks before SMTP after the recipient is %s", async (change) => {
    const delivery = await queued();
    await processNotifyDelivery(delivery.id);
    const email = await emailFor(delivery.id);
    if (change === "disabled") await prisma.user.update({ where: { id: userId }, data: { disabledAt: new Date() } });
    if (change === "email changed") await prisma.user.update({ where: { id: userId }, data: { email: `changed${domain}` } });
    if (change === "demoted") await prisma.membership.update({ where: { userId_workspaceId: { userId, workspaceId } }, data: { role: "GUEST" } });
    if (change === "archived") await prisma.workspace.update({ where: { id: workspaceId }, data: { archivedAt: new Date() } });
    if (change === "removed") await prisma.membership.delete({ where: { userId_workspaceId: { userId, workspaceId } } });
    try {
      await deliverOutboxBatch(1, { ids: [email.id] });
      expect(send).not.toHaveBeenCalled();
      expect(await prisma.outboxMessage.findUnique({ where: { id: email.id } })).toBeNull();
    } finally {
      if (change === "removed") await addMember(workspaceId, userId, "ADMIN");
    }
  });

  it("delivers mail for a still-authorized recipient", async () => {
    const delivery = await queued();
    await processNotifyDelivery(delivery.id);
    const email = await emailFor(delivery.id);
    await deliverOutboxBatch(1, { ids: [email.id] });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toBe(`recipient${domain}`);
  });

  it("cancels mail after a destination is disabled", async () => {
    const destination = await prisma.notificationDestination.create({
      data: { workspaceId, name: "Audit mail", kind: "EMAIL", config: { to: [`recipient${domain}`] }, createdById: userId },
    });
    const event = await dispatch(workspaceId, { type: "notification.test", title: "Audit", data: { destinationId: destination.id } }, { onlyDestinationIds: [destination.id] });
    const deliveryId = event.deliveries[0].id!;
    await processNotifyDelivery(deliveryId);
    const email = await emailFor(deliveryId);
    await prisma.notificationDestination.update({ where: { id: destination.id }, data: { enabled: false } });
    await deliverOutboxBatch(1, { ids: [email.id] });
    expect(send).not.toHaveBeenCalled();
  });

  it("does not dispatch to a disabled account", async () => {
    await prisma.user.update({ where: { id: userId }, data: { disabledAt: new Date() } });
    const event = await dispatch(workspaceId, {
      type: "it.review_due", title: "Review", recipients: [userId],
      data: { recordId: "review", dueOn: "2026-10-29" },
    });
    expect(event.deliveries).toHaveLength(0);
  });

  it.each([false, true])("preserves digest mail and checks revocation (disabled: %s)", async (disabled) => {
    const digest = await prisma.notificationDigestItem.create({
      data: { workspaceId, userId, eventId: "digest-fixture", channel: "EMAIL", dueAt: new Date(0) },
    });
    await emailAdapter.send({
      deliveryId: digest.id, event: { id: digest.id, type: "digest.ready" }, isTest: false, thread: null,
      message: {
        title: "Your Space Works digest", text: "You have updates.", url: null,
        severity: "info", severityLabel: "Info", fields: [], actions: [], eventType: "digest.ready",
        workspace: { id: workspaceId, name: "Test", slug },
      },
      target: { type: "personal", channel: "EMAIL", user: { id: userId, email: `recipient${domain}`, name: "Recipient" }, identity: null },
    });
    const email = await prisma.outboxMessage.findFirstOrThrow({
      where: { kind: "email", payload: { path: ["notificationDigestId"], equals: digest.id } },
    });
    if (disabled) await prisma.user.update({ where: { id: userId }, data: { disabledAt: new Date() } });
    await deliverOutboxBatch(1, { ids: [email.id] });
    expect(send).toHaveBeenCalledTimes(disabled ? 0 : 1);
  });

  it("fails closed for a deleted delivery", async () => {
    expect(await mayDeliverNotification("missing")).toBe(false);
  });
});
