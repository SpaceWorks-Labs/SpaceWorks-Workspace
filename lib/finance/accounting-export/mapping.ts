import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { FinanceError, financeAccess, type FinanceActor } from "@/lib/finance/tools/access";

const codeValue = z
  .string()
   
  .transform((v) => v.replace(/[\u0000-\u001f\u007f]/g, " ").trim())
  .pipe(z.string().max(100, "Keep each ledger code under 100 characters."))
  .transform((v) => v || null);
const item = z.object({ id: z.string().trim().min(1).max(128), code: codeValue });
export const mappingSchema = z.object({ categories: z.array(item).max(500).default([]), accounts: z.array(item).max(200).default([]) });

/** Save ledger codes for categories and accounts of this workspace. An empty code clears the mapping. */
export async function saveExternalCodes(actor: FinanceActor, input: unknown) {
  await financeAccess(actor, "MANAGE");
  const v = mappingSchema.parse(input);
  const workspaceId = actor.workspace.id;
  return prisma.$transaction(async (tx) => {
    for (const c of v.categories) {
      const done = await tx.financeCategory.updateMany({ where: { id: c.id, workspaceId }, data: { externalCode: c.code } });
      if (done.count !== 1) throw new FinanceError("One of those categories is unavailable. Refresh and try again.");
    }
    for (const a of v.accounts) {
      const done = await tx.financeAccount.updateMany({ where: { id: a.id, workspaceId }, data: { externalCode: a.code } });
      if (done.count !== 1) throw new FinanceError("One of those accounts is unavailable. Refresh and try again.");
    }
    await recordAuditEvent({
      workspaceId,
      actorId: actor.user.id,
      action: "finance.accounting_mapping_saved",
      targetType: "accounting_mapping",
      metadata: { categories: v.categories.length, accounts: v.accounts.length },
      client: tx,
    });
    return { categories: v.categories.length, accounts: v.accounts.length };
  });
}
