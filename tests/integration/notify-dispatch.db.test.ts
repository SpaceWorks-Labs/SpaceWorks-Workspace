import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { processNotifyDelivery } from "@/lib/notify/deliver";
import { dispatch, NOTIFY_DELIVER_KIND, sendTest } from "@/lib/notify/dispatch";
import { getScopedDestinationIds, listPickableDestinations, setScopedDestinations } from "@/lib/notify/scopedRules";
import { deliverOutboxBatch } from "@/lib/outbox";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@notify-${suffix}.test`;
const slug = `notify-${suffix}`;
let workspaceId: string;
let owner: string;
let admin: string;
let member: string;
let guest: string;
let outsider: string;
let channelId: string;
let emailDest: string;
let channelDest: string;
let adminsDest: string;
let slackDest: string;

const notificationsFor = (userId: string, eventId: string) => prisma.notification.findMany({ where: { userId, eventId } });
const outboxFor = (deliveryIds: string[]) =>
  prisma.outboxMessage.findMany({ where: { kind: NOTIFY_DELIVER_KIND, OR: deliveryIds.map((id) => ({ payload: { path: ["deliveryId"], equals: id } })) } });

describe.sequential("notification dispatch", () => {
  beforeAll(async () => {
    owner = (await createUser(`owner${domain}`, "Owner")).id;
    admin = (await createUser(`admin${domain}`, "Admin")).id;
    member = (await createUser(`member${domain}`, "Member")).id;
    guest = (await createUser(`guest${domain}`, "Guest")).id;
    outsider = (await createUser(`outsider${domain}`, "Outsider")).id;
    workspaceId = (await createWorkspace(slug, owner)).id;
    await addMember(workspaceId, admin, "ADMIN");
    await addMember(workspaceId, member, "MEMBER");
    await addMember(workspaceId, guest, "GUEST");
    channelId = (await prisma.channel.findFirstOrThrow({ where: { workspaceId, slug: "general" } })).id;

    const destination = (name: string, kind: "EMAIL" | "WORKSPACE_CHANNEL" | "IN_APP_USERS" | "SLACK", config: object) =>
      prisma.notificationDestination.create({ data: { workspaceId, name, kind, config, createdById: owner } }).then((row) => row.id);
    emailDest = await destination("Ops email", "EMAIL", { to: [`ops${domain}`] });
    channelDest = await destination("#general", "WORKSPACE_CHANNEL", { channelId });
    adminsDest = await destination("All admins", "IN_APP_USERS", { roles: ["OWNER", "ADMIN"] });
    slackDest = await destination("#ops on Slack", "SLACK", { channelId: "C123" });

    await prisma.notificationRule.create({
      data: {
        workspaceId,
        name: "Services to ops",
        eventTypes: ["monitor.*"],
        createdById: owner,
        destinations: { create: [{ destinationId: emailDest }, { destinationId: channelDest }, { destinationId: adminsDest }] },
      },
    });
    await prisma.notificationRule.create({
      data: { workspaceId, scopeType: "MONITOR", scopeId: "mon_laser", eventTypes: ["*"], createdById: owner, destinations: { create: [{ destinationId: slackDest }] } },
    });
  });

  afterAll(async () => {
    await cleanup([slug], domain);
    await prisma.$disconnect();
  });

  it("notifies personal recipients in-app, never the actor, outsiders or roles below the event's minimum", async () => {
    const result = await dispatch(workspaceId, {
      type: "task.assigned",
      title: "Owner assigned you BOT-1",
      url: `/w/${slug}/projects/BOT/tasks/1`,
      actorId: owner,
      recipients: [owner, member, guest, outsider],
      data: { taskId: "t1", taskNumber: 1, projectId: null },
    });
    expect(result.deduped).toBe(false);
    expect(await notificationsFor(member, result.eventId)).toHaveLength(1);
    expect(await notificationsFor(guest, result.eventId)).toHaveLength(1);
    expect(await notificationsFor(owner, result.eventId)).toHaveLength(0);
    expect(await notificationsFor(outsider, result.eventId)).toHaveLength(0);
    const [notification] = await notificationsFor(member, result.eventId);
    expect(notification).toMatchObject({ kind: "task.assigned", workspaceId, url: `/w/${slug}/projects/BOT/tasks/1`, actorId: owner });
    // Tasks default to in-app only: nothing queued.
    expect(result.deliveries.every((delivery) => delivery.status === "SENT")).toBe(true);

    const finance = await dispatch(workspaceId, {
      type: "finance.approval.decided",
      title: "Your request was approved",
      recipients: [guest, member],
      data: { approvalRequestId: "a1", subjectType: "PURCHASE_REQUEST", subjectId: "p1", decision: "APPROVED" },
    });
    expect(await notificationsFor(guest, finance.eventId)).toHaveLength(0);
    expect(await notificationsFor(member, finance.eventId)).toHaveLength(1);
  });

  it("queues preferred external channels through the outbox", async () => {
    await prisma.notificationPreference.create({ data: { workspaceId, userId: member, category: "tasks", channels: ["IN_APP", "EMAIL", "TELEGRAM_DM"] } });
    const result = await dispatch(workspaceId, {
      type: "task.assigned",
      title: "Admin assigned you BOT-2",
      actorId: admin,
      recipients: [member],
      data: { taskId: "t2", taskNumber: 2, projectId: null },
    });
    const queued = result.deliveries.filter((delivery) => delivery.status === "PENDING");
    // Telegram is not linked, so only email is queued.
    expect(queued.map((delivery) => delivery.target)).toEqual([`user:${member}:EMAIL`]);
    const outbox = await outboxFor(queued.map((delivery) => delivery.id!));
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.status).toBe("PENDING");
  });

  it("routes broadcast events by workspace and scoped rules, expanding in-app destinations inline", async () => {
    const result = await dispatch(workspaceId, {
      type: "monitor.down",
      title: "Equipment monitor is down",
      url: `/w/${slug}/services`,
      scope: { monitorId: "mon_laser", tags: ["web"] },
      dedupeKey: "monitor:mon_laser:down:inc_1",
      threadKey: "incident:inc_1",
      data: { monitorId: "mon_laser", incidentId: "inc_1", statusCode: 504, error: "TIMEOUT" },
    });
    const byTarget = Object.fromEntries(result.deliveries.map((delivery) => [delivery.target, delivery]));
    expect(byTarget[`destination:${emailDest}`]?.status).toBe("PENDING");
    expect(byTarget[`destination:${channelDest}`]?.status).toBe("PENDING");
    expect(byTarget[`destination:${slackDest}`]?.status).toBe("PENDING");
    expect(byTarget[`destination:${adminsDest}`]?.status).toBe("SENT");
    expect(await notificationsFor(owner, result.eventId)).toHaveLength(1);
    expect(await notificationsFor(admin, result.eventId)).toHaveLength(1);
    expect(await notificationsFor(member, result.eventId)).toHaveLength(0);

    const pendingIds = result.deliveries.filter((delivery) => delivery.status === "PENDING").map((delivery) => delivery.id!);
    expect(await outboxFor(pendingIds)).toHaveLength(3);
    const event = await prisma.notificationEventRecord.findUniqueOrThrow({ where: { id: result.eventId } });
    expect(event).toMatchObject({ type: "monitor.down", severity: "CRITICAL", threadKey: "incident:inc_1" });

    // The same incident again inside the window is dropped entirely.
    const again = await dispatch(workspaceId, {
      type: "monitor.down",
      title: "Equipment monitor is down",
      scope: { monitorId: "mon_laser" },
      dedupeKey: "monitor:mon_laser:down:inc_1",
      data: { monitorId: "mon_laser", incidentId: "inc_1", statusCode: 504, error: "TIMEOUT" },
    });
    expect(again).toMatchObject({ deduped: true, eventId: result.eventId });
    expect(await prisma.notificationEventRecord.count({ where: { workspaceId, dedupeKey: "monitor:mon_laser:down:inc_1" } })).toBe(1);

    // A reminder bypasses dedupe.
    const reminder = await dispatch(workspaceId, {
      type: "monitor.down",
      title: "Still down: equipment monitor",
      scope: { monitorId: "mon_laser" },
      dedupeKey: "monitor:mon_laser:down:inc_1",
      reminderOf: result.eventId,
      data: { monitorId: "mon_laser", incidentId: "inc_1", statusCode: 504, error: "TIMEOUT" },
    });
    expect(reminder.deduped).toBe(false);
  });

  it("applies only the scoped rule when the entity opts out of workspace rules", async () => {
    const result = await dispatch(workspaceId, {
      type: "monitor.up",
      title: "Equipment monitor recovered",
      scope: { monitorId: "mon_laser" },
      useWorkspaceRules: false,
      data: { monitorId: "mon_laser", incidentId: "inc_1", downtimeSec: 300 },
    });
    expect(result.deliveries.map((delivery) => delivery.target)).toEqual([`destination:${slackDest}`]);
  });

  it("holds deliveries during a rule's quiet hours", async () => {
    const quietRule = await prisma.notificationRule.create({
      data: {
        workspaceId,
        name: "Quiet invoices",
        eventTypes: ["invoice.overdue"],
        quietHours: { start: "22:00", end: "07:00", tz: "UTC" },
        createdById: owner,
        destinations: { create: [{ destinationId: emailDest }] },
      },
    });
    const now = new Date("2026-10-19T23:00:00Z");
    const result = await dispatch(
      workspaceId,
      { type: "invoice.overdue", title: "Invoice INV-7 is overdue", data: { invoiceId: "inv_7", number: "INV-7", dueOn: "2026-10-01" } },
      { now },
    );
    const delivery = await prisma.notificationDelivery.findFirstOrThrow({ where: { eventId: result.eventId, destinationId: emailDest } });
    expect(delivery.scheduledFor.toISOString()).toBe("2026-10-20T07:00:00.000Z");
    const [outbox] = await outboxFor([delivery.id]);
    expect(outbox!.availableAt.toISOString()).toBe("2026-10-20T07:00:00.000Z");
    await prisma.notificationRule.delete({ where: { id: quietRule.id } });
  });

  it("skips members who muted the resource", async () => {
    await prisma.notificationMute.create({ data: { workspaceId, userId: member, resourceType: "project", resourceId: "proj_quiet" } });
    const result = await dispatch(workspaceId, {
      type: "task.commented",
      title: "New comment",
      recipients: [member],
      scope: { projectId: "proj_quiet" },
      data: { taskId: "t3", taskNumber: 3, projectId: "proj_quiet", commentId: "c1" },
    });
    expect(await notificationsFor(member, result.eventId)).toHaveLength(0);
    expect(result.deliveries).toEqual([expect.objectContaining({ status: "SKIPPED", reason: "muted" })]);
  });

  it("commits with the caller's transaction and announces afterwards", async () => {
    const result = await prisma.$transaction((tx) =>
      dispatch(
        workspaceId,
        { type: "task.assigned", title: "Owner assigned a task", actorId: owner, recipients: [member], data: { taskId: "t1", taskNumber: 1, projectId: null } },
        { tx },
      ),
    );
    await result.afterCommit();
    expect(await notificationsFor(member, result.eventId)).toHaveLength(1);
  });

  it("delivers queued jobs: channel card, email outbox, and a failing provider marks the destination", async () => {
    const result = await dispatch(workspaceId, {
      type: "monitor.down",
      title: "Wiki is down",
      body: "Connection refused.",
      url: `/w/${slug}/services`,
      scope: { monitorId: "mon_laser" },
      data: { monitorId: "mon_laser", incidentId: null, statusCode: null, error: "CONN_REFUSED" },
    });
    const idFor = (destinationId: string) => result.deliveries.find((delivery) => delivery.target === `destination:${destinationId}`)!.id!;

    expect(await processNotifyDelivery(idFor(channelDest))).toEqual({ status: "done" });
    const card = await prisma.message.findFirstOrThrow({ where: { channelId, origin: "notify" }, orderBy: { createdAt: "desc" } });
    expect(card.authorKind).toBe("SYSTEM");
    expect(card.body).toContain("[Critical] Wiki is down");

    expect(await processNotifyDelivery(idFor(emailDest))).toEqual({ status: "done" });
    const email = await prisma.outboxMessage.findFirst({ where: { kind: "email", payload: { path: ["to"], equals: `ops${domain}` } }, orderBy: { createdAt: "desc" } });
    expect(email).not.toBeNull();
    expect(await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: idFor(emailDest) } })).toMatchObject({ status: "SENT", attempts: 1 });

    const failed = await processNotifyDelivery(idFor(slackDest));
    expect(failed).toEqual({ status: "failed", error: "This destination needs an active, verified connection. Check messaging settings." });
    expect(await prisma.notificationDestination.findUniqueOrThrow({ where: { id: slackDest } })).toMatchObject({ health: "ERROR" });
    const alert = await prisma.notification.findFirst({ where: { userId: admin, kind: "system.destination_failed" } });
    expect(alert?.title).toBe("Notifications to #ops on Slack are failing");

    // Already finished deliveries are not sent twice.
    expect(await processNotifyDelivery(idFor(channelDest))).toEqual({ status: "done" });
    expect(await prisma.message.count({ where: { channelId, origin: "notify", body: { contains: "Wiki is down" } } })).toBe(1);
  });

  it("stores an entity's Send-to choices as one scoped rule", async () => {
    const saved = await setScopedDestinations(prisma, {
      workspaceId,
      scopeType: "SUBSCRIPTION",
      scopeId: "sub_domain",
      destinationIds: [emailDest, channelDest, "dest_from_elsewhere"],
      actorId: owner,
      eventTypes: ["renewal.due"],
    });
    expect(saved.destinationIds.sort()).toEqual([emailDest, channelDest].sort());
    expect((await getScopedDestinationIds(workspaceId, "SUBSCRIPTION", "sub_domain")).sort()).toEqual([emailDest, channelDest].sort());

    const result = await dispatch(workspaceId, {
      type: "renewal.due",
      title: "spaceworks.in renews in 7 days",
      scope: { subscriptionId: "sub_domain" },
      data: { subscriptionId: "sub_domain", renewsAt: new Date().toISOString(), daysLeft: 7 },
    });
    expect(result.deliveries.map((delivery) => delivery.target).sort()).toEqual([`destination:${emailDest}`, `destination:${channelDest}`].sort());

    await setScopedDestinations(prisma, { workspaceId, scopeType: "SUBSCRIPTION", scopeId: "sub_domain", destinationIds: [], actorId: owner });
    expect(await prisma.notificationRule.count({ where: { workspaceId, scopeType: "SUBSCRIPTION" } })).toBe(0);
  });

  it("offers members only member-selectable in-app and channel destinations", async () => {
    await prisma.notificationDestination.update({ where: { id: channelDest }, data: { config: { channelId, memberSelectable: true } } });
    expect((await listPickableDestinations(workspaceId, "MEMBER")).map((row) => row.id)).toEqual([channelDest]);
    expect((await listPickableDestinations(workspaceId, "ADMIN")).length).toBe(4);
  });

  it("runs notify jobs from the shared outbox worker", async () => {
    const test = await sendTest(workspaceId, channelDest, owner);
    const delivery = test.deliveries[0]!;
    expect(delivery.status).toBe("PENDING");
    expect(await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id! } })).toMatchObject({ isTest: true });

    const jobs = await outboxFor([delivery.id!]);
    await deliverOutboxBatch(100, { ids: jobs.map(job => job.id) });
    expect(await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id! } })).toMatchObject({ status: "SENT" });
    const [job] = await outboxFor([delivery.id!]);
    expect(job!.status).toBe("SENT");
    expect(await prisma.message.count({ where: { channelId, body: { startsWith: "[Test] Test notification from Space Works" } } })).toBe(1);
  });
});
