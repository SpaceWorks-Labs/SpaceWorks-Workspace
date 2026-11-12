import "server-only";
import { prisma } from "@/lib/db";
import { getEmailTransport } from "@/lib/email/transporter";
import { emailCapSummary, SHARED_SMTP_RECIPIENT_CAP, usesSharedSmtp } from "@/lib/campaigns/limits";
import { getCampaignSettings } from "@/lib/campaigns/settings";

export async function countRecipients(workspaceId: string, listIds: string[]): Promise<number> {
  if (!listIds.length) return 0;
  return prisma.subscriber.count({
    where: { workspaceId, status: "ACTIVE", subscriptions: { some: { workspaceId, listId: { in: listIds }, status: "CONFIRMED" } } },
  });
}

export type ChecklistItem = { key: string; label: string; ok: boolean; blocking: boolean; detail?: string };
export type Checklist = { items: ChecklistItem[]; recipients: number; effectiveRecipients: number; canSend: boolean };

/** Everything the confirm dialog shows before a campaign is scheduled. */
export async function presendChecklist(workspaceId: string, campaign: { id: string; lists: Array<{ listId: string }> }): Promise<Checklist> {
  const listIds = campaign.lists.map((l) => l.listId);
  const [recipients, settings, shared, cap, tested, transport] = await Promise.all([
    countRecipients(workspaceId, listIds),
    getCampaignSettings(workspaceId),
    usesSharedSmtp(workspaceId),
    emailCapSummary(workspaceId),
    prisma.auditEvent.count({ where: { workspaceId, action: "campaigns.campaign_test_sent", targetId: campaign.id } }),
    getEmailTransport().then((t) => Boolean(t.transporter)).catch(() => false),
  ]);
  const effective = shared ? Math.min(recipients, SHARED_SMTP_RECIPIENT_CAP) : recipients;
  const items: ChecklistItem[] = [
    { key: "lists", label: "At least one list is selected", ok: listIds.length > 0, blocking: true },
    { key: "footer", label: "Footer postal address is set", ok: Boolean(settings.footerAddress?.trim()), blocking: true, detail: "Add it under Settings." },
    { key: "smtp", label: "Email sending is configured", ok: !shared || transport, blocking: true, detail: shared && transport ? `Shared relay: limited to ${SHARED_SMTP_RECIPIENT_CAP} recipients per campaign.` : undefined },
    { key: "recipients", label: `${recipients} confirmed ${recipients === 1 ? "subscriber" : "subscribers"} will receive this`, ok: recipients > 0, blocking: true },
    { key: "cap", label: "Within the monthly email cap", ok: !cap.reached, blocking: true, detail: cap.cap === null ? undefined : `${cap.used} of ${cap.cap} used this month.` },
    { key: "test", label: "A test email was sent", ok: tested > 0, blocking: false },
    { key: "dns", label: "SPF, DKIM and DMARC are set up for your sending domain", ok: true, blocking: false, detail: "Check your DNS records so mail is not marked as spam." },
  ];
  if (!cap.reached && cap.remaining !== null && effective > cap.remaining) items.push({ key: "cap-partial", label: `Only ${cap.remaining} emails remain this month`, ok: false, blocking: false, detail: "The campaign pauses when the cap is reached." });
  return { items, recipients, effectiveRecipients: effective, canSend: items.every((i) => i.ok || !i.blocking) };
}
