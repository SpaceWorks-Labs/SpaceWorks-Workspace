/** Financial-year helpers (pure, client-safe). A year is named by the calendar year in which it starts. */

export type FiscalRange = { year: number; from: string; to: string; label: string };

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function normaliseStartMonth(value: number | null | undefined): number {
  return Number.isInteger(value) && value! >= 1 && value! <= 12 ? value! : 4;
}

/** Inclusive YYYY-MM-DD bounds of the financial year that starts in `year`. */
export function fiscalYearRange(startMonth: number, year: number): FiscalRange {
  const m = normaliseStartMonth(startMonth);
  const from = Date.UTC(year, m - 1, 1);
  const to = Date.UTC(year + 1, m - 1, 0);
  const label = m === 1 ? `${year}` : `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
  return { year, from: iso(from), to: iso(to), label };
}

/** The financial year (by start year) that contains a YYYY-MM-DD date. */
export function fiscalYearOf(date: string, startMonth: number): number {
  const [y, mo] = date.split("-").map(Number) as [number, number];
  return mo >= normaliseStartMonth(startMonth) ? y : y - 1;
}

/** The last `count` financial years ending with the one that contains `today`, newest first. */
export function recentFiscalYears(today: string, startMonth: number, count = 6): FiscalRange[] {
  const current = fiscalYearOf(today, startMonth);
  return Array.from({ length: count }, (_, i) => fiscalYearRange(startMonth, current - i));
}

export const STATEMENT_DISCLAIMER =
  "Management statements on a cash basis from your ledger. Your auditor's accounts are authoritative.";
