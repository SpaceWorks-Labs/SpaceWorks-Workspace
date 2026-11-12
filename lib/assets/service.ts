import "server-only";
import { z } from "zod";
import { randomToken } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { type OpsActor } from "@/lib/approvals/context";
import { guard, parse, id, title, optionalId, optionalDate, minor, memberRef, lockAsset, OpsError, note, searchable } from "@/lib/approvals/ops";

export async function listAssets(actor: OpsActor) {
 await guard(actor);
 return prisma.asset.findMany({ where: { workspaceId: actor.workspace.id }, include: { maintenance: { orderBy: { at: "desc" }, take: 5 } }, orderBy: { name: "asc" }, take: 500 });
}
export async function saveAsset(actor: OpsActor, input: unknown) {
 await guard(actor, true);
 const v = parse(z.object({ id: optionalId, name: title, category: title, location: z.string().trim().max(200).optional(), condition: z.string().trim().max(200).optional(), status: z.enum(["AVAILABLE", "IN_MAINTENANCE", "LOST", "RETIRED"]).default("AVAILABLE") }), input);
 return prisma.$transaction(async tx => {
  if (v.id) await lockAsset(tx, actor.workspace.id, v.id);
  if (v.id) {
   const disposed=await tx.moneyControlRecord.findFirst({where:{workspaceId:actor.workspace.id,assetId:v.id,kind:"DISPOSAL",status:"POSTED"}});
   if(disposed && v.status!=="RETIRED") throw new OpsError("Disposed equipment stays retired. Add a new inventory record if it is acquired again.");
   if(!disposed && v.status==="RETIRED" && await tx.moneyControlRecord.findFirst({where:{workspaceId:actor.workspace.id,assetId:v.id,kind:"SCHEDULE",status:"ACTIVE"}})) throw new OpsError("Record this asset’s disposal with supporting evidence in Money controls.");
  }
  const { id: assetId, ...data } = v;
  const row = assetId ? await tx.asset.update({ where: { id: assetId, workspaceId: actor.workspace.id }, data }) : await tx.asset.create({ data: { ...data, workspaceId: actor.workspace.id, tag: randomToken(12) } });
  await note(actor, "asset", row.id, "saved", tx); await searchable(actor, "asset", row.id, row.name, "assets", null, tx); return row.id;
 });
}
export async function logMaintenance(actor: OpsActor, input: unknown) {
 await guard(actor, true); const v = parse(z.object({ assetId: id, type: z.enum(["REPAIR", "SERVICE", "INSPECTION", "NOTE"]), note: z.string().trim().min(1).max(2000), costMinor: z.preprocess(v => v === "" ? undefined : v, minor.optional()), nextDueAt: optionalDate }), input);
 await prisma.$transaction(async tx => { await lockAsset(tx, actor.workspace.id, v.assetId); await tx.assetMaintenanceLog.create({ data: { ...v, byUserId: actor.user.id } }); await note(actor, "asset", v.assetId, "maintained", tx); });
}
export async function saveKey(actor: OpsActor, input: unknown) {
 await guard(actor, true); const v = parse(z.object({ id: optionalId, label: title, type: z.enum(["KEY", "FOB", "CARD", "CODE"]), area: z.string().trim().max(200).optional(), holderUserId: optionalId, status: z.enum(["ISSUED", "IN_SAFE", "LOST", "RETIRED"]) }), input); await memberRef(actor, v.holderUserId);
 if (v.status === "ISSUED" && !v.holderUserId) throw new OpsError("Choose the member holding this key.");
 const { id: keyId, ...data } = v;
 const row = keyId ? await prisma.accessCredential.update({ where: { id: keyId, workspaceId: actor.workspace.id }, data: { ...data, issuedAt: v.status === "ISSUED" ? new Date() : undefined, returnedAt: v.status === "IN_SAFE" ? new Date() : null } }) : await prisma.accessCredential.create({ data: { ...data, workspaceId: actor.workspace.id, issuedAt: v.status === "ISSUED" ? new Date() : null } });
 await note(actor, "asset", row.id, "key_saved"); return row.id;
}
