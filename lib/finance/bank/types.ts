/** Shared bank-import shapes (client-safe). Amounts are signed minor units: credits positive, debits negative. */

export const MAX_BANK_BYTES = 1024 * 1024;
export const MAX_BANK_LINES = 5000;

export type BankFormat = "CSV" | "OFX";
export type DateOrder = "dmy" | "mdy";

export type ParsedBankLine = {
  /** 1-based row in the source file (CSV line or OFX transaction number). */
  row: number;
  postedOn: string;
  description: string;
  reference: string | null;
  amountMinor: number;
  balanceMinor: number | null;
  /** Bank-assigned transaction id (OFX FITID); when present it drives de-duplication. */
  fitId: string | null;
};

export type BankProblem = { row: number; message: string };

export type ParsedBankFile =
  | {
      ok: true;
      lines: ParsedBankLine[];
      problems: BankProblem[];
      closingMinor: number | null;
    }
  | { ok: false; error: string };
