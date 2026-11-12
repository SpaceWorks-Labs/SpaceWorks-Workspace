# Finance statements, donations in the ledger and FCRA

Routes below `/w/[workspaceSlug]/finance/statements`. Management statements only: your auditor's accounts are authoritative, and every screen, CSV and PDF says so.

## Statements (read-only, cash basis)

- Financial year comes from `Workspace.fiscalYearStartMonth` (default April). A year is named by the calendar year it starts in (`2026` is `2026-27`). Owners and admins change the start month on the statements page. Helpers live in `lib/finance/statements/fiscal.ts`.
- `lib/finance/statements/compute.ts` holds the pure maths; `load.ts` reads the ledger for one financial year and one currency (currencies are never combined). Void entries and `privatePayroll` entries are excluded.
- Receipts and Payments: opening cash by account (account opening balance plus earlier entries and transfers), receipts and payments by category, transfers, closing. Entries with no account appear on a "No account assigned" line so totals always reconcile. Accounts opened after the year end are left out.
- Income and Expenditure by category, with surplus or deficit. Transfers between accounts (`MoneyControlMovement`) affect account balances only, never income or expense.
- Fund statement: opening (all earlier ledger history), receipts, utilisation, closing per fund, plus restricted, unrestricted and total lines. Entries with no fund fall under "General (no fund)".
- Exports: `statements/export/[kind]?format=csv|pdf&year=&currency=` (kind: `receipts-payments`, `income-expenditure`, `funds`), and a `print` page. PDFs reuse `makeReportPdf`. Access is `canViewFinance`; settings and FCRA controls need `canManageFinance`.

## Donation to ledger

- `recordDonationInLedger` (`lib/funding/service/ledger-link.ts`) posts one INCOME entry with `sourceType` `FUNDING_DONATION` and `sourceId` the funding record id. It takes the finance lock, so retries and concurrent calls create exactly one entry, and then sets `FundingRecord.ledgerEntryId`. Fund, account and category are chosen at posting time (fund defaults to the gift's fund). Receipts and the gift itself are not edited, so issued receipts stay immutable.
- Possible duplicate: an existing non-void income entry with the same amount and currency within 3 days, from another source or the same donor. The call returns `{ status: "duplicate", matches }` and writes nothing until the caller repeats with `confirmDuplicate: true`.
- Voiding a donation (Funding `void` operation) voids its ledger entry in the same transaction.
- In-kind gifts never post to the ledger. "Create asset record" (`ledger-link-inkind.ts`) calls `saveAsset`, then stores the estimated value (`purchasePriceMinor`) and a note, and is idempotent through a `[funding:<id>]` marker in the asset notes.
- The donations page shows an In ledger or Not in ledger chip, a "Not yet in ledger" filter (`?ledger=pending`), a banner with bulk "Record selected", and the per-gift action in the editor.

## FCRA

- `FinanceFund.fcra` is toggled from the statements page (`setFundFcra`, `canManageFinance`).
- A gift with `foreignSource` can only post to an FCRA fund (`checkFcraFund` in `lib/finance/fcra.ts`, a hard block).
- `statements/fcra?year=&quarter=` downloads the quarterly receipts CSV (calendar quarters): date, donor, country (only when the gift's details hold one; none is stored today), mode, amount, currency, fund, receipt number, posted to ledger. PAN is never exported.

## Limits

- Statements are cash basis; there is no accrual, depreciation or balance sheet.
- Private payroll postings are excluded, so cash by account does not include payroll payments.
- The year start month applies to the whole workspace; changing it re-cuts every statement.

Tests: `tests/unit/finance-statements.test.ts`, `tests/integration/finance-statements.db.test.ts`.
