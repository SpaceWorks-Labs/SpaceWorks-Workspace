import "server-only";
import { createHash } from "node:crypto";
import type { IntegrationProvider, SocialPlatform } from "@prisma/client";
import { prisma } from "@/lib/db";
import { randomToken, sha256Hex, encryptSecret, decryptSecret } from "@/lib/crypto";
import { googleClientCredentials, GOOGLE_TOKEN_URL } from "@/lib/integrations/google/tokens";
import { integrationBaseUrl } from "@/lib/integrations/google/oauth";
import { recordAuditEvent } from "@/lib/audit";
import { canConnectSocial } from "@/lib/roles";
import type { WorkspaceContext } from "@/lib/permissions";
import { SCOPES, META_VERSION } from "./config";
import { client, endpoint } from "./http";
import { array as a, object as o, string as s, number as n, type Candidate } from "./types";
import { YT } from "./providers/youtube";
import { META } from "./providers/meta";
import { LI } from "./providers/linkedin";
import { XAPI } from "./providers/x";
export class SocialSetupError extends Error {}
export const oauthProvider = (p: SocialPlatform): IntegrationProvider => p === "YOUTUBE" ? "SOCIAL_YOUTUBE" : p === "LINKEDIN" ? "SOCIAL_LINKEDIN" : p === "X" ? "SOCIAL_X" : "SOCIAL_META";
export const callbackUri = (p: SocialPlatform) => `${integrationBaseUrl()}/api/social/oauth/${p.toLowerCase()}/callback`;
export async function credentials(platform: SocialPlatform) {
  if (platform === "YOUTUBE") { const c = await googleClientCredentials(); if (!c) throw new SocialSetupError("Configure the instance Google OAuth client first."); return { ...c, configId: "" }; }
  const prefix = platform === "FACEBOOK" || platform === "INSTAGRAM" ? "SOCIAL_META" : `SOCIAL_${platform}`;
  const clientId = process.env[`${prefix}_CLIENT_ID`], clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
  if (!clientId || !clientSecret) throw new SocialSetupError(`Configure ${prefix}_CLIENT_ID and ${prefix}_CLIENT_SECRET on the instance first.`);
  const configId = process.env.SOCIAL_META_CONFIG_ID ?? "";
  if (oauthProvider(platform) === "SOCIAL_META" && !configId) throw new SocialSetupError("Configure SOCIAL_META_CONFIG_ID for Facebook Login for Business first.");
  return { clientId, clientSecret, configId };
}
export async function beginSocial(ctx: WorkspaceContext, platform: SocialPlatform) {
  if (!canConnectSocial(ctx.membership)) throw new SocialSetupError("Only admins can connect social accounts.");
  const c = await credentials(platform), state = randomToken(), verifier = randomToken(48);
  await prisma.oAuthState.create({ data: { workspaceId: ctx.workspace.id, userId: ctx.user.id, provider: oauthProvider(platform), stateHash: sha256Hex(state), expiresAt: new Date(Date.now() + 600000), redirectPath: JSON.stringify({ platform, verifierEnc: encryptSecret("social-oauth", verifier) }) } });
  const url = new URL(platform === "YOUTUBE" ? "https://accounts.google.com/o/oauth2/v2/auth" : platform === "LINKEDIN" ? "https://www.linkedin.com/oauth/v2/authorization" : platform === "X" ? "https://x.com/i/oauth2/authorize" : `https://www.facebook.com/${META_VERSION}/dialog/oauth`);
  url.search = new URLSearchParams({ response_type: "code", client_id: c.clientId, redirect_uri: callbackUri(platform), state, ...(oauthProvider(platform) === "SOCIAL_META" ? { config_id: c.configId, override_default_response_type: "true" } : { scope: SCOPES[platform].join(" ") }), ...(platform === "YOUTUBE" || platform === "X" ? { code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" } : {}), ...(platform === "YOUTUBE" ? { access_type: "offline", prompt: "consent", include_granted_scopes: "true" } : {}) }).toString();
  return url.toString();
}
export async function consumeSocialState(state: string, userId: string, platform: SocialPlatform) {
  if (!state || state.length > 128) return null;
  return prisma.$transaction(async tx => {
    const row = await tx.oAuthState.findFirst({ where: { stateHash: sha256Hex(state), userId, provider: oauthProvider(platform), expiresAt: { gt: new Date() }, workspace: { status: "ACTIVE", archivedAt: null } } });
    if (!row || o(JSON.parse(row.redirectPath)).platform !== platform || !await tx.membership.findFirst({ where: { workspaceId: row.workspaceId, userId, status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] }, user: { disabledAt: null } } })) return null;
    return (await tx.oAuthState.deleteMany({ where: { id: row.id, workspaceId: row.workspaceId, userId } })).count ? row : null;
  });
}
export async function exchangeCode(platform: SocialPlatform, code: string, verifier: string) {
  const c = await credentials(platform); const tokenUrl = platform === "YOUTUBE" ? GOOGLE_TOKEN_URL : platform === "LINKEDIN" ? "https://www.linkedin.com/oauth/v2/accessToken" : platform === "X" ? "https://api.x.com/2/oauth2/token" : `${META}oauth/access_token`;
  const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: callbackUri(platform), client_id: c.clientId, ...(platform === "X" ? { code_verifier: verifier } : { client_secret: c.clientSecret }), ...(platform === "YOUTUBE" ? { code_verifier: verifier } : {}) });
  let data = await client("")(tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...(platform === "X" ? { Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}` } : {}) }, body });
  if (oauthProvider(platform) === "SOCIAL_META") data = await client("")(endpoint(META, "oauth/access_token"), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "fb_exchange_token", client_id: c.clientId, client_secret: c.clientSecret, fb_exchange_token: s(data.access_token) }) });
  if (!s(data.access_token)) throw new SocialSetupError("The platform did not return access. Start the connection again.");
  return { token: s(data.access_token), refreshToken: s(data.refresh_token) || undefined, expiresAt: n(data.expires_in) ? new Date(Date.now() + n(data.expires_in)! * 1000).toISOString() : undefined, scopes: s(data.scope).split(/[ ,]+/).filter(Boolean) };
}
export async function discoverAccounts(platform: SocialPlatform, tokens: Awaited<ReturnType<typeof exchangeCode>>): Promise<Candidate[]> {
  const api = client(tokens.token), base = { ...tokens, platform }, candidates: Candidate[] = [];
  if (platform === "YOUTUBE") { let next: string | undefined; do { const data = await api(endpoint(YT, "channels", { part: "snippet", mine: "true", maxResults: 50, pageToken: next })); for (const row of a(data.items)) { const v = o(row), sn = o(v.snippet); candidates.push({ ...base, externalId: s(v.id), displayName: s(sn.title), handle: s(sn.customUrl), avatarUrl: s(o(o(sn.thumbnails).default).url) || undefined }); } next = s(data.nextPageToken) || undefined; } while (next && candidates.length < 500); }
  else if (platform === "X") { const data = o((await api(endpoint(XAPI, "users/me", { "user.fields": "profile_image_url" }))).data); candidates.push({ ...base, externalId: s(data.id), displayName: s(data.name), handle: s(data.username), avatarUrl: s(data.profile_image_url) || undefined }); }
  else if (platform === "LINKEDIN") { let start = 0; let more: boolean; do { const data = await api(endpoint(LI, "organizationAcls", { q: "roleAssignee", role: "ADMINISTRATOR", state: "APPROVED", count: 100, start })); const elements = a(data.elements); for (const row of elements) { const urn = s(o(row).organization); if (!urn) continue; const org = await api(endpoint(LI, `organizations/${encodeURIComponent(urn.split(":").at(-1)!)}`)); candidates.push({ ...base, externalId: urn, displayName: s(org.localizedName, urn), handle: s(org.vanityName) || undefined }); } start += 100; more = elements.length === 100; } while (more && start < 1000); }
  else { const permissions = await api(endpoint(META, "me/permissions")); const granted = a(permissions.data).filter(v => o(v).status === "granted").map(v => s(o(v).permission)); let after: string | undefined;
    do { const data = await api(endpoint(META, "me/accounts", { fields: "id,name,access_token,tasks,instagram_business_account{id,username,name,profile_picture_url}", limit: 100, after })); for (const row of a(data.data)) { const page = o(row), ig = o(page.instagram_business_account); if (platform === "INSTAGRAM" && !ig.id) continue; const pageToken = s(page.access_token); if (!pageToken) continue; candidates.push({ ...base, scopes: granted, token: pageToken, platform, externalId: s(platform === "INSTAGRAM" ? ig.id : page.id), parentExternalId: platform === "INSTAGRAM" ? s(page.id) : undefined, displayName: s(platform === "INSTAGRAM" ? ig.name ?? ig.username : page.name), handle: platform === "INSTAGRAM" ? s(ig.username) : undefined, avatarUrl: s(ig.profile_picture_url) || undefined }); } after = o(data.paging).next ? s(o(o(data.paging).cursors).after) || undefined : undefined; } while (after && candidates.length < 1000);
  }
  return candidates.filter(c => c.externalId && c.displayName);
}
export async function completeSocial(state: NonNullable<Awaited<ReturnType<typeof consumeSocialState>>>, platform: SocialPlatform, code: string) {
  const metadata = o(JSON.parse(state.redirectPath)); const tokens = await exchangeCode(platform, code, decryptSecret("social-oauth", s(metadata.verifierEnc))); const candidates = await discoverAccounts(platform, tokens);
  if (!candidates.length) throw new SocialSetupError("No eligible accounts were returned. Check the platform account and app permissions.");
  const draft = await prisma.socialConnectionDraft.create({ data: { workspaceId: state.workspaceId, userId: state.userId, candidatesEnc: encryptSecret("social-draft", JSON.stringify(candidates)), expiresAt: new Date(Date.now() + 600000) } });
  return draft.id;
}
export async function selectAccounts(ctx: WorkspaceContext, draftId: string, indexes: number[]) {
  if (!canConnectSocial(ctx.membership)) throw new SocialSetupError("Only admins can connect social accounts.");
  return prisma.$transaction(async tx => {
    const draft = await tx.socialConnectionDraft.findFirst({ where: { id: draftId, workspaceId: ctx.workspace.id, userId: ctx.user.id, expiresAt: { gt: new Date() } } }); if (!draft) throw new SocialSetupError("That selection expired. Start the connection again.");
    const candidates = JSON.parse(decryptSecret("social-draft", draft.candidatesEnc)) as Candidate[];
    if (!indexes.length || indexes.some(i => !Number.isInteger(i) || !candidates[i])) throw new SocialSetupError("Choose at least one available account.");
    const claimed = await tx.socialConnectionDraft.deleteMany({ where: { id: draftId, workspaceId: ctx.workspace.id, userId: ctx.user.id } }); if (!claimed.count) throw new SocialSetupError("That selection was already saved.");
    for (const index of new Set(indexes)) { const c = candidates[index]!; const data = { displayName: c.displayName, handle: c.handle, avatarUrl: c.avatarUrl, parentExternalId: c.parentExternalId, accessTokenEnc: encryptSecret("social-access", c.token), ...(c.refreshToken ? { refreshTokenEnc: encryptSecret("social-refresh", c.refreshToken) } : {}), expiresAt: c.expiresAt ? new Date(c.expiresAt) : null, scopes: c.scopes, connectedById: ctx.user.id, status: "ACTIVE" as const, lastError: null, warnings: [], nextSyncAt: new Date(), leaseUntil: null, leaseToken: null };
      const account = await tx.socialAccount.upsert({ where: { workspaceId_platform_externalId: { workspaceId: ctx.workspace.id, platform: c.platform, externalId: c.externalId } }, create: { ...data, workspaceId: ctx.workspace.id, platform: c.platform, externalId: c.externalId }, update: data });
      await recordAuditEvent({ workspaceId: ctx.workspace.id, actorId: ctx.user.id, action: "social.account_connected", targetType: "socialAccount", targetId: account.id, client: tx }); }
    return indexes.length;
  });
}
