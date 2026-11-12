const DAY_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (v: string | string[] | undefined) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? new Date(`${v}T00:00:00Z`) : null);

/** Report period from the query string: defaults to the last 90 days; `to` is inclusive. */
export function reportPeriod(from?: string | string[], to?: string | string[], now = new Date()) {
  const end = parse(to) ?? new Date(`${iso(now)}T00:00:00Z`);
  const start = parse(from) ?? new Date(end.getTime() - 90 * DAY_MS);
  const safeStart = start > end ? new Date(end.getTime() - 90 * DAY_MS) : start;
  return { from: safeStart, to: new Date(end.getTime() + DAY_MS), fromInput: iso(safeStart), toInput: iso(end) };
}
