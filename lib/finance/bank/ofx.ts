/**
 * OFX/QFX statement parser (client-safe). Handles OFX 1.x SGML (unclosed tags)
 * and OFX 2.x XML by scanning tags with regular expressions; no XML parser is
 * involved, so entity or DTD tricks have nothing to expand.
 */

import { cleanBankText, parseBankAmount } from "./parse";
import { MAX_BANK_BYTES, MAX_BANK_LINES, type ParsedBankFile, type ParsedBankLine } from "./types";

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };

function field(block: string, tag: string): string {
  const match = new RegExp(`<${tag}>([^<\\r\\n]*)`, "i").exec(block);
  return (match?.[1] ?? "").replace(/&(?:amp|lt|gt|quot|apos);/g, (e) => ENTITIES[e] ?? e).trim();
}

function ofxDate(value: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(value);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso ? null : iso;
}

export function parseOfx(text: string, currency: string): ParsedBankFile {
  if (new TextEncoder().encode(text).length > MAX_BANK_BYTES) return { ok: false, error: "That file is too large. Import at most 1 MB at a time." };
  if (!/<OFX[\s>]/i.test(text) || !/<STMTTRN>/i.test(text)) return { ok: false, error: "That does not look like an OFX bank statement. Choose a .ofx or .qfx file, or import a CSV." };
  const declared = field(text, "CURDEF").toUpperCase();
  if (declared && declared !== currency.toUpperCase()) return { ok: false, error: `The statement is in ${declared} but this account is in ${currency}. Choose the matching account.` };
  const blocks = text.split(/<STMTTRN>/i).slice(1).map((part) => part.split(/<\/STMTTRN>|<\/BANKTRANLIST>/i)[0]!);
  if (blocks.length > MAX_BANK_LINES) return { ok: false, error: `Import at most ${MAX_BANK_LINES.toLocaleString("en-IN")} lines at a time. Split the file by date.` };
  const lines: ParsedBankLine[] = [];
  const problems: { row: number; message: string }[] = [];
  blocks.forEach((block, i) => {
    const row = i + 1;
    const postedOn = ofxDate(field(block, "DTPOSTED"));
    const amount = parseBankAmount(field(block, "TRNAMT").replace(/^\+/, ""), currency);
    const name = cleanBankText(field(block, "NAME"), 200);
    const memo = cleanBankText(field(block, "MEMO"), 200);
    const description = cleanBankText([name, memo].filter((v, k, all) => v && all.indexOf(v) === k).join(" - "), 200);
    const fitId = field(block, "FITID").slice(0, 80) || null;
    const issues: string[] = [];
    if (!postedOn) issues.push("the posted date is missing or invalid");
    if (amount === null || amount === 0) issues.push("the amount is missing, zero or not a number");
    if (issues.length || !postedOn || amount === null) {
      problems.push({ row, message: issues.join("; ") });
      return;
    }
    lines.push({
      row,
      postedOn,
      description: description || cleanBankText(field(block, "TRNTYPE"), 40) || "Bank transaction",
      reference: cleanBankText(field(block, "CHECKNUM") || field(block, "REFNUM") || (fitId ?? ""), 60) || null,
      amountMinor: amount,
      balanceMinor: null,
      fitId,
    });
  });
  const ledger = /<LEDGERBAL>[\s\S]*?<BALAMT>([^<\r\n]*)/i.exec(text);
  const closing = ledger ? parseBankAmount(ledger[1]!.trim().replace(/^\+/, ""), currency) : null;
  return { ok: true, lines, problems, closingMinor: closing };
}
