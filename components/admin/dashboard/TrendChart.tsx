import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDayShort } from "@/lib/format/datetime";
import type { SeriesPoint } from "@/lib/admin/dashboard/types";

/** Buckets are UTC days (the dashboard bins on UTC midnight). */
export function bucketLabel(start: string, bucketDays: number): string {
  const day = formatDayShort(`${start}T00:00:00Z`, "UTC");
  return bucketDays > 1 ? `Week of ${day}` : day;
}

/**
 * Small bar chart in the analytics chart style (accent bars on a hairline
 * baseline, `role="img"` with a spoken summary) plus a data table fallback.
 */
export function TrendChart({ title, points, bucketDays }: { title: string; points: SeriesPoint[]; bucketDays: number }) {
  const width = 640;
  const height = 120;
  const pad = 4;
  const max = Math.max(1, ...points.map((p) => p.value));
  const total = points.reduce((sum, p) => sum + p.value, 0);
  const bar = (width - pad * 2) / Math.max(1, points.length);
  const peak = points.reduce<SeriesPoint | null>((best, p) => (!best || p.value > best.value ? p : best), null);
  const summary = points.length
    ? `${title}: ${total} in total over ${points.length} ${bucketDays > 1 ? "weeks" : "days"}${peak && peak.value > 0 ? `, highest ${peak.value} on ${bucketLabel(peak.start, bucketDays)}` : ""}.`
    : `${title}: no data.`;
  return (
    <figure className="min-w-0" aria-label={title}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={summary} className="h-28 w-full" preserveAspectRatio="none">
        <title>{title}</title>
        <desc>{summary}</desc>
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} className="stroke-line" vectorEffect="non-scaling-stroke" />
        {points.map((p, i) => {
          const h = p.value > 0 ? Math.max(2, ((height - pad * 2) * p.value) / max) : 0;
          return (
            <rect key={p.start} x={pad + i * bar + 1} y={height - pad - h} width={Math.max(1, bar - 2)} height={h} rx="2" className="fill-chart-accent">
              <title>{`${bucketLabel(p.start, bucketDays)}: ${p.value}`}</title>
            </rect>
          );
        })}
      </svg>
      {points.length ? (
        <figcaption className="mt-1 flex justify-between gap-2 text-caption text-ink-muted">
          <span>{bucketLabel(points[0].start, bucketDays)}</span>
          <span>{bucketLabel(points[points.length - 1].start, bucketDays)}</span>
        </figcaption>
      ) : null}
      <details className="mt-2">
        <summary className="min-h-11 cursor-pointer py-3 text-body-ui text-accent-text">View chart data</summary>
        <Table label={`${title} data`}>
          <caption className="sr-only">{title} data</caption>
          <THead>
            <TR><TH scope="col">{bucketDays > 1 ? "Week" : "Day"}</TH><TH scope="col">Count</TH></TR>
          </THead>
          <TBody>
            {points.map((p) => (
              <TR key={p.start}>
                <TH scope="row" className="font-normal text-ink">{bucketLabel(p.start, bucketDays)}</TH>
                <TD className="tabular-nums">{p.value}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </details>
    </figure>
  );
}
