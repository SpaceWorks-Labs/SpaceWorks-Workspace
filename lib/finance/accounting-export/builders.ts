/** Pure exporters: rows in, file text out (client-safe, deterministic, no clock or database). */

import { toCsv } from "@/lib/finance/csv";
import { minorToDecimalString } from "@/lib/finance/money";
import type { ExportRow } from "./types";

export const voucherId = (row: ExportRow) => `SW-${row.id}`;
const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const signed = (row: ExportRow) => (row.kind === "INCOME" ? row.amountMinor : -row.amountMinor);

function assertUnique(rows: ReadonlyArray<ExportRow>) {
  if (new Set(rows.map((r) => r.id)).size !== rows.length) throw new Error("Duplicate entry ids in export.");
}

/** XML 1.0 text: drop characters XML forbids, then escape. */
export function xml(value: string): string {
   
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

/** Debit and credit ledger of an entry: money out debits the category, money in debits the bank account. */
function sides(row: ExportRow) {
  return row.kind === "EXPENSE" ? { debit: row.categoryCode!, credit: row.accountCode! } : { debit: row.accountCode!, credit: row.categoryCode! };
}

export function tallyXml(rows: ReadonlyArray<ExportRow>): string {
  assertUnique(rows);
  const vouchers = rows.map((row) => {
    const type = row.journal ? "Journal" : row.kind === "EXPENSE" ? "Payment" : "Receipt";
    const { debit, credit } = sides(row);
    const amount = minorToDecimalString(row.amountMinor, row.currency);
    const id = xml(voucherId(row));
    const narration = [row.description, row.counterparty].filter(Boolean).join(" - ");
    const entry = (ledger: string, debitSide: boolean) =>
      `     <ALLLEDGERENTRIES.LIST>\n      <LEDGERNAME>${xml(ledger)}</LEDGERNAME>\n      <ISDEEMEDPOSITIVE>${debitSide ? "Yes" : "No"}</ISDEEMEDPOSITIVE>\n      <AMOUNT>${debitSide ? "-" : ""}${amount}</AMOUNT>\n     </ALLLEDGERENTRIES.LIST>`;
    return [
      `    <TALLYMESSAGE xmlns:UDF="TallyUDF">`,
      `     <VOUCHER VCHTYPE="${type}" ACTION="Create" OBJVIEW="Accounting Voucher View">`,
      `      <DATE>${row.date.replaceAll("-", "")}</DATE>`,
      `      <GUID>${id}</GUID>`,
      `      <VOUCHERTYPENAME>${type}</VOUCHERTYPENAME>`,
      `      <VOUCHERNUMBER>${id}</VOUCHERNUMBER>`,
      `      <NARRATION>${xml(narration)}</NARRATION>`,
      ...(row.reference ? [`      <REFERENCE>${xml(row.reference)}</REFERENCE>`] : []),
      entry(debit, true),
      entry(credit, false),
      `     </VOUCHER>`,
      `    </TALLYMESSAGE>`,
    ].join("\n");
  });
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<ENVELOPE>`,
    ` <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>`,
    ` <BODY>`,
    `  <IMPORTDATA>`,
    `   <REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC>`,
    `   <REQUESTDATA>`,
    ...vouchers,
    `   </REQUESTDATA>`,
    `  </IMPORTDATA>`,
    ` </BODY>`,
    `</ENVELOPE>`,
    ``,
  ].join("\n");
}

/** Xero bank-statement style: *Date, *Amount, Payee, Description, Reference, Check Number. Amount is signed. */
export function xeroCsv(rows: ReadonlyArray<ExportRow>): string {
  assertUnique(rows);
  return toCsv([
    ["*Date", "*Amount", "Payee", "Description", "Reference", "Check Number"],
    ...rows.map((r) => [ddmmyyyy(r.date), minorToDecimalString(signed(r), r.currency), r.counterparty, r.description, r.reference ?? voucherId(r), ""]),
  ]);
}

/** QuickBooks three-column layout: Date, Description, Amount (negative = money out). */
export function quickbooksCsv(rows: ReadonlyArray<ExportRow>): string {
  assertUnique(rows);
  return toCsv([["Date", "Description", "Amount"], ...rows.map((r) => [ddmmyyyy(r.date), [r.description, r.counterparty].filter(Boolean).join(" - "), minorToDecimalString(signed(r), r.currency)])]);
}

/** Generic double entry: two lines per entry that always balance. */
export function journalCsv(rows: ReadonlyArray<ExportRow>): string {
  assertUnique(rows);
  const lines = rows.flatMap((r) => {
    const { debit, credit } = sides(r);
    const amount = minorToDecimalString(r.amountMinor, r.currency);
    const narration = [r.description, r.counterparty].filter(Boolean).join(" - ");
    const debitName = r.kind === "EXPENSE" ? r.categoryName : r.accountName;
    const creditName = r.kind === "EXPENSE" ? r.accountName : r.categoryName;
    return [
      [voucherId(r), r.date, debit, debitName, amount, "", narration, r.currency],
      [voucherId(r), r.date, credit, creditName, "", amount, narration, r.currency],
    ];
  });
  return toCsv([["Journal ID", "Date", "Ledger code", "Ledger name", "Debit", "Credit", "Narration", "Currency"], ...lines]);
}
