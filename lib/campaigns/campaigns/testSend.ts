import "server-only";
import { prisma } from "@/lib/db";
import { auditCampaignEvent } from "@/lib/campaigns/audit";
import { enqueueEmail } from "@/lib/outbox";
import { actionError, validationError, type ActionResult } from "@/lib/actionResult";
import { checkRateLimitById } from "@/lib/rateLimit";
import { canManageCampaigns } from "@/lib/campaigns/roles";
import { getCampaignSettings } from "@/lib/campaigns/settings";
import { renderPreviewHtml } from "@/lib/campaigns/campaigns/content";
import { testSendSchema } from "@/lib/campaigns/campaigns/schemas";
import { getCampaign, type Actor } from "@/lib/campaigns/campaigns/crud";

/**
 * Send a test to the caller plus up to 5 addresses through the transactional
 * outbox. Links in a test are inert. Only an ADMIN may send to arbitrary
 * addresses; anyone else may add only active members of this workspace. Each
 * user has a daily budget of recipients (bucket campaignTestSend). Test sends
 * are not counted in the monthly email cap: they leave no per-message row.
 */
export async function sendTestEmail(actor: Actor, id: string, input: unknown): Promise<ActionResult<{ sent: number }>> {
  const parsed = testSendSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const campaign = await getCampaign(actor.workspaceId, id);
  if (!campaign) return actionError("That campaign no longer exists.");
  const [settings, workspace, template] = await Promise.all([
    getCampaignSettings(actor.workspaceId),
    prisma.workspace.findUniqueOrThrow({ where: { id: actor.workspaceId }, select: { name: true } }),
    campaign.templateId ? prisma.emailTemplate.findFirst({ where: { id: campaign.templateId, workspaceId: actor.workspaceId }, select: { bodyHtml: true } }) : null,
  ]);
  const self = actor.email.toLowerCase();
  const recipients = [...new Set([self, ...parsed.data.extra.map((e) => e.toLowerCase())])];
  const others = recipients.filter((to) => to !== self);
  if (others.length && !canManageCampaigns(actor)) {
    const members = await prisma.membership.findMany({ where: { workspaceId: actor.workspaceId, status: "ACTIVE", user: { email: { in: others, mode: "insensitive" } } }, select: { user: { select: { email: true } } } });
    const known = new Set(members.map((m) => m.user.email?.toLowerCase()));
    if (others.some((to) => !known.has(to))) return actionError("You can only send a test to yourself or to members of this workspace. Ask an admin to test other addresses.");
  }
  if (!(await checkRateLimitById("campaignTestSend", actor.userId, recipients.length))) return actionError("You have reached today's test email limit. Try again tomorrow.");
  await prisma.$transaction(async (tx) => {
    for (const to of recipients) {
      const { html, text } = renderPreviewHtml({ bodyHtml: campaign.bodyHtml, bodyText: campaign.bodyText, templateHtml: template?.bodyHtml, footerAddress: settings.footerAddress ?? "", workspaceName: workspace.name, sample: { name: "Test Recipient", email: to } });
      await enqueueEmail(tx, { workspaceId: actor.workspaceId, to, subject: `[Test] ${campaign.subject}`.slice(0, 200), html, text });
    }
    await auditCampaignEvent({ client: tx, action: "campaign_test_sent", workspaceId: actor.workspaceId, actorId: actor.userId, targetType: "Campaign", targetId: id, metadata: { count: recipients.length } });
  });
  return { ok: true, data: { sent: recipients.length } };
}
