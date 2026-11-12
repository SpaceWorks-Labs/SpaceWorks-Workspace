"use server";

import { importPKCS8 } from "jose";
import { revalidatePath } from "@/lib/frontend/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { recordAuditEvent } from "@/lib/audit";
import { clearAppleClientSecretCache, normalizeApplePrivateKey } from "@/lib/appleClientSecret";
import { invalidateAuthSettings } from "@/lib/authSettings";
import { getInstanceSettings, INSTANCE_SETTING_KEYS, setInstanceSettings, type InstanceSettingKey } from "@/lib/instanceSettings";
import { parseAllowedDomains } from "@/lib/oauthLinking";
import { requireSuperAdminMfa } from "@/lib/permissions";
import { actionError, RATE_LIMITED, type ActionResult } from "@/lib/actionResult";

const KEYS = [
  "google.enabled", "google.clientId", "google.clientSecret",
  "github.enabled", "github.clientId", "github.clientSecret",
  "apple.enabled", "apple.clientId", "apple.teamId", "apple.keyId", "apple.privateKey",
  "auth.allowSelfSignup", "auth.allowedEmailDomains",
] as const satisfies readonly InstanceSettingKey[];
type Key = (typeof KEYS)[number];

const REQUIRED: Record<"google" | "github" | "apple", readonly Key[]> = {
  google: ["google.clientId", "google.clientSecret"],
  github: ["github.clientId", "github.clientSecret"],
  apple: ["apple.clientId", "apple.teamId", "apple.keyId", "apple.privateKey"],
};

const LABELS = { google: "Google", github: "GitHub", apple: "Apple" } as const;
const inputSchema = z.record(z.string(), z.union([z.string().max(4000), z.null()]));
const isOn = (value: string | undefined) => value === "true" || value === "1";

/**
 * Save the sign-in provider settings. Secrets are write-only (blank keeps the
 * stored value). Refuses to enable a provider with missing credentials, and
 * refuses a change that would leave the super admin with no way to sign in.
 */
export async function saveSignInSettings(input: unknown): Promise<ActionResult> {
  const session = await requireSuperAdminMfa();
  if (await isActionRateLimited("action", session.user.id)) return actionError(RATE_LIMITED);
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return actionError("Check the settings and try again.");
  const updates: Partial<Record<Key, string | null>> = {};
  for (const [key, value] of Object.entries(parsed.data)) {
    if (!(KEYS as readonly string[]).includes(key)) return actionError("Unknown setting.");
    updates[key as Key] = key === "auth.allowedEmailDomains" && value ? parseAllowedDomains(value).join(",") : value;
  }

  const current = await getInstanceSettings(KEYS);
  const after = (key: Key): string | undefined => {
    const next = updates[key];
    if (next === undefined) return current[key];
    if (next === null) return process.env[INSTANCE_SETTING_KEYS[key].env]?.trim() || undefined;
    // A blank secret means "keep the stored one".
    return next.trim() === "" && INSTANCE_SETTING_KEYS[key].secret ? current[key] : next.trim() || undefined;
  };

  for (const provider of ["google", "github", "apple"] as const) {
    if (isOn(updates[`${provider}.enabled` as Key] ?? undefined) && REQUIRED[provider].some((key) => !after(key))) {
      return actionError(`Add the ${LABELS[provider]} credentials before turning it on.`);
    }
  }
  const proposedKey = updates["apple.privateKey"]?.trim();
  if (proposedKey) {
    try {
      await importPKCS8(normalizeApplePrivateKey(proposedKey), "ES256");
    } catch {
      return actionError("That isn't a valid Apple .p8 private key. Paste the whole file, including the BEGIN and END lines.");
    }
  }

  // The acting super admin must keep a way in after this change.
  const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { passwordHash: true, accounts: { select: { provider: true } } } });
  const stillAvailable = (provider: string) => {
    if (provider.startsWith("oidc-")) return true;
    if (provider !== "google" && provider !== "github" && provider !== "apple") return false;
    const flag = after(`${provider}.enabled` as Key);
    return provider === "google" ? Boolean(after("google.clientId") && after("google.clientSecret")) && flag !== "false" && flag !== "0" : isOn(flag);
  };
  if (!me?.passwordHash && !me?.accounts.some((a) => stillAvailable(a.provider))) {
    return actionError("That would remove your own last way to sign in. Set a password on your account first.");
  }

  const changed = await setInstanceSettings(updates, session.user.id);
  invalidateAuthSettings();
  clearAppleClientSecretCache();
  // Keys only: values, and especially secrets, never reach the audit log.
  await recordAuditEvent({ action: "admin.sign_in_settings_updated", actorId: session.user.id, metadata: { keys: Object.keys(updates).join(","), changed } });
  revalidatePath("/admin/sign-in");
  return { ok: true };
}
