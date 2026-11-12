import "server-only";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { checkRateLimitById } from "@/lib/rateLimit";
import { sha256Hex } from "@/lib/crypto";
import { getCampaignSettings } from "../settings";
import { subscribeToList } from "../subscriptions";
import { isDomainBlocked, isValidEmail, normaliseEmail } from "../policy";
import { checkFormToken } from "./formToken";
import { resolvePublicWorkspace } from "./gate";

export const NEUTRAL_MESSAGE = "Thanks. If this address can be added, we've sent it an email with the next step.";

const bodySchema = z.object({
  workspaceSlug: z.string().trim().min(1).max(64),
  listSlug: z.string().trim().min(1).max(80),
  email: z.string().trim().max(320),
  name: z.string().trim().max(160).optional(),
  hp: z.string().max(200).optional(),
  ts: z.string().max(600).optional(),
});

export type SubscribeResult =
  | { status: "ok" }
  | { status: "not_found" }
  | { status: "invalid"; message: string }
  | { status: "rate_limited" };

export const consentTextFor = (listName: string) => `Subscribed to "${listName}" through the public sign-up form.`;

/**
 * Public subscribe, transport-agnostic. Every accepted or silently dropped
 * request yields the same `ok`, so the reply never says whether an address is
 * already known, blocklisted, throttled or on a blocked domain.
 */
export async function handleSubscribe(raw: unknown, ctx: { ip: string; userAgent?: string | null; now?: number }): Promise<SubscribeResult> {
  if (!(await checkRateLimitById("campaignPublic", `subscribe:${ctx.ip}`)) || !(await checkRateLimitById("subscribe", `ip:${ctx.ip}`))) return { status: "rate_limited" };
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return { status: "invalid", message: "Check the form and try again." };
  const body = parsed.data;
  const workspace = await resolvePublicWorkspace({ slug: body.workspaceSlug });
  if (!workspace) return { status: "not_found" };
  const list = await prisma.mailingList.findUnique({ where: { workspaceId_slug: { workspaceId: workspace.id, slug: body.listSlug } } });
  if (!list || list.visibility !== "PUBLIC" || list.archivedAt) return { status: "not_found" };
  const timing = checkFormToken(body.ts, workspace.id, list.id, ctx.now);
  if (timing === "expired" || timing === "invalid") return { status: "invalid", message: "This form has expired. Reload the page and try again." };
  if (timing === "too_fast" || body.hp) return { status: "ok" };
  if (!isValidEmail(body.email)) return { status: "invalid", message: "Enter a valid email address." };
  const email = normaliseEmail(body.email);
  if (!(await checkRateLimitById("subscribe", `email:${workspace.id}:${sha256Hex(email)}`))) return { status: "ok" };
  const settings = await getCampaignSettings(workspace.id);
  if (isDomainBlocked(email, settings.domainBlocklist)) return { status: "ok" };
  await subscribeToList({ workspaceId: workspace.id, workspaceName: workspace.name, list, email, name: body.name, source: "FORM", consentText: consentTextFor(list.name), ip: ctx.ip === "unknown" ? null : ctx.ip, userAgent: ctx.userAgent, recordConsentIp: settings.recordConsentIp });
  return { status: "ok" };
}
