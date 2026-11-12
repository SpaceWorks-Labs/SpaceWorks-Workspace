import "server-only";

import crypto from "crypto";
import { prisma } from "@/lib/db";
import { safeEqual, sha256Hex } from "@/lib/crypto";
import { hasRoleAtLeast } from "@/lib/roles";
import type { Principal } from "@/lib/assistant/principal";
import { bearerToken, normalizeScopes, parseTokenString, type ApiScope } from "@/lib/apiTokens/scopes";

/**
 * Tenant-bound API tokens for /api/v1 and /api/mcp. Only a SHA-256 of the
 * secret is stored; the plain token is shown once at creation. A token acts
 * for its creator, so it stops working as soon as the creator is no longer an
 * active admin or owner of the workspace (or is disabled), when it is revoked
 * or when it expires.
 */

const PREFIX_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

function randomPrefix(): string {
  const bytes = crypto.randomBytes(12);
  let out = "";
  for (const byte of bytes) out += PREFIX_ALPHABET[byte % PREFIX_ALPHABET.length];
  return `sww_${out}`;
}

export function generateTokenSecret(): { prefix: string; secret: string; token: string; secretHash: string } {
  const prefix = randomPrefix();
  const secret = crypto.randomBytes(32).toString("base64url");
  return { prefix, secret, token: `${prefix}_${secret}`, secretHash: sha256Hex(secret) };
}

const LAST_USED_GRANULARITY_MS = 60_000;

export type AuthenticatedToken = { principal: Principal; scopes: ApiScope[] };

/**
 * Resolve `Authorization: Bearer sww_…` to a principal, or null for anything
 * invalid (wrong format, unknown prefix, wrong secret, revoked, expired,
 * archived or non-ACTIVE workspace, creator gone or demoted). Callers answer 401 for null.
 */
export async function authenticateApiToken(authorization: string | null, now = new Date()): Promise<AuthenticatedToken | null> {
  const raw = bearerToken(authorization);
  const parsed = raw ? parseTokenString(raw) : null;
  if (!parsed) return null;
  const token = await prisma.apiToken.findUnique({
    where: { prefix: parsed.prefix },
    select: {
      id: true,
      name: true,
      secretHash: true,
      scopes: true,
      revokedAt: true,
      expiresAt: true,
      lastUsedAt: true,
      createdById: true,
      workspace: { select: { id: true, slug: true, name: true, timezone: true, currency: true, financeVisibleToMembers: true, archivedAt: true, status: true } },
    },
  });
  if (!token || !safeEqual(token.secretHash, sha256Hex(parsed.secret))) return null;
  if (token.revokedAt || (token.expiresAt && token.expiresAt <= now) || token.workspace.archivedAt || token.workspace.status !== "ACTIVE" || !token.createdById) return null;

  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId: token.createdById, workspaceId: token.workspace.id } },
    select: { role: true, status: true, user: { select: { name: true, disabledAt: true } } },
  });
  if (!membership || membership.status !== "ACTIVE" || membership.user.disabledAt || !hasRoleAtLeast(membership.role, "ADMIN")) return null;

  if (!token.lastUsedAt || now.getTime() - token.lastUsedAt.getTime() > LAST_USED_GRANULARITY_MS) {
    await prisma.apiToken.update({ where: { id: token.id }, data: { lastUsedAt: now } }).catch(() => undefined);
  }

  const scopes = normalizeScopes(token.scopes);
  const { archivedAt: _archived, status: _status, ...workspace } = token.workspace;
  void _archived;
  void _status;
  return {
    scopes,
    principal: {
      kind: "token",
      workspace,
      userId: token.createdById,
      userName: membership.user.name,
      role: membership.role,
      tokenId: token.id,
      tokenName: token.name,
      scopes,
    },
  };
}

export function listApiTokens(workspaceId: string) {
  return prisma.apiToken.findMany({
    where: { workspaceId },
    orderBy: [{ revokedAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      prefix: true,
      scopes: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
      createdAt: true,
      createdBy: { select: { name: true, email: true } },
    },
    take: 200,
  });
}
