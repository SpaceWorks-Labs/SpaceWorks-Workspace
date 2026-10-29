import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { parsePeopleSelector, resolveSelectorMembers } from "@/lib/notify/audience";
import { destinationTarget, partitionDuplicates, PERSONAL_DEDUPE_WINDOW_SEC, personalTarget } from "@/lib/notify/dedupe";
import { audienceIncludesBroadcast, audienceIncludesPersonal, EVENT_CATALOG, type EventSpec, type EventType } from "@/lib/notify/events";
import { selectBroadcastTargets } from "@/lib/notify/match";
import { digestDueAt, resolvePersonalChannels } from "@/lib/notify/preferences";
import { deliveryTime, parseQuietHours } from "@/lib/notify/quietHours";
import type { DispatchDelivery, DispatchOptions, DispatchResult, NotificationEvent } from "@/lib/notify/types";
import { hasRoleAtLeast } from "@/lib/roles";
import type { Candidate } from "./dispatch-types";
import { persistDispatch } from "./dispatch-persistence";

/**
 * The single notification entry point. Producers describe what happened;
 * workspace rules, entity "Send to" rules and member preferences decide where
 * it goes. See docs/ARCHITECTURE.md › Notification routing.
 *
 * 1. Validate against the catalogue and fill the default severity.
 * 2. Broadcast: matching rules → destinations (quiet hours per rule).
 * 3. Personal: recipients minus the actor, active members at or above the
 *    event's minimum role, not muted → in-app always, plus their preferred
 *    channels (quiet hours, snooze, digest).
 * 4. Dedupe repeats of `dedupeKey` per target inside each window.
 * 5. Persist the event, in-app notifications and delivery rows; queue an
 *    outbox job ("notify.deliver") per external delivery. Realtime nudges run
 *    after commit.
 */

export { NOTIFY_DELIVER_KIND } from "./dispatch-persistence";

type Tx = Prisma.TransactionClient;

const noop = async () => undefined;

export async function dispatch<T extends EventType>(workspaceId: string, event: NotificationEvent<T>, options: DispatchOptions = {}): Promise<DispatchResult> {
  const spec: EventSpec | undefined = EVENT_CATALOG[event.type];
  if (!spec) throw new Error(`Unknown notification event type "${String(event.type)}".`);
  if (options.tx) return dispatchWith(options.tx, workspaceId, event, spec, options);
  const result = await prisma.$transaction((tx) => dispatchWith(tx, workspaceId, event, spec, options), { timeout: 15_000 });
  await result.afterCommit();
  return { ...result, afterCommit: noop };
}

/** Test send for one destination: bypasses rules, quiet hours and dedupe; deliveries are flagged `isTest`. */
export async function sendTest(workspaceId: string, destinationId: string, actorId: string) {
  return dispatch(
    workspaceId,
    {
      type: "notification.test",
      title: "Test notification from Space Works",
      body: "If you can read this, the destination works.",
      actorId,
      data: { destinationId },
    },
    { onlyDestinationIds: [destinationId], test: true },
  );
}

