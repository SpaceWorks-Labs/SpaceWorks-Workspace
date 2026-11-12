import "server-only";
import { BlockList, isIP } from "node:net";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { randomToken, sha256Hex, safeEqual } from "@/lib/crypto";
import {
  environmentAccess,
  requireSecretsMfa,
  type SecretsActor,
} from "./access";
import { normalisePath, SecretsError } from "./values";
import { audit } from "./mutations";
export function ipAllowed(ip: string, rules: string[]) {
  if (!rules.length) return true;
  if (!isIP(ip)) return false;
  return rules.some((rule) => {
    try {
      const [address, prefix, extra] = rule.split("/");
      const family = isIP(address);
      if (!family || extra) return false;
      const block = new BlockList();
      if (prefix !== undefined) {
        if (!/^\d+$/.test(prefix) || Number(prefix) > (family === 4 ? 32 : 128))
          return false;
        block.addSubnet(
          address,
          Number(prefix),
          family === 4 ? "ipv4" : "ipv6",
        );
      } else block.addAddress(address, family === 4 ? "ipv4" : "ipv6");
      return block.check(ip, isIP(ip) === 4 ? "ipv4" : "ipv6");
    } catch {
      return false;
    }
  });
}
export async function createServiceToken(
  actor: SecretsActor,
  environmentId: string,
  input: unknown,
) {
  const env = await environmentAccess(actor, environmentId, "ADMIN");
  await requireSecretsMfa(actor, env.production);
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(100),
      path: z.string().transform(normalisePath),
      writable: z.boolean().default(false),
      expiresAt: z.coerce.date().nullable().default(null),
      ipAllowlist: z.array(z.string().max(100)).max(30).default([]),
    })
    .safeParse(input);
  if (!parsed.success || actor.machine)
    throw new SecretsError("Check the token fields and try again.");
  const v = parsed.data;
  if (v.expiresAt && v.expiresAt <= new Date())
    throw new SecretsError("Choose a future expiry date.");
  for (const rule of v.ipAllowlist) {
    const [ip, prefix, extra] = rule.split("/");
    if (
      !isIP(ip) ||
      extra ||
      (prefix !== undefined &&
        (!/^\d+$/.test(prefix) || Number(prefix) > (isIP(ip) === 4 ? 32 : 128)))
    )
      throw new SecretsError(
        "Use IP addresses or CIDR ranges in the allowlist.",
      );
  }
  const prefix = "swws_" + randomToken(9);
  const secret = randomToken();
  await prisma.$transaction(async (tx) => {
    const row = await tx.secretServiceToken.create({
      data: {
        workspaceId: actor.workspace.id,
        environmentId,
        ...v,
        prefix,
        secretHash: sha256Hex(secret),
        createdById: actor.user.id,
      },
    });
    await audit(
      tx,
      actor.workspace.id,
      env.projectId,
      actor.user.id,
      "token_created",
      environmentId,
      row.id,
    );
  });
  return prefix + "." + secret;
}
export async function revokeServiceToken(
  actor: SecretsActor,
  environmentId: string,
  id: string,
) {
  const env = await environmentAccess(actor, environmentId, "ADMIN");
  if (actor.machine)
    throw new SecretsError("Use your member account to revoke tokens.");
  await prisma.$transaction(async (tx) => {
    await tx.secretServiceToken.updateMany({
      where: { workspaceId: actor.workspace.id, environmentId, id },
      data: { revokedAt: new Date() },
    });
    await audit(
      tx,
      actor.workspace.id,
      env.projectId,
      actor.user.id,
      "token_revoked",
      environmentId,
      id,
    );
  });
}
export async function authenticateServiceToken(
  raw: string,
  ip: string,
  now = new Date(),
): Promise<SecretsActor | null> {
  if (raw.length > 300) return null;
  const [prefix, secret, extra] = raw.split(".");
  if (!prefix?.startsWith("swws_") || !secret || extra) return null;
  const row = await prisma.secretServiceToken.findUnique({
    where: { prefix },
    include: { environment: { include: { project: true } }, workspace: true },
  });
  if (
    !row ||
    !safeEqual(row.secretHash, sha256Hex(secret)) ||
    row.revokedAt ||
    (row.expiresAt && row.expiresAt <= now) ||
    row.workspace.archivedAt ||
    row.workspace.status !== "ACTIVE" ||
    !ipAllowed(ip, row.ipAllowlist)
  )
    return null;
  const membership = await prisma.membership.findFirst({
    where: {
      workspaceId: row.workspaceId,
      userId: row.createdById,
      status: "ACTIVE",
      user: { disabledAt: null },
    },
    include: { user: { select: { name: true } } },
  });
  if (!membership) return null;
  const actor: SecretsActor = {
    user: { id: membership.userId, name: membership.user.name },
    workspace: row.workspace,
    membership,
    machine: {
      id: row.id,
      environmentId: row.environmentId,
      path: row.path,
      writable: row.writable,
    },
  };
  try {
    await environmentAccess(actor, row.environmentId, "READ");
  } catch {
    return null;
  }
  await prisma.$transaction(async (tx) => {
    await tx.secretServiceToken.update({
      where: { workspaceId: row.workspaceId, id: row.id },
      data: { lastUsedAt: now },
    });
    await audit(
      tx,
      row.workspaceId,
      row.environment.projectId,
      row.createdById,
      "token_used",
      row.environmentId,
      row.id,
    );
  });
  return actor;
}
