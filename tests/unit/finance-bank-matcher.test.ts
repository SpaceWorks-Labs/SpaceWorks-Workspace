import { describe, expect, it } from "vitest";
import { manualCandidates, suggestMatches, type MatchEntry, type MatchLine } from "@/lib/finance/bank/matcher";

const line = (id: string, postedOn: string, amountMinor: number, description = "", reference: string | null = null): MatchLine => ({ id, postedOn, amountMinor, description, reference });
const entry = (id: string, occurredOn: string, amountMinor: number, description = "", kind: MatchEntry["kind"] = "EXPENSE", extra: Partial<MatchEntry> = {}): MatchEntry => ({ id, occurredOn, kind, amountMinor, description, counterparty: null, invoiceNumber: null, ...extra });

describe("suggestMatches", () => {
  it("needs the exact signed amount and a date within three days", () => {
    const lines = [line("l1", "2026-10-10", -5000)];
    expect(suggestMatches(lines, [entry("e1", "2026-10-13", 5000)])).toHaveLength(1);
    expect(suggestMatches(lines, [entry("e1", "2026-10-14", 5000)])).toHaveLength(0);
    expect(suggestMatches(lines, [entry("e1", "2026-10-10", 5001)])).toHaveLength(0);
    expect(suggestMatches(lines, [entry("e1", "2026-10-10", 5000, "", "INCOME")])).toHaveLength(0);
  });
  it("ranks nearer dates and similar text higher", () => {
    const [same] = suggestMatches([line("l1", "2026-10-10", -5000, "UPI Paper Cooperative")], [entry("e1", "2026-10-10", 5000, "Paper cooperative")]);
    const [far] = suggestMatches([line("l1", "2026-10-10", -5000, "UPI Paper Cooperative")], [entry("e1", "2026-10-13", 5000, "Stationery")]);
    expect(same!.confidence).toBeGreaterThan(far!.confidence);
    expect(same!.reasons).toContain("description is similar");
  });
  it("boosts a matching invoice number found in the reference", () => {
    const [s] = suggestMatches([line("l1", "2026-10-10", 9000, "NEFT", "INV-2041")], [entry("e1", "2026-10-11", 9000, "Workshop", "INCOME", { invoiceNumber: "inv-2041" })]);
    expect(s!.confidence).toBeGreaterThanOrEqual(0.9);
  });
  it("is one-to-one: the better pair wins and the other line stays unmatched", () => {
    const lines = [line("l1", "2026-10-10", -5000, "Tea stall"), line("l2", "2026-10-12", -5000, "Chai")];
    const out = suggestMatches(lines, [entry("e1", "2026-10-10", 5000, "Tea stall")]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ lineId: "l1", entryId: "e1" });
  });
  it("is deterministic on ties", () => {
    const lines = [line("l2", "2026-10-10", -100), line("l1", "2026-10-10", -100)];
    const entries = [entry("e2", "2026-10-10", 100), entry("e1", "2026-10-10", 100)];
    const out = suggestMatches(lines, entries);
    expect(out.map((s) => `${s.lineId}:${s.entryId}`)).toEqual(["l1:e1", "l2:e2"]);
    expect(suggestMatches([...lines].reverse(), [...entries].reverse())).toEqual(out);
  });
});

describe("manualCandidates", () => {
  it("lists same-amount entries nearest first within the wider window", () => {
    const l = line("l1", "2026-10-10", 700);
    const list = manualCandidates(l, [entry("far", "2026-11-20", 700, "", "INCOME"), entry("near", "2026-10-12", 700, "", "INCOME"), entry("wrong", "2026-10-10", 701, "", "INCOME"), entry("out", "2026-12-30", 700, "", "INCOME")]);
    expect(list.map((e) => e.id)).toEqual(["near", "far"]);
  });
});
