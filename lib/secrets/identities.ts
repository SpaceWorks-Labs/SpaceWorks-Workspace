import "server-only";
import { canManageSecrets } from "@/lib/roles";
import { z } from "zod";
import { isIP } from "node:net";
import { prisma, type DbClient } from "@/lib/db";
import { randomToken, sha256Hex, safeEqual } from "@/lib/crypto";
import { environmentAccess, requireSecretsMfa, type SecretsActor } from "./access";
import { ipAllowed } from "./tokens";
import { audit } from "./mutations";
import { SecretsError, normalisePath } from "./values";
const seconds = z.number().int().min(60).max(30 * 86400);
const uses = z.number().int().min(1).max(1000000).nullable().default(null);
const ips = z.array(z.string().max(100).refine(rule => {
  const [ip, prefix, extra] = rule.split("/");
  return !!isIP(ip) && !extra && (prefix === undefined || /^\d+$/.test(prefix) && Number(prefix) <= (isIP(ip) === 4 ? 32 : 128));
})).max(30).default([]);
const settings = z.object({
  name: z.string().trim().min(1).max(100), accessTtl: seconds.default(7200),
  maxTtl: seconds.default(2592000), tokenUses: uses, secretUses: uses,
  secretTtl: seconds.nullable().default(null), loginIps: ips, tokenIps: ips,
  failureLimit: z.number().int().min(1).max(20).default(3),
  lockoutSeconds: z.number().int().min(60).max(86400).default(300),
  path: z.string().transform(normalisePath).default("/"), role: z.enum(["KEYS", "READ", "WRITE"]).default("READ"),
}).refine(v => v.accessTtl <= v.maxTtl);
async function administrator(actor: SecretsActor, environmentId: string, client: DbClient = prisma) {
  const env = await environmentAccess(actor, environmentId, "ADMIN", client);
  if (actor.machine || !canManageSecrets(actor.membership)) throw new SecretsError("Use your member account to manage identities.");
  await requireSecretsMfa(actor, env.production, false, client);
  return env;
}
export async function createIdentity(actor: SecretsActor, environmentId: string, input: unknown) {
  const parsed = settings.safeParse(input);
  if (!parsed.success) throw new SecretsError("Check the identity settings and IP ranges.");
  const { path, role, ...data } = parsed.data;
  return prisma.$transaction(async tx => {
    const env = await administrator(actor, environmentId, tx);
    const row = await tx.secretIdentity.create({ data: { ...data, workspaceId: actor.workspace.id, projectId: env.projectId, clientId: "swwi_" + randomToken(18), createdById: actor.user.id } });
    await tx.secretIdentityPermission.create({ data: { workspaceId: row.workspaceId, identityId: row.id, environmentId, path, role } });
    await audit(tx, row.workspaceId, row.projectId, actor.user.id, "identity_created", environmentId, row.id);
    return { id: row.id, clientId: row.clientId };
  });
}
export async function manageIdentity(actor: SecretsActor, environmentId: string, id: string, operation: "credential" | "reset" | "revoke" | "revoke-credential" | "revoke-access" | "permission" | "settings", input: Record<string, unknown> = {}) {
  return prisma.$transaction(async tx => {
    const env = await administrator(actor, environmentId, tx);
    const row = await tx.secretIdentity.findFirst({ where: { id, workspaceId: actor.workspace.id, projectId: env.projectId } });
    if (!row || row.revokedAt) throw new SecretsError("That identity is unavailable.");
    // Project administration is required to change a project identity, even when its current grant is elsewhere.
    if (!actor.membership.viaSuperAdmin && !(await tx.membership.findFirst({ where: { workspaceId: row.workspaceId, userId: actor.user.id, role: { in: ["OWNER", "ADMIN"] }, status: "ACTIVE" } }))) throw new SecretsError("Ask a workspace admin to manage this identity.");
    const production = await tx.secretIdentityPermission.findFirst({ where: { workspaceId: row.workspaceId, identityId: row.id, role: { not: "NONE" }, environmentId: { in: (await tx.secretEnvironment.findMany({ where: { workspaceId: row.workspaceId, projectId: row.projectId, production: true }, select: { id: true } })).map(e => e.id) } } });
    if (production) await requireSecretsMfa(actor, true, false, tx);
    let issuedCredential: string | undefined;
    if (operation === "settings") {
      const updated = settings.safeParse(input);
      if (!updated.success) throw new SecretsError("Check the identity settings and IP ranges.");
      const { path: _path, role: _role, ...data } = updated.data;
      void _path; void _role;
      await tx.secretIdentity.update({ where: { id, workspaceId: row.workspaceId }, data });
      await tx.secretIdentityToken.updateMany({ where: { workspaceId: row.workspaceId, identityId: id }, data: { revokedAt: new Date() } });
    } else if (operation === "credential") {
      const secret = randomToken();
      const credential = await tx.secretIdentityCredential.create({ data: { workspaceId: row.workspaceId, identityId: id, secretHash: sha256Hex(secret), remainingUses: row.secretUses, expiresAt: row.secretTtl ? new Date(Date.now() + row.secretTtl * 1000) : null } });
      issuedCredential = credential.id + "." + secret;
    } else if (operation === "reset") {
      await tx.secretIdentity.update({ where: { workspaceId: row.workspaceId, id }, data: { failures: 0, lockedUntil: null } });
    } else if (operation === "permission") {
      const permission = z.object({ role: z.enum(["KEYS", "READ", "WRITE", "NONE"]), path: z.string().transform(normalisePath) }).safeParse(input);
      if (!permission.success) throw new SecretsError("Choose a permission and folder path.");
      await tx.secretIdentityPermission.upsert({ where: { workspaceId_identityId_environmentId_path: { workspaceId: row.workspaceId, identityId: id, environmentId, path: permission.data.path } }, create: { workspaceId: row.workspaceId, identityId: id, environmentId, ...permission.data }, update: { role: permission.data.role } });
    } else if (operation === "revoke-credential") {
      await tx.secretIdentityCredential.updateMany({ where: { workspaceId: row.workspaceId, identityId: id, id: String(input.credentialId) }, data: { revokedAt: new Date() } });
    } else if (operation === "revoke-access") {
      await tx.secretIdentityToken.updateMany({ where: { workspaceId: row.workspaceId, identityId: id, id: String(input.tokenId) }, data: { revokedAt: new Date() } });
    } else {
      await tx.secretIdentity.update({ where: { workspaceId: row.workspaceId, id }, data: { revokedAt: new Date() } });
      await tx.secretIdentityToken.updateMany({ where: { workspaceId: row.workspaceId, identityId: id }, data: { revokedAt: new Date() } });
    }
    await audit(tx, row.workspaceId, row.projectId, actor.user.id, "identity_" + operation, environmentId, id);
    return issuedCredential ? { issuedCredential } : {};
  });
}
const invalid = () => new SecretsError("These credentials are unavailable. Check access or ask an admin.");
export async function universalLogin(clientId: string, clientSecret: string, ip: string, now = new Date()) {
  if (clientId.length > 100 || clientSecret.length > 300) throw invalid();
  const result = await prisma.$transaction(async tx => {
    const identity = await tx.secretIdentity.findUnique({ where: { clientId }, include: { workspace: true } });
    if (!identity) return null;
    await tx.$queryRaw`SELECT "id" FROM "SecretIdentity" WHERE "workspaceId"=${identity.workspaceId} AND "id"=${identity.id} FOR UPDATE`;
    const row = await tx.secretIdentity.findUniqueOrThrow({ where: { id: identity.id } });
    if (row.revokedAt || identity.workspace.archivedAt || identity.workspace.status !== "ACTIVE" || row.lockedUntil && row.lockedUntil > now) { await audit(tx, row.workspaceId, row.projectId, null, "identity_login_denied", undefined, row.id); return null; }
    const [credentialId, secret, extra] = clientSecret.split(".");
    const credential = credentialId ? await tx.secretIdentityCredential.findFirst({ where: { workspaceId: row.workspaceId, identityId: row.id, id: credentialId } }) : null;
    const creator = await tx.membership.findFirst({ where: { workspaceId: row.workspaceId, userId: row.createdById, status: "ACTIVE", role: { not: "GUEST" }, user: { disabledAt: null } } });
    if (!creator || !secret || extra || !credential || !safeEqual(credential.secretHash, sha256Hex(secret)) || credential.revokedAt || credential.expiresAt && credential.expiresAt <= now || credential.remainingUses === 0 || !ipAllowed(ip, row.loginIps)) {
      const failures = row.lockedUntil && row.lockedUntil <= now ? 1 : row.failures + 1;
      await tx.secretIdentity.update({ where: { id: row.id, workspaceId: row.workspaceId }, data: { failures, lockedUntil: failures >= row.failureLimit ? new Date(now.getTime() + row.lockoutSeconds * 1000) : null } });
      await audit(tx, row.workspaceId, row.projectId, null, "identity_login_failed", undefined, row.id);
      return null;
    }
    if (credential.remainingUses !== null) await tx.secretIdentityCredential.update({ where: { id: credential.id, workspaceId: row.workspaceId }, data: { remainingUses: { decrement: 1 } } });
    await tx.secretIdentity.update({ where: { id: row.id, workspaceId: row.workspaceId }, data: { failures: 0, lockedUntil: null } });
    const accessToken = "swwu_" + randomToken();
    await tx.secretIdentityToken.create({ data: { workspaceId: row.workspaceId, identityId: row.id, credentialId: credential.id, tokenHash: sha256Hex(accessToken), expiresAt: new Date(now.getTime() + row.accessTtl * 1000), maxExpiresAt: new Date(now.getTime() + row.maxTtl * 1000), remainingUses: row.tokenUses } });
    await audit(tx, row.workspaceId, row.projectId, null, "identity_login", undefined, row.id);
    return { accessToken, expiresIn: row.accessTtl, tokenType: "Bearer" };
  });
  if (!result) throw invalid();
  return result;
}
export async function identityToken(raw: string, ip: string, projectId?: string, renew = false, now = new Date()): Promise<SecretsActor | { accessToken: string; expiresIn: number; tokenType: string } | null> {
  if (!/^swwu_[A-Za-z0-9_-]{43}$/.test(raw)) return null;
  const hash = sha256Hex(raw);
  return prisma.$transaction(async tx => {
    const found = await tx.secretIdentityToken.findUnique({ where: { tokenHash: hash } });
    if (!found) return null;
    await tx.$queryRaw`SELECT "id" FROM "SecretIdentityToken" WHERE "workspaceId"=${found.workspaceId} AND "id"=${found.id} FOR UPDATE`;
    const token = await tx.secretIdentityToken.findUniqueOrThrow({ where: { id: found.id }, include: { credential: true, identity: { include: { workspace: true, permissions: true } } } });
    if (!safeEqual(token.tokenHash, hash)) return null;
    const row = token.identity;
    if (token.revokedAt || token.expiresAt <= now || token.maxExpiresAt <= now || token.remainingUses === 0 || token.credential.revokedAt || token.credential.expiresAt && token.credential.expiresAt <= now || row.revokedAt || row.workspace.archivedAt || row.workspace.status !== "ACTIVE" || !ipAllowed(ip, row.tokenIps) || projectId && projectId !== row.projectId) { await audit(tx, row.workspaceId, row.projectId, null, "identity_token_denied", undefined, token.id); return null; }
    const member = await tx.membership.findFirst({ where: { workspaceId: row.workspaceId, userId: row.createdById, status: "ACTIVE", role: { not: "GUEST" }, user: { disabledAt: null } }, include: { user: true } });
    if (!member) { await audit(tx, row.workspaceId, row.projectId, null, "identity_token_denied", undefined, token.id); return null; }
    if (renew) {
      const expiresAt = new Date(Math.min(now.getTime() + row.accessTtl * 1000, token.maxExpiresAt.getTime()));
      const accessToken = "swwu_" + randomToken();
      await tx.secretIdentityToken.update({ where: { id: token.id, workspaceId: row.workspaceId }, data: { tokenHash: sha256Hex(accessToken), expiresAt, ...(token.remainingUses !== null ? { remainingUses: { decrement: 1 } } : {}) } });
      await audit(tx, row.workspaceId, row.projectId, null, "identity_renewed", undefined, token.id);
      return { accessToken, expiresIn: Math.floor((expiresAt.getTime() - now.getTime()) / 1000), tokenType: "Bearer" };
    }
    if (token.remainingUses !== null) await tx.secretIdentityToken.update({ where: { id: token.id, workspaceId: row.workspaceId }, data: { remainingUses: { decrement: 1 } } });
    await audit(tx, row.workspaceId, row.projectId, null, "identity_used", undefined, token.id);
    return { workspace: row.workspace, membership: member, user: { id: member.userId, name: member.user.name }, machine: { id: row.id, environmentId: "", path: "", writable: true, identityPermissions: row.permissions } };
  });
}
export async function revokeOwnIdentityToken(raw: string, ip: string) {
  if (!/^swwu_[A-Za-z0-9_-]{43}$/.test(raw)) return;
  await prisma.$transaction(async tx => {
    const token = await tx.secretIdentityToken.findUnique({ where: { tokenHash: sha256Hex(raw) }, include: { identity: true } });
    if (!token || token.revokedAt || !ipAllowed(ip, token.identity.tokenIps)) return;
    await tx.secretIdentityToken.updateMany({ where: { workspaceId: token.workspaceId, id: token.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(tx, token.workspaceId, token.identity.projectId, null, "identity_token_revoked", undefined, token.id);
  });
}
