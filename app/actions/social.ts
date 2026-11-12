"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getWorkspaceForAction } from "@/lib/permissions";
import { canConnectSocial, canManageSocial } from "@/lib/roles";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { beginSocial, selectAccounts, SocialSetupError } from "@/lib/social/oauth";
import { changeComment, disconnectAccount, reconcileComment } from "@/lib/social/comments";
import { syncAccount } from "@/lib/social/sync";
import { PLATFORMS } from "@/lib/social/config";
import { prisma } from "@/lib/db";
import { socialToken } from "@/lib/social/tokens";
import { client, endpoint, SocialApiError } from "@/lib/social/http";
import { META } from "@/lib/social/providers/meta";
import { recordAuditEvent } from "@/lib/audit";
export async function commentAction(slug: string, input: unknown) {
  const ctx = await getWorkspaceForAction(slug, "MEMBER", { module: "social" }); if (!ctx || !canManageSocial(ctx.membership)) return { ok: false, error: "This workspace is unavailable." };
  if (await isActionRateLimited("apiWrite", ctx.user.id)) return { ok: false, error: "Too many changes. Wait a minute and try again." };
  const result = await changeComment(ctx, input); revalidatePath(`/w/${slug}/social`); revalidatePath(`/w/${slug}/social/comments`, "layout"); return result;
}
export async function connectAction(slug: string, raw: unknown) {
  const ctx = await getWorkspaceForAction(slug, "ADMIN", { module: "social" }); if (!ctx || !canConnectSocial(ctx.membership)) return { ok: false, error: "Only admins can connect accounts." };
  if (await isActionRateLimited("apiWrite", ctx.user.id)) return { ok: false, error: "Too many requests. Wait a minute and try again." };
  const platform = z.enum(PLATFORMS).safeParse(raw); if (!platform.success) return { ok: false, error: "Choose a supported platform." };
  try { return { ok: true, url: await beginSocial(ctx, platform.data) }; } catch (e) { return { ok: false, error: e instanceof SocialSetupError || e instanceof SocialApiError ? e.message : "The connection could not start. Try again." }; }
}
export async function selectAccountsAction(slug: string, raw: unknown) {
  const ctx = await getWorkspaceForAction(slug, "ADMIN", { module: "social" }); if (!ctx || !canConnectSocial(ctx.membership)) return { ok: false, error: "Only admins can connect accounts." };
  if (await isActionRateLimited("apiWrite", ctx.user.id)) return { ok: false, error: "Too many changes. Wait a minute and try again." };
  const parsed = z.object({ draftId: z.string().max(100), indexes: z.array(z.number().int().nonnegative()).min(1).max(1000) }).safeParse(raw); if (!parsed.success) return { ok: false, error: "Choose at least one account." };
  try { await selectAccounts(ctx, parsed.data.draftId, parsed.data.indexes); revalidatePath(`/w/${slug}/settings/social`); revalidatePath(`/w/${slug}/social`); return { ok: true }; } catch (e) { return { ok: false, error: e instanceof SocialSetupError || e instanceof SocialApiError ? e.message : "The accounts could not be saved. Try again." }; }
}
export async function accountAction(slug: string, raw: unknown) {
  const ctx = await getWorkspaceForAction(slug, "ADMIN", { module: "social" }); if (!ctx || !canConnectSocial(ctx.membership)) return { ok: false, error: "Only admins can manage connections." };
  if (await isActionRateLimited("apiWrite", ctx.user.id)) return { ok: false, error: "Too many requests. Wait a minute and try again." };
  const parsed = z.object({ id: z.string().min(1).max(100), operation: z.enum(["disconnect", "sync", "subscribe"]) }).safeParse(raw); if (!parsed.success) return { ok: false, error: "Check the account and try again." };
  const { id, operation } = parsed.data; let result: { ok: boolean; error?: string; message?: string };
  if (operation === "disconnect") result = await disconnectAccount(ctx, id);
  else { const account = await prisma.socialAccount.findFirst({ where: { workspaceId: ctx.workspace.id, id, status: { in: ["ACTIVE", "DEGRADED"] } } }); if (!account) return { ok: false, error: "Connect the account before testing or syncing." };
    try { if (operation === "subscribe") { if (!["FACEBOOK", "INSTAGRAM"].includes(account.platform)) return { ok: false, error: "Comment webhooks are available for Meta accounts." }; await client(await socialToken(account))(endpoint(META, `${encodeURIComponent(account.externalId)}/subscribed_apps`), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ subscribed_fields: account.platform === "INSTAGRAM" ? "comments" : "feed" }) }); result = { ok: true, message: "Comment webhook subscription saved." }; }
      else { const synced = await syncAccount(ctx.workspace.id, id, new Date(), true); result = synced.error ? { ok: false, error: synced.error } : { ok: true, message: synced.synced ? "Connection tested and synced." : "A sync is running or this account is waiting for its next sync. Check the next sync time." }; }
      await recordAuditEvent({ workspaceId: ctx.workspace.id, actorId: ctx.user.id, action: `social.account_${operation}`, targetType: "socialAccount", targetId: id });
    } catch { result = { ok: false, error: "The platform could not complete this request. Review the connection and try again." }; }
  }
  revalidatePath(`/w/${slug}/social`); revalidatePath(`/w/${slug}/settings/social`); return result;
}

export async function reconcileCommentAction(slug: string, raw: unknown) {
  const ctx = await getWorkspaceForAction(slug, "ADMIN", { module: "social" }); if (!ctx || !canConnectSocial(ctx.membership)) return { ok: false, error: "Only admins can reconcile uncertain requests." };
  if (await isActionRateLimited("apiWrite", ctx.user.id)) return { ok: false, error: "Too many changes. Wait a minute and try again." };
  const result = await reconcileComment(ctx, raw); revalidatePath(`/w/${slug}/social/comments`, "layout"); return result;
}
