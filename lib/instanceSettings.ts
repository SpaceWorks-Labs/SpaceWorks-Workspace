import "server-only";

import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { AUTH_SETTING_KEYS } from "@/lib/instanceSettings/keys-auth";
import { LIMIT_SETTING_KEYS } from "@/lib/instanceSettings/keys-limits";
import { OBSERVABILITY_SETTING_KEYS } from "@/lib/instanceSettings/keys-observability";

/**
 * Instance-wide settings managed by the super-admin (/admin/settings).
 * Database values override environment fallbacks. Secret values are
 * encrypted at rest and write-only: they are never returned to the browser,
 * only whether they are set.
 */
export const INSTANCE_SETTING_KEYS = {
  "smtp.from": { secret: false, env: "EMAIL_FROM" },
  "smtp.service": { secret: false, env: "SMTP_SERVICE" },
  "smtp.host": { secret: false, env: "SMTP_HOST" },
  "smtp.port": { secret: false, env: "SMTP_PORT" },
  "smtp.secure": { secret: false, env: "SMTP_SECURE" },
  "smtp.user": { secret: false, env: "SMTP_USER" },
  "smtp.password": { secret: true, env: "SMTP_PASSWORD" },
  "smtp.allowUnauthenticated": { secret: false, env: "SMTP_ALLOW_UNAUTHENTICATED" },
  "google.clientId": { secret: false, env: "AUTH_GOOGLE_ID" },
  "google.clientSecret": { secret: true, env: "AUTH_GOOGLE_SECRET" },
  "ai.anthropicApiKey": { secret: true, env: "ANTHROPIC_API_KEY" },
  "ai.model": { secret: false, env: "ASSISTANT_MODEL" },
  ...AUTH_SETTING_KEYS,
  ...OBSERVABILITY_SETTING_KEYS,
  ...LIMIT_SETTING_KEYS,
} as const;

export type InstanceSettingKey = keyof typeof INSTANCE_SETTING_KEYS;

export function isInstanceSettingKey(key: string): key is InstanceSettingKey {
  return Object.prototype.hasOwnProperty.call(INSTANCE_SETTING_KEYS, key);
}

/** Resolved values (database first, then environment). Server-side only. */
export async function getInstanceSettings<K extends InstanceSettingKey>(keys: readonly K[]): Promise<Record<K, string | undefined>> {
  const rows = await prisma.instanceSetting.findMany({ where: { key: { in: [...keys] } } });
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const out = {} as Record<K, string | undefined>;
  for (const key of keys) {
    const row = byKey.get(key);
    let value: string | undefined;
    if (row) {
      try {
        value = row.encrypted ? decryptSecret("instance-settings", row.value) : row.value;
      } catch {
        // A rotated key makes the stored secret unreadable; fall back to env.
        value = undefined;
      }
    }
    out[key] = value ?? process.env[INSTANCE_SETTING_KEYS[key].env]?.trim() ?? undefined;
    if (out[key] === "") out[key] = undefined;
  }
  return out;
}

/** What the admin UI may see: plain values for non-secrets, a boolean for secrets. */
export async function getInstanceSettingsForDisplay() {
  const keys = Object.keys(INSTANCE_SETTING_KEYS) as InstanceSettingKey[];
  const rows = await prisma.instanceSetting.findMany({ select: { key: true, value: true, encrypted: true, updatedAt: true } });
  const byKey = new Map(rows.map((row) => [row.key, row]));
  return keys.map((key) => {
    const meta = INSTANCE_SETTING_KEYS[key];
    const row = byKey.get(key);
    const envSet = Boolean(process.env[meta.env]?.trim());
    return {
      key,
      secret: meta.secret,
      value: meta.secret ? null : row?.value ?? null,
      isSet: Boolean(row) || envSet,
      source: row ? ("database" as const) : envSet ? ("environment" as const) : ("unset" as const),
      updatedAt: row?.updatedAt ?? null,
    };
  });
}

/**
 * Upsert settings. `null` clears a key (falls back to env); empty strings for
 * secrets mean "leave unchanged" so a write-only form never wipes them.
 */
export async function setInstanceSettings(updates: Partial<Record<InstanceSettingKey, string | null>>, actorId: string | null) {
  const operations = [];
  for (const [key, value] of Object.entries(updates) as Array<[InstanceSettingKey, string | null | undefined]>) {
    if (value === undefined) continue;
    const meta = INSTANCE_SETTING_KEYS[key];
    if (value === null) {
      operations.push(prisma.instanceSetting.deleteMany({ where: { key } }));
      continue;
    }
    const trimmed = value.trim();
    if (meta.secret && trimmed === "") continue;
    const stored = meta.secret ? encryptSecret("instance-settings", trimmed) : trimmed;
    operations.push(
      prisma.instanceSetting.upsert({
        where: { key },
        create: { key, value: stored, encrypted: meta.secret, updatedById: actorId },
        update: { value: stored, encrypted: meta.secret, updatedById: actorId },
      }),
    );
  }
  if (operations.length > 0) await prisma.$transaction(operations);
  return operations.length;
}

export async function getGoogleSsoSettings() {
  const s = await getInstanceSettings(["google.clientId", "google.clientSecret"]);
  const clientId = s["google.clientId"] ?? process.env.GOOGLE_CLIENT_ID;
  const clientSecret = s["google.clientSecret"] ?? process.env.GOOGLE_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export async function getEmailSettings() {
  const s = await getInstanceSettings([
    "smtp.from", "smtp.service", "smtp.host", "smtp.port", "smtp.secure", "smtp.user", "smtp.password", "smtp.allowUnauthenticated",
  ]);
  return {
    from: s["smtp.from"] ?? "Space Works Workspace <noreply@localhost>",
    service: s["smtp.service"],
    host: s["smtp.host"],
    port: Number.parseInt(s["smtp.port"] ?? "587", 10) || 587,
    secure: s["smtp.secure"] === "true",
    user: s["smtp.user"],
    password: s["smtp.password"],
    allowUnauthenticated: s["smtp.allowUnauthenticated"] === "1" || s["smtp.allowUnauthenticated"] === "true",
  };
}

/** Anthropic credentials for the assistant. `apiKey` is null when the assistant is not configured. */
export async function getAssistantSettings() {
  const s = await getInstanceSettings(["ai.anthropicApiKey", "ai.model"]);
  return { apiKey: s["ai.anthropicApiKey"] ?? null, model: s["ai.model"] ?? "claude-opus-5-5" };
}
