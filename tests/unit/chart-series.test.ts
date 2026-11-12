import { describe, expect, it } from "vitest";
import { CHART_SERIES, chartSeries } from "@/components/ui/chart-series";

describe("chart series", () => {
  it("follows the Design System order: accent, info, success, warn, danger", () => {
    expect(CHART_SERIES.map((s) => s.fill)).toEqual(["fill-chart-accent", "fill-chart-info", "fill-chart-success", "fill-chart-warn", "fill-chart-danger"]);
  });
  it("keeps a series colour when the data is sorted or filtered", () => {
    const labels = ["Tools", "Rent", "Snacks", "Travel", "Events", "Software"];
    const before = Object.fromEntries(labels.map((label) => [label, chartSeries(label)]));
    for (const label of [...labels].reverse().slice(2)) expect(chartSeries(label)).toBe(before[label]);
    expect(new Set(labels.map((label) => chartSeries(label).fill)).size).toBeGreaterThan(1);
  });
});
