import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { randomToken, sha256Hex, safeEqual } from "@/lib/crypto";
import {
  environmentAccess,
  requireSecretsMfa,
  type SecretsActor,
} from "./access";
import { SecretsError } from "./values";
import { audit } from "./mutations";
export async function createShare(
  actor: SecretsActor,
  environmentId: string,
  input: unknown,
) {
  const env = await environmentAccess(actor, environmentId, "READ");
  await requireSecretsMfa(actor, env.production);
  const p = z
    .object({
      ciphertext: z
        .string()
        .min(20)
        .max(80000)
        .regex(/^[A-Za-z0-9_=-]+\.[A-Za-z0-9_=-]+$/),
      hours: z.number().int().min(1).max(168),
      views: z.number().int().min(1).max(20),
    })
    .safeParse(input);
  if (!p.success || actor.machine)
    throw new SecretsError("Check the sharing options and try again.");
  const capability = randomToken();
  await prisma.$transaction(async (tx) => {
    const row = await tx.secretShare.create({
      data: {
        workspaceId: actor.workspace.id,
        projectId: env.projectId,
        capabilityHash: sha256Hex(capability),
        ciphertext: p.data.ciphertext,
        remainingViews: p.data.views,
        expiresAt: new Date(Date.now() + p.data.hours * 3600000),
        createdById: actor.user.id,
      },
    });
    await audit(
      tx,
      actor.workspace.id,
      env.projectId,
      actor.user.id,
      "share_created",
      environmentId,
      row.id,
    );
  });
  return capability;
}
export async function consumeShare(capability: string, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(capability))
    throw new SecretsError(
      "This share has expired or has already been viewed.",
    );
  return prisma.$transaction(async (tx) => {
    const hash = sha256Hex(capability);
    await tx.$queryRaw`SELECT "id" FROM "SecretShare" WHERE "capabilityHash"=${hash} FOR UPDATE`;
    const row = await tx.secretShare.findUnique({
      where: { capabilityHash: hash },
      include: { workspace: { select: { archivedAt: true, status: true } } },
    });
    if (
      !row ||
      !safeEqual(row.capabilityHash, hash) ||
      row.expiresAt <= now ||
      row.remainingViews < 1 ||
      row.workspace.archivedAt ||
      row.workspace.status !== "ACTIVE"
    )
      throw new SecretsError(
        "This share has expired or has already been viewed.",
      );
    const ciphertext = row.ciphertext;
    if (row.remainingViews === 1)
      await tx.secretShare.delete({
        where: { workspaceId: row.workspaceId, id: row.id },
      });
    else
      await tx.secretShare.update({
        where: { workspaceId: row.workspaceId, id: row.id },
        data: { remainingViews: { decrement: 1 } },
      });
    await audit(
      tx,
      row.workspaceId,
      row.projectId,
      null,
      "share_viewed",
      undefined,
      row.id,
    );
    return ciphertext;
  });
}
