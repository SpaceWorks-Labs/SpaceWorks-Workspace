import { EmptyState, Chip } from "@/components/ui/display";
import { ChartDataTable } from "./ChartDataTable";
import type { ChartKind, Point, Unit } from "@/lib/analytics/types";
import { displayValue } from "@/lib/analytics/metrics";
export function Chart({
  title,
  points,
  kind = "bar",
  unit = "count",
  currency = "INR",
  href,
  compact = false,
  basisUnit = "count",
  dimension = "group",
  openTable = false,
}: {
  title: string;
  points: Point[];
  kind?: ChartKind;
  unit?: Unit;
  currency?: string;
  href: string;
  compact?: boolean;
  basisUnit?: Unit;
  dimension?: "group" | "bucket";
  openTable?: boolean;
}) {
  const data = points,
    display = data.slice(0, 40),
    width = 640,
    height = compact ? 64 : kind === "funnel" ? Math.max(200, 24 + display.length * 28) : 200,
    pad = 12,
    max = Math.max(
      unit === "percent" ? 100 : 1,
      ...display.map((p) => p.value),
    ),
    min = Math.min(0, ...display.map((p) => p.value)),
    x = (i: number) =>
      pad + (i * (width - pad * 2)) / Math.max(1, display.length - 1),
    y = (v: number) =>
      height - pad - (height - pad * 2) * ((v - min) / (max - min)),
    fmt = (v: number) => displayValue(v, unit, currency);
  const summary = display.length
    ? `${title}. ${data.length} groups. ${display.map((p) => `${p.label}: ${fmt(p.value)}`).join(". ")}.`
    : `${title}. No matching records.`;
  const line = display
    .map((p, i) => `${i ? "L" : "M"} ${x(i)} ${y(p.value)}`)
    .join(" ");
  const radial = kind === "donut",
    total = display.reduce((s, p) => s + Math.max(0, p.value), 0);
  const seriesFills = ["bg-accent-text", "bg-info-solid", "bg-success-solid", "bg-warning-solid"];
  let offset = 0;
  return (
    <figure className="min-w-0" aria-label={title}>
      {display.length ? (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={summary}
          className="w-full overflow-visible"
        >
          <title>{title}</title>
          <desc>{summary}</desc>
          <line
            x1={pad}
            y1={y(0)}
            x2={width - pad}
            y2={y(0)}
            className="stroke-line"
          />
          {kind === "line" || kind === "sparkline" ? (
            <>
              <path
                d={line}
                className="stroke-accent-text"
                strokeWidth={compact ? 3 : 2}
                fill="none"
              />
              {display.map((p, i) => (
                <g key={p.label}>
                  <circle
                    cx={x(i)}
                    cy={y(p.value)}
                    r={compact ? 5 : 7}
                    className="fill-accent-text stroke-panel"
                    strokeWidth="2"
                  >
                    <title>{`${p.label}: ${fmt(p.value)}`}</title>
                  </circle>
                </g>
              ))}
            </>
          ) : radial ? (
            display.map((p, i) => {
              const length =
                  total > 0 ? (Math.max(0, p.value) / total) * 100 : 0,
                at = offset;
              offset += length;
              return (
                <g key={p.label}>
                  <circle
                    cx={width / 2}
                    cy={height / 2}
                    r="68"
                    fill="none"
                    strokeWidth="24"
                    pathLength="100"
                    strokeDasharray={`${length} ${100 - length}`}
                    strokeDashoffset={-at}
                    transform={`rotate(-90 ${width / 2} ${height / 2})`}
                    className={
                      [
                        "stroke-accent-text",
                        "stroke-info-solid",
                        "stroke-success-solid",
                        "stroke-warning-solid",
                      ][i % 4]
                    }
                  >
                    <title>{`${p.label}: ${fmt(p.value)}`}</title>
                  </circle>
                </g>
              );
            })
          ) : kind === "funnel" ? (
            display.map((p, i) => {
              const row = (height - pad * 2) / display.length,
                w = ((width - 200) * Math.max(0, p.value)) / max;
              return (
                <g key={p.label}>
                  <text
                    x={pad}
                    y={pad + i * row + row * 0.65}
                    className="fill-ink text-body-ui"
                  >
                    {p.label.slice(0, 24)}
                  </text>
                  <rect
                    x={180}
                    y={pad + i * row}
                    width={Math.max(2, w)}
                    height={Math.max(2, row - 5)}
                    rx="3"
                    className="fill-accent-text"
                  >
                    <title>{`${p.label}: ${fmt(p.value)}`}</title>
                  </rect>
                </g>
              );
            })
          ) : kind === "calendar" ? (
            display.map((p, i) => (
              <g key={p.label}>
                <rect
                  x={pad + (i % 14) * 44}
                  y={pad + Math.floor(i / 14) * 50}
                  width="38"
                  height="38"
                  rx="5"
                  className={
                    p.value >= 90
                      ? "fill-success-solid"
                      : p.value >= 50
                        ? "fill-warning-solid"
                        : "fill-danger-solid"
                  }
                >
                  <title>{`${p.label}: ${fmt(p.value)}`}</title>
                </rect>
              </g>
            ))
          ) : (
            display.map((p, i) => {
              const bar = (width - pad * 2) / display.length,
                bh = Math.max(2, Math.abs(y(p.value) - y(0)));
              return (
                <g key={p.label}>
                  {kind === "stacked" ? (
                    <rect
                      x={pad + i * bar}
                      y={pad}
                      width={Math.max(2, bar - 4)}
                      height={height - pad * 2}
                      rx="3"
                      className="fill-track"
                    />
                  ) : null}
                  <rect
                    x={pad + i * bar}
                    y={Math.min(y(0), y(p.value))}
                    width={Math.max(2, bar - 4)}
                    height={bh}
                    rx="3"
                    className={
                      p.value < 0 ? "fill-danger-solid" : "fill-accent-text"
                    }
                  >
                    <title>{`${p.label}: ${fmt(p.value)}`}</title>
                  </rect>
                </g>
              );
            })
          )}
        </svg>
      ) : (
        <EmptyState
          className="border-0 px-0"
          title="No matching records."
          action={
            <a className="inline-flex min-h-11 min-w-11 items-center text-accent-text underline" href={href}>
              Review source records
            </a>
          }
        />
      )}
      {radial && display.length ? (
        <figcaption className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-body-sm">
          {display.map((p, i) => (
            <span key={p.label} className="inline-flex items-center gap-2">
              <span aria-hidden className={`size-3 shrink-0 rounded-full ${seriesFills[i % 4]}`} />
              {p.label}: {fmt(p.value)}
            </span>
          ))}
        </figcaption>
      ) : null}
      {kind === "calendar" && display.length ? (
        <figcaption className="mt-3 flex flex-wrap gap-2 text-body-sm">
          <Chip tone="success">High: {fmt(90)} or more</Chip>
          <Chip tone="warning">Medium: {fmt(50)} to below {fmt(90)}</Chip>
          <Chip tone="danger">Low: below {fmt(50)}</Chip>
        </figcaption>
      ) : null}
      <ChartDataTable
        title={title}
        data={data}
        kind={kind}
        unit={unit}
        currency={currency}
        href={href}
        basisUnit={basisUnit}
        dimension={dimension}
        openTable={openTable}
      />
    </figure>
  );
}
