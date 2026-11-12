import { describe, expect, it } from "vitest";
import { fiscalYearOf, fiscalYearRange, recentFiscalYears } from "@/lib/finance/statements/fiscal";
import { fundStatement, incomeAndExpenditure, receiptsAndPayments, type StmtEntry } from "@/lib/finance/statements/compute";
import { calendarQuarter } from "@/lib/finance/fcra";

describe("fiscal year boundaries", () => {
  it("runs April to March by default", () => {
    expect(fiscalYearRange(4, 2026)).toMatchObject({ from: "2026-04-01", to: "2027-03-31", label: "2026-27" });
    expect(fiscalYearOf("2027-03-31", 4)).toBe(2026);
    expect(fiscalYearOf("2027-04-01", 4)).toBe(2027);
    expect(fiscalYearOf("2026-01-01", 4)).toBe(2025);
  });
  it("supports calendar years and other start months, including leap years", () => {
    expect(fiscalYearRange(1, 2026)).toMatchObject({ from: "2026-01-01", to: "2026-12-31", label: "2026" });
    expect(fiscalYearRange(10, 2027)).toMatchObject({ from: "2027-10-01", to: "2028-09-30" });
    expect(fiscalYearRange(3, 2027).to).toBe("2028-02-29");
    expect(fiscalYearRange(99, 2026).from).toBe("2026-04-01");
  });
  it("lists recent years newest first", () => {
    expect(recentFiscalYears("2026-11-12", 4, 3).map((y) => y.year)).toEqual([2026, 2025, 2024]);
  });
  it("uses calendar quarters for FCRA", () => {
    const q = calendarQuarter(2026, 4);
    expect([q.from.toISOString().slice(0, 10), q.to.toISOString().slice(0, 10)]).toEqual(["2026-10-01", "2026-12-31"]);
    expect(calendarQuarter(2026, 9).quarter).toBe(4);
  });
});

const e = (kind: "INCOME" | "EXPENSE", amountMinor: number, on: string, extra: Partial<StmtEntry> = {}): StmtEntry => ({ kind, amountMinor, on, categoryName: null, fundId: null, accountId: null, ...extra });
const range = { from: "2026-04-01", to: "2027-03-31" };

describe("statement maths", () => {
  const accounts = [{ id: "a1", name: "Bank", openingMinor: 100000, openingOn: "2025-04-01" }, { id: "a2", name: "Cash", openingMinor: 5000, openingOn: "2025-04-01" }];
  const entries = [
    e("INCOME", 50000, "2026-01-10", { accountId: "a1", categoryName: "Donations" }),
    e("EXPENSE", 20000, "2026-02-10", { accountId: "a1", categoryName: "Rent" }),
    e("INCOME", 300000, "2026-04-01", { accountId: "a1", categoryName: "Donations" }),
    e("INCOME", 10000, "2026-09-01", { accountId: "a2", categoryName: "Fees" }),
    e("EXPENSE", 70000, "2027-03-31", { accountId: "a1", categoryName: "Rent" }),
    e("EXPENSE", 1000, "2027-04-01", { accountId: "a1", categoryName: "Rent" }),
    e("EXPENSE", 500, "2026-06-01"),
  ];
  const moves = [{ accountId: "a1", amountMinor: -40000, on: "2026-05-01" }, { accountId: "a2", amountMinor: 40000, on: "2026-05-01" }];

  it("reconciles opening, flows, transfers and closing", () => {
    const rp = receiptsAndPayments(entries, accounts, moves, range);
    const bank = rp.cash.find((c) => c.accountId === "a1")!;
    expect(bank.openingMinor).toBe(130000);
    expect(bank.closingMinor).toBe(130000 + 300000 - 70000 - 40000);
    expect(rp.receiptsMinor).toBe(310000);
    expect(rp.paymentsMinor).toBe(70500);
    expect(rp.transfersMinor).toBe(0);
    expect(rp.openingMinor + rp.receiptsMinor - rp.paymentsMinor + rp.transfersMinor).toBe(rp.closingMinor);
    expect(rp.cash.find((c) => c.accountId === null)!.closingMinor).toBe(-500);
    expect(rp.payments.map((h) => h.name)).toEqual(["Rent", "Uncategorised"]);
  });
  it("keeps transfers out of income and expenditure", () => {
    const ie = incomeAndExpenditure(entries, range);
    expect(ie.incomeMinor).toBe(310000);
    expect(ie.expenditureMinor).toBe(70500);
    expect(ie.surplusMinor).toBe(239500);
  });
  it("omits accounts opened after the year ends", () => {
    const rp = receiptsAndPayments([], [...accounts, { id: "a3", name: "Future", openingMinor: 9, openingOn: "2027-04-01" }], [], range);
    expect(rp.cash.some((c) => c.accountId === "a3")).toBe(false);
  });
  it("builds a fund statement split by restriction", () => {
    const funds = [{ id: "f1", name: "Grant", restricted: true, fcra: true }, { id: "f2", name: "Core", restricted: false, fcra: false }];
    const rows = [e("INCOME", 100000, "2026-01-01", { fundId: "f1" }), e("INCOME", 50000, "2026-05-01", { fundId: "f1" }), e("EXPENSE", 30000, "2026-06-01", { fundId: "f1" }), e("INCOME", 7000, "2026-07-01", { fundId: "f2" }), e("EXPENSE", 1000, "2026-07-02")];
    const s = fundStatement(rows, funds, range);
    const grant = s.lines.find((l) => l.fundId === "f1")!;
    expect([grant.openingMinor, grant.receiptsMinor, grant.utilisedMinor, grant.closingMinor]).toEqual([100000, 50000, 30000, 120000]);
    expect(s.restricted.closingMinor).toBe(120000);
    expect(s.unrestricted.closingMinor).toBe(6000);
    expect(s.total.closingMinor).toBe(s.restricted.closingMinor + s.unrestricted.closingMinor);
  });
});
