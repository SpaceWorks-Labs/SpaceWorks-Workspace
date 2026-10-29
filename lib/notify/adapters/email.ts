import "server-only";

import { prisma } from "@/lib/db";
import { escapeHtml, renderNotificationEmail } from "@/lib/email/templates";
import { resolveDestinationEmails } from "@/lib/notify/audience";
import type { DestinationAdapter } from "@/lib/notify/adapters/types";
import { enqueueEmail } from "@/lib/outbox";

/**
 * EMAIL destinations ({ to: string[] } and/or a people selector
 * { userIds, roles, teamIds }) and the EMAIL personal channel. Messages are
 * handed to the existing email outbox (`enqueueEmail`), which owns SMTP
 * delivery and its retries; "sent" here means queued for email.
 */

export const emailAdapter: DestinationAdapter = {
  kind: "EMAIL",
  personalChannel: "EMAIL",
  label: "Email",
  configured: true,
  async send({ deliveryId, message, target, isTest }) {
    let recipients: string[];
    if (target.type === "personal") {
      recipients = [target.user.email];
    } else {
      recipients = await resolveDestinationEmails(message.workspace.id, target.destination.config);
    }
    recipients = [...new Set(recipients.map((email) => email.toLowerCase()))].slice(0, 200);
    if (recipients.length === 0) return { ok: false, retryable: false, error: "This destination has no email recipients." };

    const lines = [message.text, `${message.severityLabel} · ${message.workspace.name}`].filter(Boolean);
    const email = renderNotificationEmail({
      title: `${isTest ? "[Test] " : ""}${message.title}`,
      bodyHtml: lines.map((line) => escapeHtml(line).replace(/\n/g, "<br>")).join("<br><br>"),
      ...(message.url ? { actionUrl: message.url, actionLabel: "Open in Space Works" } : {}),
    });
    await prisma.$transaction(async (tx) => {
      const source = message.eventType === "digest.ready" ? { notificationDigestId: deliveryId } : { notificationDeliveryId: deliveryId };
      for (const to of recipients) await enqueueEmail(tx, { workspaceId: message.workspace.id, ...source, to, ...email });
    });
    return { ok: true };
  },
};
