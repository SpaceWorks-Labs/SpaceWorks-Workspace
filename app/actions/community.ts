"use server";

import { revalidatePath } from "@/lib/frontend/cache";
import { z } from "zod";
import { actionError, NOT_ALLOWED, RATE_LIMITED, validationError, type ActionResult } from "@/lib/actionResult";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { getWorkspaceForAction } from "@/lib/permissions";
import type { ModuleKey } from "@/lib/modules";
import { deleteAnnouncement, saveAnnouncement, setAnnouncementPinned } from "@/lib/community/announcements";
import { createFeed, revokeFeed } from "@/lib/community/feeds";
import { idInputSchema, pinInputSchema } from "@/lib/community/validation";

/**
 * Community mutations. Each action resolves the workspace from the slug
 * server-side and rate-limits, then hands over to `lib/community`, which
 * checks the capability, validates, writes in a transaction, audits and
 * dispatches.
 */

const slugSchema = z.string().min(1).max(64);

async function context(slug: unknown, module: ModuleKey = "community") {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return null;
  const ctx = await getWorkspaceForAction(parsed.data, "GUEST", { module });
  if (!ctx) return null;
  if (await isActionRateLimited("action", ctx.user.id)) return "limited" as const;
  return ctx;
}

function refresh(slug: string, area: "announcements") {
  revalidatePath(`/w/${slug}/${area}`, "layout");
  revalidatePath(`/w/${slug}`);
}

const validId = (id: string | null) => id === null || idInputSchema.safeParse({ id }).success;

/* ───────────── Announcements ───────────── */

export async function saveAnnouncementAction(slug: string, announcementId: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (ctx === "limited") return actionError(RATE_LIMITED);
  if (!validId(announcementId)) return actionError("That announcement no longer exists.");
  const result = await saveAnnouncement(ctx, input, announcementId);
  if (result.ok) refresh(ctx.workspace.slug, "announcements");
  return result;
}

export async function pinAnnouncementAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (ctx === "limited") return actionError(RATE_LIMITED);
  const parsed = pinInputSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await setAnnouncementPinned(ctx, parsed.data.id, parsed.data.pinned);
  if (result.ok) refresh(ctx.workspace.slug, "announcements");
  return result;
}

export async function deleteAnnouncementAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (ctx === "limited") return actionError(RATE_LIMITED);
  const parsed = idInputSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await deleteAnnouncement(ctx, parsed.data.id);
  if (result.ok) refresh(ctx.workspace.slug, "announcements");
  return result;
}

/* ───────────── Calendar feeds ───────────── */

export async function createFeedAction(slug: string, input: unknown): Promise<ActionResult<{ url: string; webcalUrl: string }>> {
  const ctx = await context(slug, "core");
  if (!ctx) return actionError(NOT_ALLOWED);
  if (ctx === "limited") return actionError(RATE_LIMITED);
  const result = await createFeed(ctx, input);
  if (result.ok) revalidatePath(`/w/${ctx.workspace.slug}/calendar/subscribe`);
  return result;
}

export async function revokeFeedAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await context(slug, "core");
  if (!ctx) return actionError(NOT_ALLOWED);
  if (ctx === "limited") return actionError(RATE_LIMITED);
  const result = await revokeFeed(ctx, input);
  if (result.ok) revalidatePath(`/w/${ctx.workspace.slug}/calendar/subscribe`);
  return result;
}
