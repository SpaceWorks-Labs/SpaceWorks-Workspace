/** Pure period maths for the downtime report (no database). */
export type Span = { from: Date; to: Date | null };

/** Hours of a downtime that fall inside [from, to); an open downtime runs until `now`. */
export function overlapHours(span: Span, from: Date, to: Date, now: Date): number {
  const start = Math.max(span.from.getTime(), from.getTime());
  const end = Math.min((span.to ?? now).getTime(), to.getTime());
  return end > start ? (end - start) / 3_600_000 : 0;
}

/** Out of service right now: started, and not yet ended. */
export function isDownAt(span: Span, now: Date): boolean {
  return span.from <= now && (span.to === null || span.to > now);
}
