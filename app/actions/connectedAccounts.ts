"use server";

import { revalidatePath } from "@/lib/frontend/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { recordAuditEvent } from "@/lib/audit";
import { getAuthSettings } from "@/lib/authSettings";
import { isOAuthProvider } from "@/lib/oauthLinking";
import { getCurrentUser } from "@/lib/permissions";
import { hasRecentAuthentication } from "@/lib/reauth";
import { actionError, RATE_LIMITED, type ActionResult } from "@/lib/actionResult";

const providerSchema = z.object({ provider: z.string().refine(isOAuthProvider, "Choose a sign-in provider.") });
const SIGN_IN_AGAIN = "Sign in again to change your connected accounts.";

/** Checked before the browser leaves for the provider: enabled, not already connected, and a fresh sign-in. */
export async function prepareProviderLink(input: unknown): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return actionError("Sign in again to continue.");
  if (await isActionRateLimited("auth", user.id)) return actionError(RATE_LIMITED);
  const parsed = providerSchema.safeParse(input);
  if (!parsed.success) return actionError("Choose a sign-in provider.");
  const provider = parsed.data.provider as "google" | "github" | "apple";
  if (!(await getAuthSettings())[provider]) return actionError("That sign-in method isn't turned on.");
  if (await prisma.account.count({ where: { userId: user.id, provider } })) return actionError("That account is already connected. Disconnect it first.");
  if (!(await hasRecentAuthentication())) return actionError(SIGN_IN_AGAIN);
  return { ok: true };
}

/**
 * Disconnect a provider. The last way to sign in can't be removed: a password
 * or another connected account must remain. The user row is locked so two
 * concurrent disconnects can't each see the other as "still there".
 */
export async function unlinkProvider(input: unknown): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return actionError("Sign in again to continue.");
  if (await isActionRateLimited("auth", user.id)) return actionError(RATE_LIMITED);
  const parsed = providerSchema.safeParse(input);
  if (!parsed.success) return actionError("Choose a sign-in provider.");
  if (!(await hasRecentAuthentication())) return actionError(SIGN_IN_AGAIN);
  const provider = parsed.data.provider;
  const removed = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE`;
    const current = await tx.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });
    const others = await tx.account.count({ where: { userId: user.id, provider: { not: provider } } });
    if (!current?.passwordHash && others === 0) return "last" as const;
    const { count } = await tx.account.deleteMany({ where: { userId: user.id, provider } });
    if (count > 0) await recordAuditEvent({ client: tx, action: "auth.provider_unlinked", actorId: user.id, targetType: "User", targetId: user.id, metadata: { provider } });
    return "done" as const;
  });
  if (removed === "last") return actionError("That's your only way to sign in. Set a password or connect another account first.");
  revalidatePath("/account");
  return { ok: true };
}
