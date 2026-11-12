import "server-only";
import type { SocialAccount } from "@prisma/client";
import { prisma } from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { credentials } from "./oauth";
import { client, SocialApiError } from "./http";
import { number, string } from "./types";
export async function socialToken(account: Pick<SocialAccount, "id" | "workspaceId">): Promise<string> {
  // Row lock serialises refresh-token rotation between sync and interactive replies.
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "SocialAccount" WHERE "workspaceId"=${account.workspaceId} AND id=${account.id} FOR UPDATE`;
    const current = await tx.socialAccount.findFirst({ where: { workspaceId: account.workspaceId, id: account.id, status: { notIn: ["DISCONNECTED", "DEMO"] }, workspace: { status: "ACTIVE", archivedAt: null } } });
    if (!current?.accessTokenEnc) throw new SocialApiError("This account is disconnected. Connect it in Social settings.", "TOKEN");
    if (!current.expiresAt || current.expiresAt.getTime() > Date.now() + 60000) return decryptSecret("social-access", current.accessTokenEnc);
    if (!current.refreshTokenEnc || current.platform === "FACEBOOK" || current.platform === "INSTAGRAM") throw new SocialApiError("Account access is expiring. Reconnect the account in Social settings.", "TOKEN");
    const c = await credentials(current.platform); const url = current.platform === "YOUTUBE" ? "https://oauth2.googleapis.com/token" : current.platform === "X" ? "https://api.x.com/2/oauth2/token" : "https://www.linkedin.com/oauth/v2/accessToken";
    const data = await client("")(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...(current.platform === "X" ? { Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}` } : {}) }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: decryptSecret("social-refresh", current.refreshTokenEnc), client_id: c.clientId, ...(current.platform === "X" ? {} : { client_secret: c.clientSecret }) }) });
    const token = string(data.access_token); if (!token) throw new SocialApiError("Token renewal failed. Reconnect the account.", "TOKEN");
    await tx.socialAccount.updateMany({ where: { workspaceId: current.workspaceId, id: current.id }, data: { accessTokenEnc: encryptSecret("social-access", token), ...(string(data.refresh_token) ? { refreshTokenEnc: encryptSecret("social-refresh", string(data.refresh_token)) } : {}), expiresAt: new Date(Date.now() + (number(data.expires_in) ?? 3600) * 1000) } });
    return token;
  }, { timeout: 25000, maxWait: 5000 });
}
