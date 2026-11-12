/**
 * Chart series colours (Design System 0.12.0 `chart` tokens, docs/DESIGN.md §2.5):
 * accent, info, success, warn, danger. Light uses the darker ink shades, dark the
 * brighter fills, so marks stay readable on both panels. Charts only.
 */
export const CHART_SERIES = [
  { fill: "fill-chart-accent", stroke: "stroke-chart-accent", bg: "bg-chart-accent" },
  { fill: "fill-chart-info", stroke: "stroke-chart-info", bg: "bg-chart-info" },
  { fill: "fill-chart-success", stroke: "stroke-chart-success", bg: "bg-chart-success" },
  { fill: "fill-chart-warn", stroke: "stroke-chart-warn", bg: "bg-chart-warn" },
  { fill: "fill-chart-danger", stroke: "stroke-chart-danger", bg: "bg-chart-danger" },
] as const;

/**
 * A series keeps its colour when the data is sorted or filtered: the colour
 * comes from a hash of the series identity (its label), not its position.
 */
export function chartSeries(identity: string) {
  let hash = 0;
  for (const char of identity) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return CHART_SERIES[hash % CHART_SERIES.length];
}
