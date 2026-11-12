import { describe, expect, it } from "vitest";
import { bankMappingSchema, guessMapping, parseBankCsv, type BankMapping } from "@/lib/finance/bank/csv";
import { fileHash, lineHashes, statementBalances } from "@/lib/finance/bank/hash";
import { parseOfx } from "@/lib/finance/bank/ofx";
import { cleanBankText, parseBankAmount, parseBankDate } from "@/lib/finance/bank/parse";

const single: BankMapping = { date: 0, description: 1, amount: 2, debit: null, credit: null, balance: 3, reference: 4, dateOrder: "dmy", hasHeader: true };

describe("bank dates", () => {
  it("reads ISO, DD/MM/YYYY, DD-MMM-YYYY and friends", () => {
    expect(parseBankDate("2026-10-14")).toBe("2026-10-14");
    expect(parseBankDate("14/10/2026")).toBe("2026-10-14");
    expect(parseBankDate("14-10-26")).toBe("2026-10-14");
    expect(parseBankDate("14-Oct-2026")).toBe("2026-10-14");
    expect(parseBankDate("1 September 2026")).toBe("2026-09-01");
    expect(parseBankDate("03/04/2026")).toBe("2026-04-03");
    expect(parseBankDate("03/04/2026", "mdy")).toBe("2026-03-04");
  });
  it("rejects impossible or unrecognised dates", () => {
    expect(parseBankDate("31/02/2026")).toBeNull();
    expect(parseBankDate("14-Foo-2026")).toBeNull();
    expect(parseBankDate("yesterday")).toBeNull();
    expect(parseBankDate("")).toBeNull();
  });
});

describe("bank amounts", () => {
  it("handles Indian grouping, signs, brackets, Dr/Cr and prefixes", () => {
    expect(parseBankAmount("1,00,000.50")).toBe(10_000_050);
    expect(parseBankAmount("-1,250.5")).toBe(-125_050);
    expect(parseBankAmount("(500.00)")).toBe(-50_000);
    expect(parseBankAmount("500.00 Dr")).toBe(-50_000);
    expect(parseBankAmount("500 CR")).toBe(50_000);
    expect(parseBankAmount("₹ 2,500")).toBe(250_000);
    expect(parseBankAmount("Rs. 99.99")).toBe(9_999);
    expect(parseBankAmount("250-")).toBe(-25_000);
    expect(parseBankAmount("+75.00")).toBe(7_500);
  });
  it("rejects text, too many decimals and absurd sizes", () => {
    expect(parseBankAmount("abc")).toBeNull();
    expect(parseBankAmount("1.234")).toBeNull();
    expect(parseBankAmount("99999999999")).toBeNull();
    expect(parseBankAmount("")).toBeNull();
  });
});

describe("text clean-up", () => {
  it("defuses formulas, strips control characters and caps length", () => {
    expect(cleanBankText("=HYPERLINK(\"x\")", 50)).toBe("'=HYPERLINK(\"x\")");
    expect(cleanBankText("  @SUM(A1)", 50)).toBe("'@SUM(A1)");
    expect(cleanBankText("a\u0000b\tc\nd", 50)).toBe("a b c d");
    expect(cleanBankText("-12.50", 50)).toBe("-12.50");
    expect(cleanBankText("x".repeat(300), 200)).toHaveLength(200);
  });
});

