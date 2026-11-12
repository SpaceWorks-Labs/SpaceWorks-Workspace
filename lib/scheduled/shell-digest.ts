import "server-only";
import { prisma } from "@/lib/db";
import { PERSONAL_CHANNEL_ADAPTERS } from "@/lib/notify/adapters";
import {
  DM_CHANNEL_PROVIDER,
  availablePersonalChannels,
} from "@/lib/notify/preferences";
import { deliveryTime, parseQuietHours } from "@/lib/notify/quietHours";
import type { PersonalChannel } from "@prisma/client";

export async function flushDigest(now: Date) {
  await prisma.$transaction(
    async (tx) => {
      const first = await tx.notificationDigestItem.findFirst({
        where: { sentAt: null, dueAt: { lte: now } },
        orderBy: { dueAt: "asc" },
      });
      if (!first) return;
      const locked = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM "NotificationDigestItem" WHERE "workspaceId"=${first.workspaceId} AND "userId"=${first.userId} AND channel::text=${first.channel} AND "sentAt" IS NULL AND "dueAt"<=${now} ORDER BY "dueAt" LIMIT 500 FOR UPDATE SKIP LOCKED`;
      if (!locked.length) return;
      const ids = locked.map((r) => r.id);
      const member = await tx.membership.findFirst({
        where: {
          workspaceId: first.workspaceId,
          userId: first.userId,
          status: "ACTIVE",
          user: { disabledAt: null },
          workspace: { status: "ACTIVE", archivedAt: null },
        },
        include: {
          user: { select: { id: true, name: true, email: true } },
          workspace: { select: { id: true, name: true, slug: true } },
        },
      });
      if (!member || first.channel === "IN_APP") {
        await tx.notificationDigestItem.updateMany({
          where: { id: { in: ids } },
          data: { sentAt: now },
        });
        return;
      }
      const settings = await tx.notificationUserSettings.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: first.workspaceId,
            userId: first.userId,
          },
        },
      });
      if (
        deliveryTime({
          at: now,
          severity: "info",
          quietHours: parseQuietHours(settings?.quietHours),
          snoozedUntil: settings?.snoozedUntil,
        }).getTime() > now.getTime()
      )
        return;
      const links = await tx.externalIdentityLink.findMany({
        where: {
          workspaceId: first.workspaceId,
          userId: first.userId,
          connection: { workspaceId: first.workspaceId, status: "ACTIVE" },
        },
        include: { connection: true },
      });
      if (
        !availablePersonalChannels(
          member.role,
          links.map((l) => l.provider),
        ).has(first.channel)
      ) {
        await tx.notificationDigestItem.updateMany({
          where: { id: { in: ids } },
          data: { sentAt: now },
        });
        return;
      }
      const channel = first.channel as Exclude<PersonalChannel, "IN_APP">;
      const adapter = PERSONAL_CHANNEL_ADAPTERS[channel];
      if (!adapter.configured) return;
      const identity =
        channel === "EMAIL"
          ? null
          : (links.find((l) => l.provider === DM_CHANNEL_PROVIDER[channel]) ??
            null);
      const sent = await adapter.send({
        deliveryId: first.id,
        event: { id: first.id, type: "digest.ready" },
        message: {
          title: "Your Space Works digest",
          text: `You have ${ids.length} updates. Open your notification centre to catch up.`,
          url: new URL(
            `/w/${member.workspace.slug}/notifications`,
            process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3250",
          ).href,
          severity: "info",
          severityLabel: "Info",
          fields: [],
          actions: [],
          eventType: "digest.ready",
          workspace: member.workspace,
        },
        target: { type: "personal", channel, user: member.user, identity },
        thread: null,
        isTest: false,
      });
      if (sent.ok)
        await tx.notificationDigestItem.updateMany({
          where: {
            id: { in: ids },
            workspaceId: first.workspaceId,
            userId: first.userId,
          },
          data: { sentAt: now },
        });
    },
    { timeout: 60000 },
  );
}
