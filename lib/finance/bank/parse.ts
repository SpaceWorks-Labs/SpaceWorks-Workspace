/** Cell-level parsers for bank files: dates, Indian-style amounts, text clean-up (client-safe). */

import { currencyMinorDigits } from "@/lib/format/money";
import { MAX_AMOUNT_MINOR } from "@/lib/finance/money";
import type { DateOrder } from "./types";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function realDate(year: number, month: number, day: number): string | null {
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

function fullYear(text: string): number {
  const n = Number(text);
  return text.length === 2 ? (n < 70 ? 2000 + n : 1900 + n) : n;
}

/**
 * ISO (2026-10-14), DD/MM/YYYY, DD-MM-YYYY, DD.MM.YY, DD-MMM-YYYY and "14 Oct 2026".
 * Purely numeric dates read day-first unless `order` is "mdy".
 */
export function parseBankDate(raw: string, order: DateOrder = "dmy"): string | null {
  const text = raw.trim();
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$/.exec(text);
  if (m) return realDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4}|\d{2})$/.exec(text);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return order === "dmy" ? realDate(fullYear(m[3]!), b, a) : realDate(fullYear(m[3]!), a, b);
  }
  m = /^(\d{1,2})[\s\-/.]+([A-Za-z]{3,9})\.?[\s\-/.,]+(\d{4}|\d{2})$/.exec(text);
  if (m) {
    const month = MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase()) + 1;
    return month ? realDate(fullYear(m[3]!), month, Number(m[1])) : null;
  }
  return null;
}

/**
 * Signed amount in minor units. Accepts Indian grouping ("1,00,000.50"), a
 * leading minus, parentheses, a trailing minus, Dr/Cr suffixes (Dr = debit)
 * and a currency prefix (₹, Rs., INR). Returns null when it is not a number.
 */
export function parseBankAmount(raw: string, currency = "INR"): number | null {
  let text = raw.trim();
  if (!text) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1).trim();
  }
  const suffix = /\s*(dr|cr)\.?$/i.exec(text);
  if (suffix) {
    negative = negative || suffix[1]!.toLowerCase() === "dr";
    text = text.slice(0, suffix.index).trim();
  }
  if (/[-−]$/.test(text)) {
    negative = true;
    text = text.slice(0, -1).trim();
  }
  if (/^[-−]/.test(text)) {
    negative = !negative;
    text = text.slice(1).trim();
  }
  if (text.startsWith("+")) text = text.slice(1).trim();
  text = text.replace(/^(?:₹|rs\.?|inr)\s*/i, "").replace(/[\s,]/g, "");
  const digits = currencyMinorDigits(currency);
  const pattern = digits > 0 ? new RegExp(`^\\d+(\\.\\d{1,${digits}})?$`) : /^\d+$/;
  if (!pattern.test(text)) return null;
  const [whole = "0", fraction = ""] = text.split(".");
  const minor = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0") || 0);
  if (!Number.isSafeInteger(minor) || minor > MAX_AMOUNT_MINOR) return null;
  return negative && minor !== 0 ? -minor : minor;
}

const FORMULA_START = /^\s*[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[-+]?\d+(\.\d+)?$/;

/**
 * Text from a bank file is untrusted: drop control characters, collapse
 * whitespace, cap the length and defuse spreadsheet formulas with a leading
 * apostrophe (the same rule the CSV exports use).
 */
export function cleanBankText(raw: string, max: number): string {
   
  let text = raw.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  if (FORMULA_START.test(text) && !PLAIN_NUMBER.test(text)) text = `'${text}`.slice(0, max);
  return text;
}
