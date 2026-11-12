/** Accounting-export shapes (client-safe). */

export const ACCOUNTING_FORMATS = ["tally", "xero", "quickbooks", "journal"] as const;
export type AccountingFormat = (typeof ACCOUNTING_FORMATS)[number];

export const FORMAT_INFO: Record<AccountingFormat, { label: string; extension: string; contentType: string; description: string; needsAccount: boolean }> = {
  tally: { label: "Tally voucher XML", extension: "xml", contentType: "application/xml; charset=utf-8", description: "Payment, Receipt and Journal vouchers using your Tally ledger names.", needsAccount: false },
  xero: { label: "Xero bank statement CSV", extension: "csv", contentType: "text/csv; charset=utf-8", description: "One bank account's lines in Xero's statement layout (Date, Amount, Payee, Description, Reference).", needsAccount: true },
  quickbooks: { label: "QuickBooks 3-column CSV", extension: "csv", contentType: "text/csv; charset=utf-8", description: "One bank account's lines as Date, Description, Amount.", needsAccount: true },
  journal: { label: "Double-entry journal CSV", extension: "csv", contentType: "text/csv; charset=utf-8", description: "Two balanced lines per entry (debit and credit) with your ledger codes, for any accounting package.", needsAccount: false },
};

export const isAccountingFormat = (value: string): value is AccountingFormat => (ACCOUNTING_FORMATS as readonly string[]).includes(value);

export type ExportRow = {
  id: string;
  date: string;
  kind: "INCOME" | "EXPENSE";
  amountMinor: number;
  currency: string;
  description: string;
  counterparty: string | null;
  reference: string | null;
  categoryName: string | null;
  categoryCode: string | null;
  accountName: string | null;
  accountCode: string | null;
  /** Set when the entry has no bank account and the caller named a ledger for journal vouchers. */
  journal: boolean;
};

export type UnmappedEntry = { id: string; date: string; description: string; amountMinor: number; kind: "INCOME" | "EXPENSE"; reason: string };

export const HELP_NOTE = "Verify against your accounting software's current import documentation before importing. Import a small sample first.";
