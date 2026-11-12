/**
 * Ledger CSV export and import (pure, client-safe).
 *
 * Columns: date, kind, amount, currency, category, description, counterparty.
 * Amounts are positive decimals in major units ("1250.50"); `kind` says
 * whether money came in or went out. Export neutralises spreadsheet formulas
 * (a cell starting with = + - @ gets a leading apostrophe) unless the cell is
 * a plain number.
 */

import { FORMULA_START, neutraliseCell } from "@/lib/csv";
import { isValidCurrency, parseMoneyToMinor } from "@/lib/format/money";
import { isNegativeMoney, MAX_AMOUNT_MINOR, minorToDecimalString, type LedgerKindValue } from "@/lib/finance/money";

export const LEDGER_CSV_COLUMNS = ["date", "kind", "amount", "currency", "category", "description", "counterparty"] as const;
export const MAX_IMPORT_ROWS = 1000;
export const MAX_IMPORT_BYTES = 1024 * 1024;

// ───────────── Writing ─────────────

export function csvCell(value: string | number | null | undefined): string {
  const text = neutraliseCell(value === null || value === undefined ? "" : String(value));
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export type LedgerCsvEntry = {
  occurredOn: Date;
  kind: LedgerKindValue;
  amountMinor: number;
  currency: string;
  categoryName: string | null;
  description: string;
  counterparty: string | null;
};

export function ledgerToCsv(entries: ReadonlyArray<LedgerCsvEntry>): string {
  return toCsv([
    [...LEDGER_CSV_COLUMNS],
    ...entries.map((entry) => [
      entry.occurredOn.toISOString().slice(0, 10),
      entry.kind === "INCOME" ? "income" : "expense",
      minorToDecimalString(entry.amountMinor, entry.currency),
      entry.currency,
      entry.categoryName ?? "",
      entry.description,
      entry.counterparty ?? "",
    ]),
  ]);
}

// ───────────── Reading ─────────────

/**
 * RFC 4180 parser: quoted fields, doubled quotes, CRLF/LF, a leading BOM.
 * Returns rows of raw strings, or an error for an unterminated quote.
 */
export function parseCsv(text: string): { ok: true; rows: string[][] } | { ok: false; error: string } {
  const input = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  let i = 0;
  while (i < input.length) {
    const char = input[i]!;
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        closedQuote = true;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }
    if (closedQuote && char !== "," && char !== "\n" && char !== "\r") return { ok: false, error: "A quoted value has extra text after it. Check the file and try again." };
    if (char === '"' && field === "" && !closedQuote) {
      quoted = true;
    } else if (char === '"') {
      return { ok: false, error: "A quote appears inside an unquoted value. Check the file and try again." };
    } else if (char === ",") {
      row.push(field);
      field = "";
      closedQuote = false;
    } else if (char === "\n" || char === "\r") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      closedQuote = false;
      if (char === "\r" && input[i + 1] === "\n") i += 1;
    } else {
      field += char;
    }
    i += 1;
  }
  if (quoted) return { ok: false, error: "A quoted value never closes. Check the file and try again." };
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return { ok: true, rows: rows.filter((r) => r.some((cell) => cell.trim() !== "")) };
}

export type ImportCategory = { id: string; name: string; kind: LedgerKindValue; archived?: boolean };

export type ImportRow = {
  line: number;
  occurredOn: string;
  kind: LedgerKindValue;
  amountMinor: number;
  currency: string;
  categoryId: string | null;
  categoryName: string | null;
  description: string;
  counterparty: string | null;
};

export type ImportProblem = { line: number; message: string };

