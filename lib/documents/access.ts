import "server-only";
import { prisma, type DbClient } from "@/lib/db";
import { activeMemberOrSuperAdmin } from "@/lib/accessMember";
import { lockFinance } from "@/lib/finance/tools/access";
import { canIssueFinancialDocuments, canIssueLetters } from "@/lib/roles";
import type { FinanceActor } from "@/lib/finance/tools/access";
export type DocumentsActor = FinanceActor;
export class DocumentsError extends Error {}
export const unavailable =
  "That document is unavailable. Refresh and try again.";
export async function documentsAccess(
  actor: DocumentsActor,
  type?: string,
  tx: DbClient = prisma,
) {
  const membership = await activeMemberOrSuperAdmin(tx, actor);
  if (
    !membership ||
    !(type &&
    [
      "APPOINTMENT",
      "VOLUNTEER",
      "INTERNSHIP",
      "EXPERIENCE",
      "NOC",
      "PARTICIPATION",
    ].includes(type)
      ? canIssueLetters(membership)
      : canIssueFinancialDocuments(membership))
  )
    throw new DocumentsError("You don't have access to do that.");
  return membership;
}
export async function getDocument(
  actor: DocumentsActor,
  id: string,
  tx: DbClient = prisma,
) {
  const row = await tx.businessDocument.findFirst({
    where: { workspaceId: actor.workspace.id, id },
  });
  if (!row) throw new DocumentsError(unavailable);
  if (row.sourceType !== "PAY_RUN") await documentsAccess(actor, row.type, tx);
  // Payroll documents inherit explicit payroll grants even for owners.
  if (row.sourceType === "PAY_RUN") {
    const { financeAccess } = await import("@/lib/finance/tools/access");
    try {
      await financeAccess(actor, "PAY_VIEW", tx);
    } catch {
      throw new DocumentsError(unavailable);
    }
  }
  return row;
}
export async function lockDocuments(tx: DbClient, workspaceId: string) {
  await lockFinance(tx, workspaceId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`documents:${workspaceId}`}))`;
}
