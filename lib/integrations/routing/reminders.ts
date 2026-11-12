import "server-only";
import { prisma } from "@/lib/db";
import { dispatch } from "@/lib/notify";
import { ruleMatchesEvent, fromDbSeverity } from "@/lib/notify/match";
import { deliveryTime, parseQuietHours } from "@/lib/notify/quietHours";
import type { NotificationEvent } from "@/lib/notify/types";

/** Repeat the latest warning/critical event in a thread until superseded, for at most seven days. */
export async function sendRoutingReminders(now = new Date()) {
  const rules = await prisma.notificationRule.findMany({ where: { enabled: true, reminderIntervalMin: { gt: 0 }, workspace: { status: "ACTIVE", archivedAt: null } }, include: { destinations: { where: { destination: { enabled: true } }, select: { destinationId: true } } }, take: 100 });
  for (const rule of rules) {
    const deliveries = await prisma.notificationDelivery.findMany({ where: { workspaceId: rule.workspaceId, ruleId: rule.id, status: "SENT", isTest: false, event: { reminderOf: null, threadKey: { not: null }, severity: { in: ["WARNING", "CRITICAL"] }, createdAt: { gt: new Date(now.getTime() - 7 * 86400000), lt: new Date(now.getTime() - rule.reminderIntervalMin * 60000) } } }, include: { event: true }, distinct: ["eventId"], orderBy: { createdAt: "desc" }, take: 25 });
    for (const { event } of deliveries) {
      const result = await prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sww:reminder:${rule.id}:${event.id}`}))`;
        if (await tx.notificationEventRecord.findFirst({ where: { workspaceId: rule.workspaceId, threadKey: event.threadKey, reminderOf: null, createdAt: { gt: event.createdAt } } })) return null;
        const prior = await tx.notificationEventRecord.findFirst({ where: { workspaceId: rule.workspaceId, reminderOf: event.id, dedupeKey: { startsWith: `reminder:${rule.id}:` } }, orderBy: { createdAt: "desc" }, include: { deliveries: { select: { status: true, scheduledFor: true, lastAttemptAt: true } } } });
        if (prior) {
          if (prior.deliveries.some(d => d.status === "PENDING" || d.status === "SENDING" || d.status === "FAILED")) return null;
          const lastSent = Math.max(prior.createdAt.getTime(), ...prior.deliveries.map(d => (d.lastAttemptAt ?? d.scheduledFor).getTime()));
          if (lastSent + rule.reminderIntervalMin * 60000 > now.getTime()) return null;
        }
        const envelope = event.payload as unknown as NotificationEvent;
        const severity = fromDbSeverity(event.severity);
        if (!ruleMatchesEvent(rule, { type: event.type, severity, scope: envelope.scope })) return null;
        const scheduledFor = deliveryTime({ at: now, severity, quietHours: parseQuietHours(rule.quietHours), criticalBypasses: rule.criticalBypassesQuiet });
        return dispatch<NotificationEvent["type"]>(rule.workspaceId, { ...envelope, type: event.type as NotificationEvent["type"], title: `Reminder: ${event.title}`.slice(0, 150), severity, occurredAt: now, reminderOf: event.id, threadKey: event.threadKey ?? undefined, dedupeKey: `reminder:${rule.id}:${event.id}:${Math.floor(now.getTime() / 60000)}`, recipients: [] }, { tx, onlyDestinationIds: rule.destinations.map(d => d.destinationId), now: scheduledFor });
      });
      await result?.afterCommit();
    }
  }
}
