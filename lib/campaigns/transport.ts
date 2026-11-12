import "server-only";
import { getEmailTransportFor, getFromFor, loadWorkspaceSmtp } from "@/lib/email/workspaceTransport";

/** The shared instance relay is protected: a campaign without workspace SMTP is capped at this many recipients. */
export const SHARED_SMTP_RECIPIENT_LIMIT = 500;

export type CampaignMail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  messageId: string;
  fromName: string;
  replyTo?: string | null;
};

export type CampaignSender = {
  /** True when no workspace SMTP is enabled (the shared relay is used). */
  shared: boolean;
  /** Sending domain, used for the Message-ID. */
  domain: string;
  send: (mail: CampaignMail) => Promise<{ providerMessageId: string }>;
};

function addressOf(from: string): string {
  return /<([^>]+)>/.exec(from)?.[1] ?? from;
}

/** Resolve the pooled workspace transport once per batch. Null when no transport is configured. */
export async function createCampaignSender(workspaceId: string): Promise<CampaignSender | null> {
  const transporter = await getEmailTransportFor(workspaceId);
  if (!transporter) return null;
  const [{ from, replyTo }, smtp] = await Promise.all([getFromFor(workspaceId), loadWorkspaceSmtp(workspaceId)]);
  const address = addressOf(from);
  return {
    shared: !smtp,
    domain: address.split("@")[1] ?? "localhost",
    async send(mail) {
      const name = mail.fromName.replace(/["\\\r\n<>]/g, "").trim();
      const info = await transporter.sendMail({
        from: name ? `"${name}" <${address}>` : address,
        to: mail.to,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        headers: mail.headers,
        messageId: mail.headers["Message-ID"] ?? mail.messageId,
        ...(mail.replyTo || replyTo ? { replyTo: mail.replyTo || replyTo } : {}),
      });
      return { providerMessageId: String(info.messageId ?? mail.messageId) };
    },
  };
}

export type SendFailure = "hard" | "transient";

/** 5xx replies and rejected recipients are permanent; auth, network and 4xx errors are retried. */
export function classifySendError(error: unknown): SendFailure {
  const e = (error ?? {}) as { code?: string; responseCode?: number; rejected?: unknown[] };
  if (e.code === "EAUTH" || e.code === "ECONNECTION" || e.code === "ETIMEDOUT" || e.code === "ESOCKET" || e.code === "EDNS") return "transient";
  if (Array.isArray(e.rejected) && e.rejected.length > 0) return "hard";
  if (typeof e.responseCode === "number" && e.responseCode >= 500) return "hard";
  return "transient";
}
