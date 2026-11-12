import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { dateOnly } from "@/lib/finance/dates";
import { FinanceError, financeAccess, type FinanceActor } from "@/lib/finance/tools/access";
import { bankMappingSchema, parseBankCsv } from "../csv";
import { fileHash, lineHashes, statementBalances } from "../hash";
import { parseOfx } from "../ofx";
import type { ParsedBankLine } from "../types";

export const bankImportSchema = z.object({
  accountId: z.string().trim().min(1).max(128),
  format: z.enum(["CSV", "OFX"]),
  filename: z.string().trim().min(1).max(200),
  text: z.string().min(1).max(1_100_000),
  mapping: bankMappingSchema.nullish(),
});

export type BankPreview = {
  total: number;
  newCount: number;
  duplicateCount: number;
  fileAlreadyImported: boolean;
  fromDate: string | null;
  toDate: string | null;
  problems: { row: number; message: string }[];
  sample: ParsedBankLine[];
};

async function prepare(actor: FinanceActor, input: unknown) {
  await financeAccess(actor, "MANAGE");
  const v = bankImportSchema.parse(input);
  const account = await prisma.financeAccount.findFirst({ where: { id: v.accountId, workspaceId: actor.workspace.id } });
  if (!account) throw new FinanceError("Choose an account in this workspace.");
  const parsed = v.format === "OFX" ? parseOfx(v.text, account.currency) : v.mapping ? parseBankCsv(v.text, v.mapping, account.currency) : null;
  if (!parsed) throw new FinanceError("Choose which columns hold the date, description and amount.");
  if (!parsed.ok) throw new FinanceError(parsed.error);
  const hashes = lineHashes(parsed.lines);
  const existing = await existingHashes(actor.workspace.id, account.id, hashes);
  return { v, account, parsed, hashes, existing, hash: fileHash(v.text) };
}

async function existingHashes(workspaceId: string, accountId: string, hashes: string[]) {
  const found = new Set<string>();
  for (let i = 0; i < hashes.length; i += 1000) {
    const rows = await prisma.financeBankLine.findMany({ where: { workspaceId, accountId, lineHash: { in: hashes.slice(i, i + 1000) } }, select: { lineHash: true } });
    for (const row of rows) found.add(row.lineHash);
  }
  return found;
}

/** Parse and report; nothing is written. */
export async function previewBankImport(actor: FinanceActor, input: unknown): Promise<BankPreview> {
  const { account, parsed, hashes, existing, hash } = await prepare(actor, input);
  const dates = parsed.lines.map((l) => l.postedOn).sort();
  const fileAlreadyImported = !!(await prisma.financeBankStatement.findFirst({
    where: { workspaceId: actor.workspace.id, accountId: account.id, fileHash: hash },
    select: { id: true },
  }));
  const duplicateCount = hashes.filter((h) => existing.has(h)).length;
  return {
    total: parsed.lines.length,
    newCount: parsed.lines.length - duplicateCount,
    duplicateCount,
    fileAlreadyImported,
    fromDate: dates[0] ?? null,
    toDate: dates[dates.length - 1] ?? null,
    problems: parsed.problems.slice(0, 100),
    sample: parsed.lines.slice(0, 100),
  };
}

/** Save the statement and every line not already imported. Rows with problems stop the import. */
export async function commitBankImport(actor: FinanceActor, input: unknown) {
  const { v, account, parsed, hashes, existing, hash } = await prepare(actor, input);
  if (parsed.problems.length) throw new FinanceError("Fix the rows marked in the preview before importing.");
  if (parsed.lines.length === 0) throw new FinanceError("The file has no transactions.");
  const fresh = parsed.lines.map((line, i) => ({ line, hash: hashes[i]! })).filter((x) => !existing.has(x.hash));
  if (fresh.length === 0) throw new FinanceError("Every line in this file was already imported.");
  const dates = parsed.lines.map((l) => l.postedOn).sort();
  const balances = statementBalances(parsed.lines);
  try {
    return await prisma.$transaction(async (tx) => {
      const statement = await tx.financeBankStatement.create({
        data: {
          workspaceId: actor.workspace.id,
          accountId: account.id,
          filename: v.filename,
          format: v.format,
          importedById: actor.user.id,
          fileHash: hash,
          rowCount: fresh.length,
          fromDate: dateOnly(dates[0]!),
          toDate: dateOnly(dates[dates.length - 1]!),
          openingMinor: balances.openingMinor,
          closingMinor: parsed.closingMinor ?? balances.closingMinor,
        },
      });
      const created = await tx.financeBankLine.createMany({
        skipDuplicates: true,
        data: fresh.map(({ line, hash: lineHash }) => ({
          workspaceId: actor.workspace.id,
          statementId: statement.id,
          accountId: account.id,
          postedOn: dateOnly(line.postedOn),
          description: line.description,
          reference: line.reference,
          amountMinor: line.amountMinor,
          currency: account.currency,
          balanceMinor: line.balanceMinor,
          lineHash,
        })),
      });
      if (created.count !== fresh.length) await tx.financeBankStatement.update({ where: { id: statement.id }, data: { rowCount: created.count } });
      await recordAuditEvent({
        workspaceId: actor.workspace.id,
        actorId: actor.user.id,
        action: "finance.bank_statement_imported",
        targetType: "bank_statement",
        targetId: statement.id,
        metadata: { format: v.format, lines: created.count, skipped: parsed.lines.length - created.count },
        client: tx,
      });
      return { statementId: statement.id, imported: created.count, skipped: parsed.lines.length - created.count };
    });
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "P2002") throw new FinanceError("This file was already imported for this account.");
    throw e;
  }
}
