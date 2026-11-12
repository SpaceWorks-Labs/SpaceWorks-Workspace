/** Bank CSV import: column mapping, guessing and row parsing (client-safe, so the UI can preview headers). */

import { z } from "zod";
import { parseCsv } from "@/lib/finance/csv";
import { cleanBankText, parseBankAmount, parseBankDate } from "./parse";
import { MAX_BANK_BYTES, MAX_BANK_LINES, type ParsedBankFile, type ParsedBankLine } from "./types";

const column = z.number().int().min(0).max(99).nullable();
export const bankMappingSchema = z
  .object({
    date: z.number().int().min(0).max(99),
    description: z.number().int().min(0).max(99),
    amount: column.default(null),
    debit: column.default(null),
    credit: column.default(null),
    balance: column.default(null),
    reference: column.default(null),
    dateOrder: z.enum(["dmy", "mdy"]).default("dmy"),
    hasHeader: z.boolean().default(true),
  })
  .refine((m) => m.amount !== null || m.debit !== null || m.credit !== null, "Choose the amount column, or the debit and credit columns.")
  .refine((m) => m.amount === null || (m.debit === null && m.credit === null), "Use either one amount column or separate debit and credit columns.");
export type BankMapping = z.infer<typeof bankMappingSchema>;

/** Best-guess mapping from a header row; unknown columns stay null for the user to choose. */
export function guessMapping(header: ReadonlyArray<string>): Partial<BankMapping> {
  const find = (pattern: RegExp, skip: ReadonlyArray<number | null | undefined> = []) => {
    const index = header.findIndex((cell, i) => pattern.test(cell.trim().toLowerCase()) && !skip.includes(i));
    return index === -1 ? null : index;
  };
  const date = find(/^(txn |transaction |posting |value )?date$|^date\b/);
  const description = find(/desc|narration|particular|detail|remark|payee/);
  const debit = find(/debit|withdraw|^dr\b/);
  const credit = find(/credit|deposit|^cr\b/);
  const amount = debit === null && credit === null ? find(/^amount|^amt/) : null;
  return {
    ...(date !== null ? { date } : {}),
    ...(description !== null ? { description } : {}),
    amount,
    debit,
    credit,
    balance: find(/balance|^bal\b/),
    reference: find(/ref|chq|cheque|utr|transaction id|txn id/, [date, description]),
  };
}

function cell(cells: string[], index: number | null): string {
  return index === null ? "" : (cells[index] ?? "").trim();
}

export function parseBankCsv(text: string, mappingInput: BankMapping, currency: string): ParsedBankFile {
  const mapping = bankMappingSchema.safeParse(mappingInput);
  if (!mapping.success) return { ok: false, error: mapping.error.issues[0]?.message ?? "Check the column choices." };
  if (new TextEncoder().encode(text).length > MAX_BANK_BYTES) return { ok: false, error: "That file is too large. Import at most 1 MB at a time." };
  const parsed = parseCsv(text);
  if (!parsed.ok) return parsed;
  const m = mapping.data;
  const body = m.hasHeader ? parsed.rows.slice(1) : parsed.rows;
  if (body.length === 0) return { ok: false, error: "The file has no transaction rows." };
  if (body.length > MAX_BANK_LINES) return { ok: false, error: `Import at most ${MAX_BANK_LINES.toLocaleString("en-IN")} lines at a time. Split the file by date.` };
  const lines: ParsedBankLine[] = [];
  const problems: { row: number; message: string }[] = [];
  body.forEach((cells, offset) => {
    const row = offset + (m.hasHeader ? 2 : 1);
    const issues: string[] = [];
    const postedOn = parseBankDate(cell(cells, m.date), m.dateOrder);
    if (!postedOn) issues.push("the date is not recognised (try 14/10/2026, 14-Oct-2026 or 2026-10-14)");
    let amount: number | null = null;
    if (m.amount !== null) {
      amount = parseBankAmount(cell(cells, m.amount), currency);
      if (amount === null) issues.push("the amount is not a number");
    } else {
      const debitText = cell(cells, m.debit);
      const creditText = cell(cells, m.credit);
      const debit = debitText ? parseBankAmount(debitText, currency) : 0;
      const credit = creditText ? parseBankAmount(creditText, currency) : 0;
      if (debit === null || credit === null) issues.push("the debit or credit is not a number");
      else if (debit !== 0 && credit !== 0) issues.push("a line has both a debit and a credit");
      else amount = Math.abs(credit) - Math.abs(debit);
    }
    if (amount === 0) issues.push("the amount is zero");
    const description = cleanBankText(cell(cells, m.description), 200);
    if (!description) issues.push("the description is empty");
    const balanceText = cell(cells, m.balance);
    const balance = balanceText ? parseBankAmount(balanceText, currency) : null;
    if (balanceText && balance === null) issues.push("the balance is not a number");
    if (issues.length || !postedOn || amount === null) {
      problems.push({ row, message: issues.join("; ") });
      return;
    }
    lines.push({
      row,
      postedOn,
      description,
      reference: cleanBankText(cell(cells, m.reference), 60) || null,
      amountMinor: amount,
      balanceMinor: balance,
      fitId: null,
    });
  });
  return { ok: true, lines, problems, closingMinor: null };
}