export type ImportPreview =
  | { ok: true; rows: ImportRow[]; problems: ImportProblem[] }
  | { ok: false; error: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function stripFormulaGuard(value: string): string {
  return value.startsWith("'") && FORMULA_START.test(value.slice(1)) ? value.slice(1) : value;
}

/**
 * Validate parsed CSV rows against the workspace (currency, categories).
 * Every row is checked; the caller only commits when `problems` is empty.
 */
export function validateLedgerImport(rows: string[][], options: { currency: string; categories: ReadonlyArray<ImportCategory> }): ImportPreview {
  if (rows.length === 0) return { ok: false, error: "That file is empty. Export the ledger to see the expected columns." };
  const header = rows[0]!.map((cell) => cell.trim().toLowerCase());
  if (new Set(header).size !== header.length) return { ok: false, error: "The header has duplicate columns. Use each column once." };
  const index: Record<string, number> = {};
  for (const column of LEDGER_CSV_COLUMNS) index[column] = header.indexOf(column);
  const missing = (["date", "kind", "amount", "description"] as const).filter((column) => index[column] === -1);
  if (missing.length) return { ok: false, error: `The header row needs these columns: ${missing.join(", ")}.` };
  const body = rows.slice(1);
  if (body.length === 0) return { ok: false, error: "The file has a header but no entries." };
  if (body.length > MAX_IMPORT_ROWS) return { ok: false, error: `Import at most ${MAX_IMPORT_ROWS} entries at a time.` };

  const categories = new Map(options.categories.map((c) => [`${c.kind}:${c.name.trim().toLowerCase()}`, c]));
  const out: ImportRow[] = [];
  const problems: ImportProblem[] = [];
  body.forEach((cells, offset) => {
    const line = offset + 2;
    const get = (column: (typeof LEDGER_CSV_COLUMNS)[number]) => (index[column]! >= 0 ? stripFormulaGuard((cells[index[column]!] ?? "").trim()) : "");
    const rowProblems: string[] = [];
    if (cells.length !== header.length) rowProblems.push("the number of values must match the header");

    const occurredOn = get("date");
    if (!isValidIsoDate(occurredOn)) rowProblems.push("date must look like 2026-10-14");

    const kindRaw = get("kind").toLowerCase();
    const kind: LedgerKindValue | null = kindRaw === "income" || kindRaw === "in" ? "INCOME" : kindRaw === "expense" || kindRaw === "out" ? "EXPENSE" : null;
    if (!kind) rowProblems.push("kind must be income or expense");

    const currency = (get("currency") || options.currency).toUpperCase();
    if (!isValidCurrency(currency)) rowProblems.push("currency must be a three-letter code");
    else if (currency !== options.currency) rowProblems.push(`currency must be ${options.currency}, the workspace currency`);

    const amountRaw = get("amount");
    const amountMinor = isValidCurrency(currency) && !isNegativeMoney(amountRaw) ? parseMoneyToMinor(amountRaw, currency) : null;
    if (amountMinor === null || amountMinor <= 0) rowProblems.push("amount must be a positive number");
    else if (amountMinor > MAX_AMOUNT_MINOR) rowProblems.push("amount is too large");

    const description = get("description");
    if (!description) rowProblems.push("description is required");
    else if (description.length > 200) rowProblems.push("description must be under 200 characters");

    const counterparty = get("counterparty");
    if (counterparty.length > 120) rowProblems.push("counterparty must be under 120 characters");

    const categoryName = get("category");
    let category: ImportCategory | undefined;
    if (categoryName && kind) {
      category = categories.get(`${kind}:${categoryName.toLowerCase()}`);
      if (!category) rowProblems.push(`no ${kind === "INCOME" ? "income" : "expense"} category called "${categoryName.slice(0, 60)}"`);
      else if (category.archived) rowProblems.push(`category "${category.name}" is archived`);
    }

    if (rowProblems.length) {
      problems.push({ line, message: rowProblems.join("; ") });
      return;
    }
    out.push({
      line,
      occurredOn,
      kind: kind!,
      amountMinor: amountMinor!,
      currency,
      categoryId: category?.id ?? null,
      categoryName: category?.name ?? null,
      description,
      counterparty: counterparty || null,
    });
  });
  return { ok: true, rows: out, problems };
}
