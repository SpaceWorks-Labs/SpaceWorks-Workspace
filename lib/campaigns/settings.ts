import "server-only";

import { z } from "zod";
import type { CampaignSettings } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { decryptSecret, encryptSecret, randomToken, safeEqual } from "@/lib/crypto";
import { actionError, validationError, type ActionResult } from "@/lib/actionResult";
import { auditCampaignEvent } from "./audit";
import { parseDomainList } from "./policy";

export type CampaignSettingsView = Omit<CampaignSettings, "bounceWebhookSecretEnc" | "updatedAt"> & { hasBounceSecret: boolean };

const DEFAULTS = { trackOpens: false, trackClicks: false, individualTracking: false, recordConsentIp: false, sendPerMinute: 60, batchSize: 50, maxErrors: 20, softBounceLimit: 3, domainBlocklist: [] as string[], footerAddress: null as string | null };

/** The workspace's settings, or the defaults when it has never saved any. */
export async function getCampaignSettings(workspaceId: string, db: DbClient = prisma): Promise<CampaignSettingsView> {
  const row = await db.campaignSettings.findUnique({ where: { workspaceId } });
  const { bounceWebhookSecretEnc, updatedAt: _updatedAt, ...rest } = row ?? { workspaceId, bounceWebhookSecretEnc: null, updatedAt: new Date(), ...DEFAULTS };
  void _updatedAt;
  return { ...rest, hasBounceSecret: Boolean(bounceWebhookSecretEnc) };
}

export const settingsSchema = z.object({
  trackOpens: z.boolean(),
  trackClicks: z.boolean(),
  individualTracking: z.boolean(),
  recordConsentIp: z.boolean(),
  sendPerMinute: z.number().int().min(1).max(600),
  batchSize: z.number().int().min(1).max(200),
  maxErrors: z.number().int().min(1).max(1000),
  softBounceLimit: z.number().int().min(1).max(20),
  footerAddress: z.string().trim().max(400).default(""),
  domainBlocklist: z.string().max(20_000).default(""),
});

export async function saveCampaignSettings(workspaceId: string, actorId: string, input: unknown): Promise<ActionResult> {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { domains, invalid } = parseDomainList(parsed.data.domainBlocklist);
  if (invalid.length) return actionError(`These are not domains: ${invalid.slice(0, 5).join(", ")}. Use names like example.com.`, { domainBlocklist: invalid });
  const { domainBlocklist: _text, footerAddress, ...rest } = parsed.data;
  void _text;
  const data = { ...rest, footerAddress: footerAddress || null, domainBlocklist: domains, individualTracking: rest.individualTracking && (rest.trackOpens || rest.trackClicks) };
  await prisma.$transaction(async (tx) => {
    await tx.campaignSettings.upsert({ where: { workspaceId }, create: { workspaceId, ...data }, update: data });
    await auditCampaignEvent({ client: tx, workspaceId, actorId, action: "settings_changed", targetType: "CampaignSettings", targetId: workspaceId });
  });
  return { ok: true };
}

/** Create or replace the shared bounce-webhook secret. The plaintext is returned once and never stored. */
export async function rotateBounceSecret(workspaceId: string, actorId: string): Promise<string> {
  const secret = randomToken(32);
  const enc = encryptSecret("campaign.bounce", secret);
  await prisma.$transaction(async (tx) => {
    await tx.campaignSettings.upsert({ where: { workspaceId }, create: { workspaceId, bounceWebhookSecretEnc: enc }, update: { bounceWebhookSecretEnc: enc } });
    await auditCampaignEvent({ client: tx, workspaceId, actorId, action: "bounce_secret_rotated", targetType: "CampaignSettings", targetId: workspaceId });
  });
  return secret;
}

/** Constant-time check of a presented webhook secret. False when none is configured. */
export async function bounceSecretMatches(workspaceId: string, presented: string | null | undefined): Promise<boolean> {
  if (!presented) return false;
  const row = await prisma.campaignSettings.findUnique({ where: { workspaceId }, select: { bounceWebhookSecretEnc: true } });
  if (!row?.bounceWebhookSecretEnc) return false;
  try {
    return safeEqual(decryptSecret("campaign.bounce", row.bounceWebhookSecretEnc), presented);
  } catch {
    return false;
  }
}