describe("bank CSV", () => {
  it("parses a single-amount file with balances and references", () => {
    const csv = 'Date,Narration,Amount,Balance,Ref\n14/10/2026,UPI/Rent,"-8,000.00","41,000.00",R1\n';
    expect(parseBankCsv(csv, single, "INR")).toMatchObject({
      ok: true,
      problems: [],
      lines: [{ row: 2, postedOn: "2026-10-14", description: "UPI/Rent", amountMinor: -800_000, balanceMinor: 4_100_000, reference: "R1" }],
    });
  });
  it("parses debit and credit columns and flags a line with both", () => {
    const mapping: BankMapping = { ...single, amount: null, debit: 2, credit: 3, balance: null, reference: null };
    const csv = "Date,Desc,Debit,Credit\n01-Oct-2026,Fee,10.00,\n02-Oct-2026,Donation,,2000\n03-Oct-2026,Both,1,1\n";
    const result = parseBankCsv(csv, mapping, "INR");
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.lines.map((l) => l.amountMinor)).toEqual([-1000, 200_000]);
    expect(result.problems).toEqual([{ row: 4, message: "a line has both a debit and a credit" }]);
  });
  it("reports row problems without dropping the good rows and neutralises formulas", () => {
    const csv = "Date,Desc,Amount\nnope,Bad date,1\n05/10/2026,=cmd|' /C calc'!A0,5\n";
    const result = parseBankCsv(csv, { ...single, balance: null, reference: null }, "INR");
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.problems).toHaveLength(1);
    expect(result.lines[0]!.description.startsWith("'=")).toBe(true);
  });
  it("enforces the byte and line limits and the mapping rules", () => {
    const rows = Array.from({ length: 5001 }, () => "01/01/2026,x,1").join("\n");
    expect(parseBankCsv(`Date,D,A\n${rows}`, { ...single, balance: null, reference: null }, "INR")).toMatchObject({ ok: false });
    expect(parseBankCsv("a".repeat(1024 * 1024 + 1), single, "INR")).toMatchObject({ ok: false });
    expect(bankMappingSchema.safeParse({ date: 0, description: 1 }).success).toBe(false);
    expect(bankMappingSchema.safeParse({ date: 0, description: 1, amount: 2, debit: 3 }).success).toBe(false);
  });
  it("guesses columns from a typical Indian bank header", () => {
    expect(guessMapping(["Txn Date", "Value Date", "Description", "Chq/Ref No", "Withdrawal Amt", "Deposit Amt", "Balance"])).toMatchObject({ date: 0, description: 2, reference: 3, debit: 4, credit: 5, balance: 6, amount: null });
  });
});

const OFX = `OFXHEADER:100
DATA:OFXSGML

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>INR
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261014120000<TRNAMT>-8000.00<FITID>A1<NAME>Landlord &amp; Co<MEMO>October rent</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261015<TRNAMT>2500.50<FITID>A2<NAME>Donor</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>bad<TRNAMT>-1<FITID>A3</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>41000.25<DTASOF>20261015</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe("OFX", () => {
  it("reads SGML statements, entities, FITIDs and the ledger balance", () => {
    const result = parseOfx(OFX, "INR");
    expect(result).toMatchObject({ ok: true, closingMinor: 4_100_025 });
    if (!result.ok) return;
    expect(result.lines).toMatchObject([
      { postedOn: "2026-10-14", amountMinor: -800_000, description: "Landlord & Co - October rent", fitId: "A1" },
      { postedOn: "2026-10-15", amountMinor: 250_050, description: "Donor", fitId: "A2" },
    ]);
    expect(result.problems).toEqual([{ row: 3, message: "the posted date is missing or invalid" }]);
  });
  it("refuses other currencies and non-OFX text", () => {
    expect(parseOfx(OFX, "USD")).toMatchObject({ ok: false });
    expect(parseOfx("date,amount\n1,2", "INR")).toMatchObject({ ok: false });
  });
});

describe("dedupe hashes", () => {
  const line = (over: Partial<Parameters<typeof lineHashes>[0][number]> = {}) => ({ row: 1, postedOn: "2026-10-14", description: "Tea", reference: null, amountMinor: -500, balanceMinor: null, fitId: null, ...over });
  it("keeps genuinely identical same-day lines apart but is stable across files", () => {
    const [a, b] = lineHashes([line(), line()]);
    expect(a).not.toBe(b);
    expect(lineHashes([line({ row: 9 })])[0]).toBe(a);
  });
  it("prefers the bank id and hashes the file text", () => {
    expect(lineHashes([line({ fitId: "X" })])[0]).toBe(lineHashes([line({ fitId: "X", description: "Changed" })])[0]);
    expect(fileHash("a")).not.toBe(fileHash("b"));
  });
  it("derives opening and closing balance for either sort order", () => {
    const rows = [line({ postedOn: "2026-10-01", amountMinor: 100, balanceMinor: 1100 }), line({ postedOn: "2026-10-02", amountMinor: -50, balanceMinor: 1050 })];
    expect(statementBalances(rows)).toEqual({ openingMinor: 1000, closingMinor: 1050 });
    expect(statementBalances([...rows].reverse())).toEqual({ openingMinor: 1000, closingMinor: 1050 });
  });
});
