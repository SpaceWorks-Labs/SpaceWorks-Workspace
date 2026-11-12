/**
 * Shared CSV helpers (pure, client-safe): RFC 4180 reading, and writing with
 * spreadsheet-formula neutralisation. A cell that starts with = + - @ (or a
 * tab/CR/LF) gets a leading apostrophe unless it is a plain number.
 */

export const FORMULA_START = /^(?:[\t\r\n]|\s*[=+\-@])/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/** Prefix a cell that a spreadsheet could run as a formula. */
export function neutraliseCell(text: string): string {
  return FORMULA_START.test(text) && !PLAIN_NUMBER.test(text) ? `'${text}` : text;
}

export function csvCell(value: string | number | null | undefined): string {
  const text = neutraliseCell(value === null || value === undefined ? "" : String(value));
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** RFC 4180 reader: quoted fields, doubled quotes, CRLF/LF, a leading BOM. Blank rows are dropped. */
export function parseCsvText(text: string): { ok: true; rows: string[][] } | { ok: false; error: string } {
  const input = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (quoted) {
      if (char !== '"') field += char;
      else if (input[i + 1] === '"') { field += '"'; i++; }
      else { quoted = false; closedQuote = true; }
      continue;
    }
    if (closedQuote && char !== "," && char !== "\n" && char !== "\r") return { ok: false, error: "A quoted value has extra text after it. Check the file and try again." };
    if (char === '"') {
      if (field !== "" || closedQuote) return { ok: false, error: "A quote appears inside an unquoted value. Check the file and try again." };
      quoted = true;
    } else if (char === ",") {
      row.push(field); field = ""; closedQuote = false;
    } else if (char === "\n" || char === "\r") {
      row.push(field); rows.push(row); row = []; field = ""; closedQuote = false;
      if (char === "\r" && input[i + 1] === "\n") i++;
    } else {
      field += char;
    }
  }
  if (quoted) return { ok: false, error: "A quoted value never closes. Check the file and try again." };
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return { ok: true, rows: rows.filter((r) => r.some((cell) => cell.trim() !== "")) };
}
