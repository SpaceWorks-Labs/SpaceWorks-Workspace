import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { OpsActor } from "@/lib/approvals/context";
import { guard, id, lockAsset, note, OpsError, parse } from "@/lib/approvals/ops";
import { canManageAssets } from "@/lib/roles";
import { signoffStatus, type SignoffMatrix } from "./certStatus";

export async function requiredCertTypes(actor: OpsActor, assetId: string) {
  await guard(actor);
  const rows = await prisma.assetCertRequirement.findMany({ where: { workspaceId: actor.workspace.id, assetId }, select: { certType: { select: { id: true, name: true, validityDays: true } } } });
  return rows.map((row) => row.certType).sort((a, b) => a.name.localeCompare(b.name));
}

/** Replace the set of inductions an asset requires. */
export async function setCertRequirements(actor: OpsActor, input: unknown) {
  await guard(actor, true);
  const v = parse(z.object({ assetId: id, certTypeIds: z.array(id).max(50) }), input);
  const ids = [...new Set(v.certTypeIds)];
  await prisma.$transaction(async (tx) => {
    await lockAsset(tx, actor.workspace.id, v.assetId);
    if ((await tx.certType.count({ where: { workspaceId: actor.workspace.id, id: { in: ids } } })) !== ids.length) throw new OpsError("Choose training types from this workspace.");
    await tx.assetCertRequirement.deleteMany({ where: { workspaceId: actor.workspace.id, assetId: v.assetId } });
    if (ids.length) await tx.assetCertRequirement.createMany({ data: ids.map((certTypeId) => ({ workspaceId: actor.workspace.id, assetId: v.assetId, certTypeId })) });
    await note(actor, "asset", v.assetId, "inductions_set", tx);
  });
}

export { needsAttention, type MatrixRow, type SignoffMatrix } from "./certStatus";

/**
 * People x required inductions for several assets in four queries. Admins see every active
 * non-guest member; everyone else only their own row, so training records are not exposed
 * beyond what the Training sign-offs page already allows.
 */
export async function signoffMatrices(actor: OpsActor & { user: { id: string } }, assetIds: string[], now = new Date()): Promise<Map<string, SignoffMatrix>> {
  await guard(actor);
  const full = canManageAssets(actor.membership);
  const reqs = await prisma.assetCertRequirement.findMany({ where: { workspaceId: actor.workspace.id, assetId: { in: assetIds } }, select: { assetId: true, certType: { select: { id: true, name: true } } } });
  const typeIds = [...new Set(reqs.map((r) => r.certType.id))];
  const [members, grants] = typeIds.length
    ? await Promise.all([
        prisma.membership.findMany({
          where: { workspaceId: actor.workspace.id, status: "ACTIVE", user: { disabledAt: null }, ...(full ? { role: { not: "GUEST" } } : { userId: actor.user.id }) },
          select: { userId: true, user: { select: { name: true, email: true } } },
          orderBy: { user: { name: "asc" } },
          take: 300,
        }),
        prisma.certification.findMany({ where: { certTypeId: { in: typeIds }, certType: { workspaceId: actor.workspace.id } }, select: { userId: true, certTypeId: true, expiresAt: true, revokedAt: true } }),
      ])
    : [[], []];
  const out = new Map<string, SignoffMatrix>();
  for (const assetId of assetIds) {
    const types = reqs.filter((r) => r.assetId === assetId).map((r) => r.certType).sort((a, b) => a.name.localeCompare(b.name));
    const rows = types.length
      ? members.map((m) => ({
          userId: m.userId,
          name: m.user.name ?? m.user.email,
          cells: Object.fromEntries(types.map((t) => [t.id, signoffStatus(grants.filter((g) => g.userId === m.userId && g.certTypeId === t.id), now)])),
        }))
      : [];
    out.set(assetId, { types, rows, full });
  }
  return out;
}

export async function signoffMatrix(actor: OpsActor & { user: { id: string } }, assetId: string, now = new Date()): Promise<SignoffMatrix> {
  return (await signoffMatrices(actor, [assetId], now)).get(assetId)!;
}

/** Cells that are expiring or expired, for the warning banner. */
