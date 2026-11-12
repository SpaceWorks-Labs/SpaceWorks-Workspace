import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { saveAsset } from "@/lib/assets/service";
import type { OpsActor } from "@/lib/approvals/context";
import { minorToDecimalString } from "@/lib/finance/money";
import { assertActor, ensure } from "./access";
import { detailSchemas } from "@/lib/funding/schema";

const schema = z.object({
  id: z.string().trim().min(1).max(64),
  note: z.string().trim().max(1000).default(""),
  /** Estimated value in minor units; defaults to the gift's recorded amount. */
  estimatedMinor: z.number().int().min(0).max(2147483647).optional(),
});
const marker = (id: string) => `[funding:${id}]`;

/** Creates (once) an asset record for an in-kind gift. In-kind gifts never post to the ledger. */
export async function createAssetFromInKind(actor: OpsActor, raw: unknown): Promise<{ assetId: string; created: boolean }> {
  const v = schema.parse(raw);
  const workspaceId = actor.workspace.id;
  await assertActor({ user: actor.user, workspace: { ...actor.workspace }, membership: actor.membership });
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`funding-inkind:${workspaceId}:${v.id}`}))`;
    const record = await tx.fundingRecord.findFirst({ where: { workspaceId, id: v.id, kind: "DONATION", archivedAt: null } });
    ensure(record && record.status === "RECEIVED", "Choose a received donation.");
    const d = detailSchemas.DONATION.parse(record.details);
    ensure(d.mode === "IN_KIND", "Only in-kind gifts become asset records.");
    const found = await tx.asset.findFirst({ where: { workspaceId, notes: { contains: marker(record.id) } }, select: { id: true } });
    if (found) return { assetId: found.id, created: false };
    const donor = record.contactId ? (await tx.contact.findFirst({ where: { workspaceId, id: record.contactId }, select: { displayName: true } }))?.displayName : null;
    const estimate = v.estimatedMinor ?? record.amountMinor;
    const assetId = await saveAsset(actor, { name: (d.inKindItem || record.title).slice(0, 200), category: "Donated equipment", status: "AVAILABLE" });
    const notes = [`Donated in kind${donor ? ` by ${donor}` : ""}${record.dateOn ? ` on ${record.dateOn.toISOString().slice(0, 10)}` : ""}.`, `Estimated value ${record.currency} ${minorToDecimalString(estimate, record.currency)}.`, v.note, marker(record.id)].filter(Boolean).join(" ");
    await tx.asset.updateMany({ where: { workspaceId, id: assetId }, data: { notes, purchasePriceMinor: estimate, currency: record.currency, purchaseDate: record.dateOn } });
    await recordAuditEvent({ workspaceId, actorId: actor.user.id, action: "funding.inkind_asset_created", targetType: "funding_record", targetId: record.id, metadata: { assetId }, client: tx });
    return { assetId, created: true };
  }, { timeout: 20000 });
}
