/** Pure bank-line to ledger-entry matching (client-safe). Nothing here touches the database. */

export type MatchLine = { id: string; postedOn: string; amountMinor: number; description: string; reference: string | null };
export type MatchEntry = {
  id: string;
  occurredOn: string;
  kind: "INCOME" | "EXPENSE";
  amountMinor: number;
  description: string;
  counterparty: string | null;
  invoiceNumber: string | null;
};
export type MatchSuggestion = { lineId: string; entryId: string; confidence: number; reasons: string[] };

export const MATCH_WINDOW_DAYS = 3;

const signed = (entry: MatchEntry) => (entry.kind === "INCOME" ? entry.amountMinor : -entry.amountMinor);
const dayNumber = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
const STOP = new Set(["the", "and", "for", "to", "from", "by", "of", "upi", "neft", "imps", "rtgs", "txn", "payment", "transfer", "ref", "no"]);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !STOP.has(t)),
  );
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

type Scored = MatchSuggestion & { gap: number };

function score(line: MatchLine, entry: MatchEntry): Scored | null {
  if (signed(entry) !== line.amountMinor) return null;
  const gap = Math.abs(dayNumber(line.postedOn) - dayNumber(entry.occurredOn));
  if (gap > MATCH_WINDOW_DAYS) return null;
  const reasons = ["Same amount"];
  let confidence = 0.5 + (MATCH_WINDOW_DAYS - gap) * 0.05;
  reasons.push(gap === 0 ? "same day" : `${gap} day${gap === 1 ? "" : "s"} apart`);
  const lineText = `${line.description} ${line.reference ?? ""}`.toLowerCase();
  const code = (entry.invoiceNumber ?? "").trim().toLowerCase();
  if (code.length >= 3 && lineText.includes(code)) {
    confidence += 0.3;
    reasons.push("reference matches the invoice number");
  }
  const similar = overlap(tokens(lineText), tokens(`${entry.description} ${entry.counterparty ?? ""}`));
  if (similar > 0) {
    confidence += similar * 0.25;
    reasons.push("description is similar");
  }
  return { lineId: line.id, entryId: entry.id, confidence: Math.min(1, Math.round(confidence * 100) / 100), reasons, gap };
}

/**
 * Exact signed amount, posted within three days, ranked by closeness of date
 * and text. One-to-one: each line and each entry is used at most once, best
 * pairs first (ties go to the nearer date, then the lower id, so the result
 * is deterministic).
 */
export function suggestMatches(lines: ReadonlyArray<MatchLine>, entries: ReadonlyArray<MatchEntry>): MatchSuggestion[] {
  const pairs: Scored[] = [];
  for (const line of lines) for (const entry of entries) {
    const s = score(line, entry);
    if (s) pairs.push(s);
  }
  pairs.sort((a, b) => b.confidence - a.confidence || a.gap - b.gap || a.lineId.localeCompare(b.lineId) || a.entryId.localeCompare(b.entryId));
  const usedLines = new Set<string>();
  const usedEntries = new Set<string>();
  const out: MatchSuggestion[] = [];
  for (const pair of pairs) {
    if (usedLines.has(pair.lineId) || usedEntries.has(pair.entryId)) continue;
    usedLines.add(pair.lineId);
    usedEntries.add(pair.entryId);
    out.push({ lineId: pair.lineId, entryId: pair.entryId, confidence: pair.confidence, reasons: pair.reasons });
  }
  return out;
}

/** Same-amount entries within a wider window, nearest first, for the manual picker. */
export function manualCandidates(line: MatchLine, entries: ReadonlyArray<MatchEntry>, windowDays = 45, limit = 8): MatchEntry[] {
  return entries
    .filter((e) => signed(e) === line.amountMinor && Math.abs(dayNumber(line.postedOn) - dayNumber(e.occurredOn)) <= windowDays)
    .sort((a, b) => Math.abs(dayNumber(line.postedOn) - dayNumber(a.occurredOn)) - Math.abs(dayNumber(line.postedOn) - dayNumber(b.occurredOn)) || a.id.localeCompare(b.id))
    .slice(0, limit);
}

export const confidenceLabel = (value: number) => (value >= 0.8 ? "High" : value >= 0.65 ? "Medium" : "Low");
