import "server-only";

import { assertEmailAccepted } from "./transporter";
import { getEmailTransportFor, getFromFor } from "./workspaceTransport";
import type { RenderedEmail } from "./templates";

/**
 * Send one rendered email. Without SMTP in development it is dropped with a log line (never the content).
 * Pass `workspaceId` only for workspace-scoped mail (invoice, notification, campaign): it uses that
 * workspace's SMTP when enabled, else the instance transport. Account mail omits it.
 */
export async function sendRenderedEmail(to: string, email: RenderedEmail, messageId?: string, workspaceId: string | null = null) {
  const transporter = await getEmailTransportFor(workspaceId);
  const { from, replyTo } = await getFromFor(workspaceId);
  if (!transporter) {
    console.log("[email] SMTP not configured; message dropped in development");
    return;
  }
  const result = await transporter.sendMail({ messageId, from, ...(replyTo ? { replyTo } : {}), to, subject: email.subject, text: email.text, html: email.html, attachments: email.attachments, ...(email.calendarInvite ? { icalEvent: { method: email.calendarInvite.method, content: email.calendarInvite.content, filename: "meeting.ics" } } : {}) });
  assertEmailAccepted(result);
}
