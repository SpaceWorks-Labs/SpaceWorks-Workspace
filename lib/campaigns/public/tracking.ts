import "server-only";

import { prisma } from "@/lib/db";
import { verifyCampaignToken } from "../tokens";
import { resolvePublicWorkspace } from "./gate";

/** 43-byte transparent GIF. */
export const PIXEL_GIF = Buffer.from("R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==", "base64");

/**
 * Record an open. Counters only unless the campaign snapshotted
 * individualTracking. No IP or user agent is read or stored. Returns false
 * when the token or workspace is not valid (the route answers 404). With
 * `count` false (over the rate limit) it validates and writes nothing.
 */
export async function recordOpen(token: string, count = true): Promise<boolean> {
  const payload = verifyCampaignToken(token, "open");
  if (!payload?.messageId || !(await resolvePublicWorkspace({ id: payload.workspaceId }))) return false;
  const message = await prisma.campaignMessage.findFirst({ where: { id: payload.messageId, workspaceId: payload.workspaceId }, select: { id: true, campaignId: true, campaign: { select: { trackOpens: true, individualTracking: true } } } });
  if (!message) return false;
  if (!message.campaign.trackOpens || !count) return true;
  await prisma.$transaction(async (tx) => {
    const first = await tx.campaignMessage.updateMany({ where: { id: message.id, openedAt: null }, data: { openedAt: new Date() } });
    if (!first.count) return;
    await tx.campaign.update({ where: { id: message.campaignId }, data: { openCount: { increment: 1 } } });
    if (message.campaign.individualTracking) await tx.campaignEngagement.create({ data: { campaignId: message.campaignId, workspaceId: payload.workspaceId, messageId: message.id, kind: "OPEN" } });
  });
  return true;
}

/** Only web links may be redirected to. */
export function isRedirectableUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Resolve a tracked link and record the click when the campaign tracks them.
 * The link is looked up inside the token's own campaign, and the destination
 * is the stored URL, never anything from the request.
 */
export async function resolveClick(token: string, linkId: string, count = true): Promise<string | null> {
  const payload = verifyCampaignToken(token, "click");
  if (!payload?.messageId || !(await resolvePublicWorkspace({ id: payload.workspaceId }))) return null;
  const message = await prisma.campaignMessage.findFirst({ where: { id: payload.messageId, workspaceId: payload.workspaceId }, select: { id: true, campaignId: true, firstClickedAt: true, campaign: { select: { trackClicks: true, individualTracking: true } } } });
  if (!message) return null;
  const link = await prisma.campaignLink.findFirst({ where: { id: linkId, campaignId: message.campaignId, workspaceId: payload.workspaceId }, select: { id: true, url: true } });
  if (!link || !isRedirectableUrl(link.url)) return null;
  if (message.campaign.trackClicks && count) {
    await prisma.$transaction(async (tx) => {
      const first = await tx.campaignMessage.updateMany({ where: { id: message.id, firstClickedAt: null }, data: { firstClickedAt: new Date() } });
      await tx.campaignLink.update({ where: { id: link.id }, data: { clickCount: { increment: 1 }, ...(first.count ? { uniqueClickCount: { increment: 1 } } : {}) } });
      await tx.campaign.update({ where: { id: message.campaignId }, data: { clickCount: { increment: 1 } } });
      if (message.campaign.individualTracking) await tx.campaignEngagement.create({ data: { campaignId: message.campaignId, workspaceId: payload.workspaceId, messageId: message.id, linkId: link.id, kind: "CLICK" } });
    });
  }
  return link.url;
}
