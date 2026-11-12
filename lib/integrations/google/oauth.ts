import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { randomToken, sha256Hex, encryptSecret, decryptSecret } from "@/lib/crypto";
import { googleClientCredentials, GOOGLE_TOKEN_URL } from "./tokens";
import { requestJson } from "@/lib/integrations/http";
import { encryptIntegrationToken } from "@/lib/integrationSecrets";
export const PERSONAL_CALENDAR_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.freebusy"];
export const GOOGLE_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.freebusy", "https://www.googleapis.com/auth/calendar.calendarlist.readonly", "https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.compose", "https://www.googleapis.com/auth/drive.metadata.readonly", "https://www.googleapis.com/auth/webmasters"];
export function integrationBaseUrl() { const base = process.env.NEXT_PUBLIC_BASE_URL ?? process.env.AUTH_URL; if (!base) throw new Error("Set the instance base URL first."); return new URL(base).origin; }
export async function beginGoogle(workspaceId: string, userId: string, slug: string, returnToCalendar = false) {
  const client = await googleClientCredentials(); if (!client) throw new Error("Configure the Google OAuth client first.");
  const state = randomToken(); const verifier = randomToken(48);
  await prisma.oAuthState.create({ data: { workspaceId, userId, provider: "GOOGLE", stateHash: sha256Hex(state), expiresAt: new Date(Date.now() + 600000), redirectPath: JSON.stringify({ path: returnToCalendar ? `/w/${slug}/calendar` : `/w/${slug}/settings/integrations`, verifierEnc: encryptSecret("integration-tokens", verifier), calendarOnly: returnToCalendar }) } });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: client.clientId, redirect_uri: `${integrationBaseUrl()}/api/integrations/google/callback`, response_type: "code", scope: (returnToCalendar ? PERSONAL_CALENDAR_SCOPES : GOOGLE_SCOPES).join(" "), state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", access_type: "offline", prompt: "consent", include_granted_scopes: "true" }).toString();
  return url.toString();
}
export async function consumeOAuthState(state: string, userId: string, provider: "GOOGLE" | "GITHUB") {
  if (!state || state.length > 128) return null;
  return prisma.$transaction(async tx => {
    const row = await tx.oAuthState.findFirst({ where: { stateHash: sha256Hex(state), userId, provider, expiresAt: { gt: new Date() }, workspace: { status: "ACTIVE", archivedAt: null } } });
    if (!row || !await tx.membership.findFirst({ where: { workspaceId: row.workspaceId, userId, role: { in: provider === "GOOGLE" ? ["OWNER", "ADMIN", "MEMBER"] : ["OWNER", "ADMIN"] }, status: "ACTIVE", user: { disabledAt: null } } })) return null;
    const claim = await tx.oAuthState.deleteMany({ where: { id: row.id, workspaceId: row.workspaceId, userId } }); return claim.count ? row : null;
  });
}
export async function completeGoogle(state: NonNullable<Awaited<ReturnType<typeof consumeOAuthState>>>, code: string) {
  const client = await googleClientCredentials(); if (!client) throw new Error("Google OAuth is not configured.");
  const metadata = JSON.parse(state.redirectPath) as { path: string; verifierEnc: string; calendarOnly?: boolean };
  const result = await requestJson<{ access_token: string; refresh_token?: string; expires_in: number; scope?: string }>(GOOGLE_TOKEN_URL, { method: "POST", label: "Google", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: `${integrationBaseUrl()}/api/integrations/google/callback`, client_id: client.clientId, client_secret: client.clientSecret, code_verifier: decryptSecret("integration-tokens", metadata.verifierEnc) }) });
  if (!result.ok || !result.data.access_token) throw new Error("Google could not complete the connection. Start again.");
  const identity = await requestJson<{ sub: string; email: string }>("https://openidconnect.googleapis.com/v1/userinfo", { label: "Google", headers: { Authorization: `Bearer ${result.data.access_token}` } });
  if (!identity.ok || !identity.data.sub) throw new Error("Google did not return an account identity. Start again.");
  const data = { accountLabel: identity.data.email ?? "Google account", accessTokenEnc: encryptIntegrationToken(result.data.access_token), ...(result.data.refresh_token ? { refreshTokenEnc: encryptIntegrationToken(result.data.refresh_token) } : {}), scopes: result.data.scope?.split(" ") ?? (metadata.calendarOnly ? PERSONAL_CALENDAR_SCOPES : GOOGLE_SCOPES), metadata: { personalCalendar: Boolean(metadata.calendarOnly) }, expiresAt: new Date(Date.now() + Math.max(60, result.data.expires_in) * 1000), status: "ACTIVE" as const, lastError: null, connectedById: state.userId };
  await prisma.integrationConnection.upsert({ where: { workspaceId_provider_externalId: { workspaceId: state.workspaceId, provider: "GOOGLE", externalId: identity.data.sub } }, create: { ...data, workspaceId: state.workspaceId, provider: "GOOGLE", externalId: identity.data.sub }, update: data });
  return metadata.path;
}
