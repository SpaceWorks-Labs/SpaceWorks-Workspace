import { createHash } from "node:crypto";
import type { ParsedBankLine } from "./types";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

/** Hash of the exact file text: re-uploading the same file is refused. */
export const fileHash = (text: string) => sha(text);

/**
 * One hash per line, stable across overlapping statements. A bank-assigned id
 * (OFX FITID) wins; otherwise date + amount + description + reference, with an
 * occurrence counter so two genuinely identical same-day lines both survive.
 */
export function lineHashes(lines: ReadonlyArray<ParsedBankLine>): string[] {
  const seen = new Map<string, number>();
  return lines.map((line) => {
    const key = line.fitId
      ? `fit|${line.fitId}`
      : ["v1", line.postedOn, line.amountMinor, line.description.toLowerCase(), (line.reference ?? "").toLowerCase()].join("|");
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return sha(`${key}|${n}`);
  });
}

/** Opening/closing balances from a running-balance column, whichever way the file is sorted. */
export function statementBalances(lines: ReadonlyArray<ParsedBankLine>): { openingMinor: number | null; closingMinor: number | null } {
  if (lines.length === 0) return { openingMinor: null, closingMinor: null };
  const ascending = lines[0]!.postedOn <= lines[lines.length - 1]!.postedOn;
  const first = ascending ? lines[0]! : lines[lines.length - 1]!;
  const last = ascending ? lines[lines.length - 1]! : lines[0]!;
  return {
    openingMinor: first.balanceMinor === null ? null : first.balanceMinor - first.amountMinor,
    closingMinor: last.balanceMinor,
  };
}
