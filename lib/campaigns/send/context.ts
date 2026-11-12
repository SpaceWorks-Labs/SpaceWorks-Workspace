import { prisma } from "@/lib/db";
import { collectLinks, ensureCampaignLinks, pixelHtml, rewriteLinks } from "@/lib/campaigns/links";
import { compileCampaign } from "@/lib/campaigns/render";
import { campaignBaseUrl } from "@/lib/campaigns/send/urls";
import type { CampaignSender } from "@/lib/campaigns/transport";
import type { SendSettings } from "@/lib/campaigns/send/settings";

export type SendContext = {
  campaign: { id: string; workspaceId: string; name: string; subject: string; fromName: string; replyTo: string | null; createdById: string | null };
  workspaceName: string;
  listIds: string[];
  sender: CampaignSender;
  settings: SendSettings;
  base: string;
  html: string;
  text: string;
};

type CampaignRow = SendContext["campaign"] & { bodyHtml: string; bodyText: string; templateId: string | null; trackOpens: boolean; trackClicks: boolean };

/** Compile the per-campaign source once per run: template, footer, tracking links and pixel. */
export async function buildContext(row: CampaignRow, sender: CampaignSender, settings: SendSettings): Promise<SendContext> {
  const [workspace, lists, template] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({ where: { id: row.workspaceId }, select: { name: true } }),
    prisma.campaignList.findMany({ where: { campaignId: row.id }, select: { listId: true } }),
    row.templateId ? prisma.emailTemplate.findFirst({ where: { id: row.templateId, workspaceId: row.workspaceId }, select: { bodyHtml: true } }) : null,
  ]);
  const base = campaignBaseUrl();
  const compiled = compileCampaign({ templateHtml: template?.bodyHtml ?? null, contentHtml: row.bodyHtml, contentText: row.bodyText, footerAddress: settings.footerAddress });
  let html = compiled.html;
  if (row.trackClicks) {
    const ids = await ensureCampaignLinks(row.workspaceId, row.id, collectLinks(html));
    html = rewriteLinks(html, ids, base);
  }
  if (row.trackOpens) html += pixelHtml(base);
  const { id, workspaceId, name, subject, fromName, replyTo, createdById } = row;
  return { campaign: { id, workspaceId, name, subject, fromName, replyTo, createdById }, workspaceName: workspace.name, listIds: lists.map((l) => l.listId), sender, settings, base, html, text: compiled.text };
}
