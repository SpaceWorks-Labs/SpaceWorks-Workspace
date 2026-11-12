# Finance: bank statement import and accounting exports

Routes: `/w/[slug]/finance/bank` (import and matching) and `/w/[slug]/finance/export/accounting` (exports and ledger-code mapping), with downloads at `/w/[slug]/finance/export/accounting/[format]`. Viewing needs `canViewFinance`; every change needs `canManageFinance` (owners and admins). Services re-read membership through `financeAccess`, filter every query by `workspaceId`, and never trust a client id.

## Bank statement import

Code: `lib/finance/bank/` (pure parsers are client-safe; `service/` and `index.ts` are server-only), UI in `components/finance/bank/`, actions in `app/actions/finance-bank.ts`.

- **Formats:** CSV with a column-mapping step (date, description, one signed amount or separate debit and credit, optional balance and reference) and OFX/QFX (SGML and XML, read by tag scan; no XML parser, so no entity or DTD expansion).
- **Dates:** ISO, DD/MM/YYYY, DD-MM-YY, DD-MMM-YYYY, "1 September 2026". Numeric dates read day-first unless the user picks month-first.
- **Amounts:** Indian grouping (`1,00,000.50`), leading minus, brackets, trailing minus, Dr/Cr suffix, currency prefix. Stored signed in minor units, credits positive. Currency is always the account's; an OFX file in another currency is refused.
- **Limits:** 1 MB and 5,000 lines per file. Text is stripped of control characters, capped, and spreadsheet formulas get a leading apostrophe (same rule as `csvCell`).
- **Flow:** the browser parses the CSV header to guess columns, the server re-parses everything (`previewBankImport`), and `commitBankImport` writes only when no row has a problem.
- **De-duplication:** `fileHash` (SHA-256 of the file text) is unique per account, so the same file is refused. `lineHash` is unique per account: OFX uses the bank's FITID; CSV uses date, amount, description and reference plus an occurrence counter so two identical same-day lines both import while an overlapping later statement skips lines already held.
- **Balances:** statement opening and closing come from the balance column (any sort order) or the OFX ledger balance.

## Matching

`suggestMatches(lines, entries)` (`lib/finance/bank/matcher.ts`) is pure: exact signed amount, posted within three days, confidence from date gap, invoice number in the reference and description similarity, and strictly one-to-one (best pair first, deterministic ties). The page shows each unmatched line's suggestion, plus up to eight same-amount entries within 45 days for a manual pick. Payroll entries are never candidates.

Actions (all under `lockFinance`, in one transaction):

- **Match:** same account, same signed amount and currency, entry not void and not payroll, entry not already matched, and `assertOpen` (so a signed-off month or a date at or before the account's `reconciledUpTo` refuses). Sets `LedgerEntry.reconciledAt` if empty and `FinanceBankLine.status = MATCHED`.
- **Unmatch:** only inside an open period; clears `reconciledAt` only when it equals the line's `matchedAt`, so an entry reconciled by hand first stays reconciled.
- **Ignore / restore** a line with no counterpart.
- **Create entry from line:** calls the normal `addEntry` (locks, period checks, tag and fund rules) with the line's date, signed amount and account, then matches it. If the second step fails the entry exists unmatched and can be matched later.

Editing an entry's tags clears its `reconciledAt` (existing behaviour); the bank line stays MATCHED, so re-reconcile or unmatch and rematch.

## Accounting exports

Code: `lib/finance/accounting-export/` (`builders.ts` is pure; `query.ts` loads and classifies; `mapping.ts` saves codes), UI in `components/finance/AccountingExportPanel.tsx` and `AccountingMappingForm.tsx`, mapping action in `app/actions/finance-mapping.ts`.

| Format | Shape |
| --- | --- |
| `tally` | Voucher XML. Payment (expense: category debited, bank credited), Receipt (income: bank debited, category credited) and Journal (no bank account, against a ledger the user names). `VOUCHERNUMBER` and `GUID` are `SW-<entry id>`, so IDs are unique and re-imports do not duplicate. No company name is written, so Tally uses the open company. |
| `xero` | `*Date,*Amount,Payee,Description,Reference,Check Number`, signed amount, DD/MM/YYYY. One bank account per file. |
| `quickbooks` | `Date,Description,Amount`, signed, DD/MM/YYYY. One bank account per file. |
| `journal` | Two lines per entry (`Journal ID,Date,Ledger code,Ledger name,Debit,Credit,Narration,Currency`) that always balance. |

Ledger codes live in `FinanceCategory.externalCode` and `FinanceAccount.externalCode`, edited on the export page. Tally and journal exports need a code on the category and the account. Entries missing one (or with no category, or no account and no journal ledger) are listed as unmapped with the reason and left out; nothing is defaulted or guessed. The download answers 409 while unmapped entries exist unless `partial=1`, which the UI adds and labels "mapped entries only".

Route security matches `export/[kind]`: workspace and capability checked per request, `apiRead` rate limit, `finance.accounting_export_downloaded` audit event (format, rows, unmapped, range), `Cache-Control: private, no-store`, `nosniff`, formula neutralisation through `toCsv`, XML escaping with illegal characters dropped, a 20,000-row cap, and `privatePayroll` entries and voided entries excluded. Only workspace-currency entries are exported.

The UI says to verify each format against the accounting software's current import documentation and to import a small sample first; these layouts follow publicly documented templates and are not tested against the live products.

## Known limits

- GST/TDS splits are not exported; each entry is one balanced pair at its full amount.
- Money-control transfers and deposit movements are not exported.
- No automatic matching: every match is accepted or picked by a person.
- A bank line matches one entry of exactly the same amount; split or combined payments need an entry per line.
