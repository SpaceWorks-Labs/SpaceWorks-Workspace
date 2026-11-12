import { DashboardForecast } from "./DashboardForecast";
import { change, dashboardSummary } from "./dashboardSummary";
import { Field, Input } from "@/components/ui/field";
import { Dropdown } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/display";
import { Chart } from "./Chart";
import {
  SavedReports,
  Adjustments,
  type AdjustmentRow,
} from "./Controls";
import { SECTION_LABELS, type ForecastResult } from "@/lib/analytics/types";
import {
  displayValue,
  queryString,
  displayDay,
} from "@/lib/analytics/metrics";
import type { DashboardData } from "@/lib/analytics/types";
export function Dashboard({
  data,
  slug,
  forecast,
  adjustments,
}: {
  data: DashboardData;
  slug: string;
  forecast: ForecastResult | null;
  adjustments: AdjustmentRow[];
}) {
  const { q, period, metrics, options } = data;
  const { currency, base, insights, burn, comparisonLink } = dashboardSummary(
    data,
    slug,
    forecast,
  );
  const fields: [
    "fund" | "centre" | "team" | "project" | "programme",
    string,
    { id: string; name: string }[],
  ][] = [
    ["fund", "Fund", options.funds],
    ["centre", "Cost centre", options.centres],
    ["team", "Team", options.teams],
    ["project", "Project", options.projects],
    ["programme", "Programme", options.programmes],
  ];
  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title="Reports and analytics"
        description="See what changed, open the evidence, and decide what needs attention."
      />
      <nav
        aria-label="Analytics sections"
        className="flex gap-4 overflow-x-auto border-b border-line"
      >
        {data.sections.map((section) => (
          <a
            key={section}
            className={`inline-flex min-h-11 shrink-0 items-center border-b-2 px-1 py-3 text-body-sm ${q.section === section ? "border-accent-text text-ink" : "border-transparent text-ink-muted"}`}
            aria-current={q.section === section ? "page" : undefined}
            href={`${base}?${queryString(q, { section, group: undefined, page: undefined })}`}
          >
            {SECTION_LABELS[section]}
          </a>
        ))}
        <a
          className="inline-flex min-h-11 shrink-0 items-center border-b-2 border-transparent px-1 py-3 text-body-sm text-ink-muted"
          href={`${base}/reports`}
        >
          Metabase reports
        </a>
      </nav>
      <Card padding="none" className="print:hidden">
        <form
          method="get"
          className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4"
        >
          <input type="hidden" name="section" value={q.section} />
          <Field label="Reporting period">
            <Dropdown name="period" defaultValue={q.period}>
              <option value="month">This month to date</option>
              <option value="last-month">Last month</option>
              <option value="quarter">Quarter to date</option>
              <option value="fy">Indian financial year to date (Apr–Mar)</option>
              <option value="custom">Custom dates</option>
            </Dropdown>
          </Field>
          <Field label="From · custom period">
            <Input name="from" type="date" defaultValue={period.from} />
          </Field>
          <Field label="To · custom period">
            <Input name="to" type="date" defaultValue={period.to} />
          </Field>
          <Field label="Currency">
            <Input
              name="currency"
              pattern="[A-Z]{3}"
              maxLength={3}
              defaultValue={currency}
              required
            />
          </Field>
          {fields
            .filter(([, , items]) => items.length)
            .map(([key, label, items]) => (
              <Field key={key} label={label}>
                <Dropdown name={key} defaultValue={q[key] ?? ""}>
                  <option value="">All</option>
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Dropdown>
              </Field>
            ))}
          <div className="flex items-end gap-3">
            <Button type="submit" variant="primary">Apply filters</Button>
            <a
              className="inline-flex min-h-11 min-w-11 items-center text-accent-text underline"
              href={`${base}?section=${q.section}`}
            >
              Reset
            </a>
          </div>
        </form>
      </Card>
      {q.section === "home" && data.presets.some((p) => p.pinned) ? (
        <section
          aria-label="Pinned reports"
          className="flex flex-wrap items-center gap-3"
        >
          <h2 className="text-label">Pinned reports</h2>
          {data.presets
            .filter((p) => p.pinned)
            .map((p) => (
              <a
                key={p.id}
                className="inline-flex min-h-11 max-w-full items-center break-words rounded-md border border-line bg-panel px-4 text-accent-text underline"
                href={`${base}?${queryString(p.query)}`}
              >
                {p.name}
              </a>
            ))}
        </section>
      ) : null}
      <p className="text-body-sm text-ink-muted">
        {displayDay(period.from)} to {displayDay(period.to)} · {data.timezone} ·{" "}
        {currency}. Comparisons use the preceding calendar period through the
        same elapsed day, and the same dates last year. Custom ranges use the
        preceding equal-length range. Area filters hide metrics without a
        matching dimension.
      </p>
      {insights.length ? (
        <Card as="section" aria-label="What needs attention">
          <h2 className="text-h3">What needs attention</h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {insights.map((i) => (
              <li key={i.text}>
                <a
                  className="block min-h-11 text-accent-text underline"
                  href={i.href}
                >
                  {i.text}
                </a>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {!metrics.some((m) => m.count) ? (
        <EmptyState
          patch
          title="No matching records yet. Start with the team’s source tools."
          action={
          <a
            href={`/w/${slug}/${q.section === "finance" ? "finance/ledger" : q.section === "funding" ? "funding/tracker" : q.section === "people" ? "members" : q.section === "operations" ? "helpdesk" : q.section === "marketing" ? "marketing" : "projects"}`}
            className="inline-flex min-h-11 min-w-11 items-center text-accent-text underline"
          >
            Open source records
          </a>
          }
        />
      ) : null}
      <div className="grid min-w-0 gap-5 md:grid-cols-2">
        {metrics.map((m) => (
          <Card
            as="section"
            key={m.id}
            className="break-inside-avoid"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h2 className="text-h3">{m.title}</h2>
              <a
                className="inline-flex min-h-11 min-w-11 items-center text-body-sm text-accent-text underline"
                href={m.csv}
              >
                Export CSV
              </a>
            </div>
            <a
              className="inline-flex min-h-11 min-w-11 items-center py-1 text-stat tabular-nums text-accent-text"
              href={m.drill}
            >
              {displayValue(m.value, m.unit, currency)}
            </a>
            <p className="text-caption text-ink-muted">
              {m.snapshot ? (
                "Current state at the selected end; historical comparisons unavailable."
              ) : (
                <>
                  <a
                    className="inline-flex min-h-11 min-w-11 items-center text-accent-text underline"
                    href={comparisonLink(m.id, "previous")}
                  >
                    Previous: {change(m.value, m.previous)}
                  </a>
                  {" · "}
                  <a
                    className="inline-flex min-h-11 min-w-11 items-center text-accent-text underline"
                    href={comparisonLink(m.id, "lastYear")}
                  >
                    Last year: {change(m.value, m.lastYear)}
                  </a>
                </>
              )}
            </p>
            <p className="my-3 text-body-sm text-ink-muted">{m.description}</p>
            {m.trend.length > 1 && !m.snapshot ? (
              <Chart
                title={`${m.title} trend`}
                points={m.trend}
                kind="sparkline"
                unit={m.unit}
                currency={currency}
                href={m.drill}
                dimension="bucket"
                compact
              />
            ) : null}
            <Chart
              title={m.title}
              points={m.groups}
              kind={m.chart}
              unit={m.id === "win-rate" ? "count" : m.unit}
              basisUnit={
                [
                  "budgets",
                  "campaigns",
                  "grant-utilisation",
                  "bom",
                  "bom-received",
                ].includes(m.id)
                  ? "money"
                  : "count"
              }
              currency={currency}
              href={m.drill}
            />
            <a
              className="mt-2 inline-flex min-h-11 min-w-11 items-center text-body-sm text-accent-text underline"
              href={m.drill}
            >
              Open {m.count} underlying records
            </a>
          </Card>
        ))}
      </div>
      {forecast ? (
        <DashboardForecast
          forecast={forecast}
          burn={burn}
          slug={slug}
          q={q}
          currency={currency}
        />
      ) : null}
      {data.admin && q.section === "finance" ? (
        <Adjustments slug={slug} currency={currency} rows={adjustments} />
      ) : null}
      <SavedReports
        slug={slug}
        q={q}
        presets={data.presets}
        admin={data.admin}
        viewerId={data.viewerId}
        admins={options.admins}
      />
    </div>
  );
}
