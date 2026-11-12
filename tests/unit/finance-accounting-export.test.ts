import { describe, expect, it } from "vitest";
import { journalCsv, quickbooksCsv, tallyXml, xeroCsv, xml } from "@/lib/finance/accounting-export/builders";
import type { ExportRow } from "@/lib/finance/accounting-export/types";

const row = (over: Partial<ExportRow> = {}): ExportRow => ({
  id: "e1", date: "2026-10-14", kind: "EXPENSE", amountMinor: 800_050, currency: "INR", description: "October rent", counterparty: "Landlord & Sons", reference: "INV-1",
  categoryName: "Rent", categoryCode: "Rent Expense", accountName: "HDFC", accountCode: "HDFC Bank", journal: false, ...over,
});

describe("Tally XML", () => {
  it("writes a Payment voucher: category debited, bank credited", () => {
    const out = tallyXml([row()]);
    expect(out).toContain('<VOUCHER VCHTYPE="Payment" ACTION="Create"');
    expect(out).toContain("<DATE>20261014</DATE>");
    expect(out).toContain("<VOUCHERNUMBER>SW-e1</VOUCHERNUMBER>");
    expect(out).toContain("<NARRATION>October rent - Landlord &amp; Sons</NARRATION>");
    expect(out).toMatch(/<LEDGERNAME>Rent Expense<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>-8000.50<\/AMOUNT>/);
    expect(out).toMatch(/<LEDGERNAME>HDFC Bank<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>No<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>8000.50<\/AMOUNT>/);
  });
  it("writes Receipt and Journal vouchers", () => {
    const out = tallyXml([row({ id: "e2", kind: "INCOME", categoryCode: "Donations" }), row({ id: "e3", journal: true, accountName: null, accountCode: "Suspense" })]);
    expect(out).toContain('VCHTYPE="Receipt"');
    expect(out).toMatch(/<LEDGERNAME>HDFC Bank<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>Yes/);
    expect(out).toContain('VCHTYPE="Journal"');
  });
  it("gives every voucher a unique id and refuses duplicates", () => {
    const out = tallyXml([row({ id: "a" }), row({ id: "b" })]);
    expect(new Set(out.match(/<VOUCHERNUMBER>[^<]+/g)).size).toBe(2);
    expect(() => tallyXml([row(), row()])).toThrow();
  });
  it("escapes markup and removes characters XML forbids", () => {
    expect(xml('<a href="x">&\u0000\u0007</a>')).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
    expect(tallyXml([row({ description: "</NARRATION><X>" })])).not.toContain("<X>");
  });
});

describe("CSV exports", () => {
  it("Xero statement layout is signed, day-first and neutralised", () => {
    const out = xeroCsv([row({ counterparty: "=SUM(A1)" }), row({ id: "e2", kind: "INCOME", amountMinor: 250_000, counterparty: null, reference: null })]).split("\r\n");
    expect(out[0]).toBe("*Date,*Amount,Payee,Description,Reference,Check Number");
    expect(out[1]).toBe("14/10/2026,-8000.50,'=SUM(A1),October rent,INV-1,");
    expect(out[2]).toBe("14/10/2026,2500.00,,October rent,SW-e2,");
  });
  it("QuickBooks has exactly three columns", () => {
    const out = quickbooksCsv([row()]).split("\r\n");
    expect(out[0]).toBe("Date,Description,Amount");
    expect(out[1]).toBe('14/10/2026,October rent - Landlord & Sons,-8000.50');
  });
  it("the journal balances: debits equal credits for every voucher", () => {
    const out = journalCsv([row(), row({ id: "e2", kind: "INCOME", amountMinor: 123 })]).trim().split("\r\n").slice(1).map((l) => l.split(","));
    const debit = out.reduce((n, c) => n + Number(c[4] || 0), 0);
    const credit = out.reduce((n, c) => n + Number(c[5] || 0), 0);
    expect(debit).toBeCloseTo(credit, 2);
    expect(out[0]![2]).toBe("Rent Expense");
    expect(out[1]![2]).toBe("HDFC Bank");
    expect(out[2]![2]).toBe("HDFC Bank");
  });
});