async function dispatchWith<T extends EventType>(tx: Tx, workspaceId: string, event: NotificationEvent<T>, spec: EventSpec, options: DispatchOptions): Promise<DispatchResult> {
  const now = options.now ?? new Date();
  const severity = event.severity ?? spec.severity;
  const explicit = options.onlyDestinationIds;
  const meetsRole = (role: Parameters<typeof hasRoleAtLeast>[0]) => !spec.minRole || hasRoleAtLeast(role, spec.minRole);
  const candidates: Candidate[] = [];
  const skipped: DispatchDelivery[] = [];

  // ── Broadcast ──
  const destinationCandidate = async (
    destination: { id: string; kind: string; config: Prisma.JsonValue },
    ruleId: string | null,
    scheduledFor: Date,
    windowSec: number,
  ) => {
    const target = destinationTarget(destination.id);
    if (destination.kind === "IN_APP_USERS") {
      const members = await resolveSelectorMembers(workspaceId, parsePeopleSelector(destination.config), tx);
      const userIds = members.filter((member) => meetsRole(member.role) && member.userId !== event.actorId).map((member) => member.userId);
      candidates.push({ kind: "inline-destination", target, windowSec, destinationId: destination.id, ruleId, userIds });
    } else {
      candidates.push({ kind: "destination", target, windowSec, destinationId: destination.id, ruleId, scheduledFor });
    }
  };

  if (explicit) {
    const destinations = await tx.notificationDestination.findMany({
      where: { workspaceId, id: { in: explicit.slice(0, 50) } },
      select: { id: true, kind: true, config: true },
    });
    for (const destination of destinations) await destinationCandidate(destination, null, now, 0);
  } else if (audienceIncludesBroadcast(spec.audience)) {
    const rules = await tx.notificationRule.findMany({
      where: { workspaceId, enabled: true },
      include: { destinations: { select: { destination: { select: { id: true, kind: true, config: true, enabled: true } } } } },
    });
    const destinations = new Map(rules.flatMap((rule) => rule.destinations.map(({ destination }) => [destination.id, destination] as const)));
    const targets = selectBroadcastTargets(
      rules.map((rule) => ({ ...rule, destinationIds: rule.destinations.filter(({ destination }) => destination.enabled).map(({ destination }) => destination.id) })),
      { type: event.type, severity, scope: event.scope, useWorkspaceRules: event.useWorkspaceRules },
      now,
    );
    for (const target of targets) await destinationCandidate(destinations.get(target.destinationId)!, target.ruleId, target.scheduledFor, target.dedupeWindowSec);
  }

  // ── Personal ──
  const recipientIds = [...new Set(event.recipients ?? [])].filter((id) => id && id !== event.actorId).slice(0, 1000);
  if (!explicit && audienceIncludesPersonal(spec.audience) && recipientIds.length > 0) {
    const members = (await tx.membership.findMany({ where: { workspaceId, status: "ACTIVE", user: { disabledAt: null }, workspace: { archivedAt: null }, userId: { in: recipientIds } }, select: { userId: true, role: true } })).filter((member) =>
      meetsRole(member.role),
    );
    const userIds = members.map((member) => member.userId);
    const windowSec = event.dedupeWindowSec ?? PERSONAL_DEDUPE_WINDOW_SEC;
    if (userIds.length > 0) {
      const preferences = await tx.notificationPreference.findMany({ where: { workspaceId, category: spec.category, OR: [{ userId: null }, { userId: { in: userIds } }] } });
      const settings = new Map((await tx.notificationUserSettings.findMany({ where: { workspaceId, userId: { in: userIds } } })).map((row) => [row.userId, row]));
      const links = await tx.externalIdentityLink.findMany({ where: { workspaceId, userId: { in: userIds }, connection: { status: "ACTIVE" } }, select: { userId: true, provider: true } });
      const muteKeys = muteKeysFor(event);
      const muted = new Set(
        muteKeys.length === 0
          ? []
          : (
              await tx.notificationMute.findMany({
                where: { workspaceId, userId: { in: userIds }, OR: muteKeys, AND: [{ OR: [{ until: null }, { until: { gt: now } }] }] },
                select: { userId: true },
              })
            ).map((row) => row.userId),
      );
      const workspaceDefault = preferences.find((row) => row.userId === null) ?? null;

      for (const member of members) {
        if (muted.has(member.userId)) {
          skipped.push({ id: null, target: personalTarget(member.userId, "*"), status: "SKIPPED", reason: "muted" });
          continue;
        }
        candidates.push({ kind: "in-app", target: personalTarget(member.userId, "IN_APP"), windowSec, userId: member.userId });
        const resolved = resolvePersonalChannels({
          category: spec.category,
          eventType: event.type,
          role: member.role,
          userPreference: preferences.find((row) => row.userId === member.userId) ?? null,
          workspaceDefault,
          linkedProviders: links.filter((link) => link.userId === member.userId).map((link) => link.provider),
        });
        if (resolved.digestFrequency === "OFF") continue;
        const userSettings = settings.get(member.userId);
        const bypassesQuiet = userSettings?.criticalBypassesQuiet ?? true;
        const urgent = severity === "critical" && bypassesQuiet;
        const dueAt = urgent ? null : digestDueAt(resolved.digestFrequency, now);
        for (const channel of resolved.channels) {
          if (channel === "IN_APP") continue;
          const target = personalTarget(member.userId, channel);
          if (dueAt) {
            candidates.push({ kind: "digest", target, windowSec, userId: member.userId, channel, frequency: resolved.digestFrequency, dueAt });
          } else {
            const scheduledFor = deliveryTime({
              at: now,
              severity,
              quietHours: parseQuietHours(userSettings?.quietHours),
              criticalBypasses: bypassesQuiet,
              snoozedUntil: userSettings?.snoozedUntil ?? null,
            });
            candidates.push({ kind: "personal", target, windowSec, userId: member.userId, channel, scheduledFor });
          }
        }
      }
    }
  }

  // ── Dedupe ──
  let kept = candidates;
  if (event.dedupeKey && !event.reminderOf && !explicit && !options.test) {
    const maxWindow = Math.max(PERSONAL_DEDUPE_WINDOW_SEC, event.dedupeWindowSec ?? 0, ...candidates.map((candidate) => candidate.windowSec));
    const prior = await tx.notificationEventRecord.findMany({
      where: { workspaceId, dedupeKey: event.dedupeKey, isTest: false, createdAt: { gte: new Date(now.getTime() - maxWindow * 1000) } },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, deliveries: { select: { destinationId: true, userId: true, personalChannel: true, createdAt: true } } },
    });
    if (prior.length > 0) {
      const priorDeliveries = prior.flatMap((record) =>
        record.deliveries.map((delivery) => ({
          target: delivery.destinationId ? destinationTarget(delivery.destinationId) : personalTarget(delivery.userId ?? "", delivery.personalChannel ?? ""),
          at: delivery.createdAt,
        })),
      );
      const partition = partitionDuplicates(candidates, priorDeliveries, now);
      kept = partition.kept;
      const dropped = partition.dropped.map((candidate) => ({ id: null, target: candidate.target, status: "SKIPPED" as const, reason: "duplicate" }));
      if (kept.length === 0) return { eventId: prior[0]!.id, deduped: true, deliveries: [...dropped, ...skipped], afterCommit: noop };
      skipped.push(...dropped);
    }
  }

  // ── Persist ──
  return persistDispatch(tx, workspaceId, event, severity, options, now, kept, skipped);
}

function muteKeysFor(event: NotificationEvent): Prisma.NotificationMuteWhereInput[] {
  const keys: Prisma.NotificationMuteWhereInput[] = [];
  if (event.resource) keys.push({ resourceType: event.resource.type, resourceId: event.resource.id });
  const scope = event.scope ?? {};
  if (scope.projectId) keys.push({ resourceType: "project", resourceId: scope.projectId });
  if (scope.channelId) keys.push({ resourceType: "channel", resourceId: scope.channelId });
  if (scope.monitorId) keys.push({ resourceType: "monitor", resourceId: scope.monitorId });
  if (scope.taskId) keys.push({ resourceType: "task", resourceId: scope.taskId });
  return keys;
}
