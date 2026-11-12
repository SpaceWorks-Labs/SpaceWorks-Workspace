"use client";

import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";

import { useState, useTransition } from "react";
import Link from "next/link";
import { updateSeo } from "@/app/actions/seo";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { formatDate, formatDayTime } from "@/lib/format/datetime";
import type { summariseMetrics } from "@/lib/seo/metrics";
import type { AuditFinding } from "@/lib/seo/audit";

type Summary = ReturnType<typeof summariseMetrics>;
type Site = { id: string; siteUrl: string; lastSyncedAt: string | null };
type Audit = { id: string; url: string; status: string; score: number | null; at: string; findings: AuditFinding[] };
const number = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });
const value = (key: string, n: number) => key === "ctr" ? `${number.format(n * 100)}%` : number.format(n);
export function SeoDashboard({ slug, sites, selected, summary, audits, timeZone }: { slug: string; sites: Site[]; selected: string; summary: Summary; audits: Audit[]; timeZone: string }) {
  const [pending, start] = useTransition(); const [message, setMessage] = useState(""); const [output, setOutput] = useState("");
  const run = (operation: string, url?: string) => start(async () => {
    setMessage("Working"); setOutput("");
    const result = await updateSeo(slug, { operation, siteId: selected, url });
    setMessage(result.ok ? "SEO data updated." : result.error);
    if (result.ok && result.data?.output) setOutput(result.data.output);
  });
  const metricKeys = [["clicks", "Clicks"], ["impressions", "Impressions"], ["ctr", "Click-through rate"], ["position", "Average position"]] as const;
  const table = (title: string, rows: Summary["queries"]) => <section className="min-w-0 space-y-3"><h2 className="text-h2">{title}</h2>{rows.length ? <div className="overflow-x-auto rounded-xl border border-line bg-panel"><Table className="w-full text-left"><caption className="sr-only">{title} in the selected reporting period</caption><THead className="bg-surface"><TR>{[title === "Top queries" ? "Query" : "Page", ...metricKeys.map(([, label]) => label)].map(h => <TH scope="col" className="p-3 text-label" key={h}>{h}</TH>)}</TR></THead><TBody>{rows.map(r => <TR key={r.label} className="border-t border-line"><TH scope="row" className="max-w-72 break-words p-3 font-medium">{r.label}</TH>{metricKeys.map(([key]) => <TD className="p-3 tabular-nums" key={key}>{value(key, r[key])}</TD>)}</TR>)}</TBody></Table></div> : <p>No data for this period. Sync the site to check for new data.</p>}</section>;
  return <div className="min-w-0 space-y-8" aria-busy={pending}>
    <p role="status" aria-live="polite">{message}</p>
    <div className="flex flex-wrap gap-3"><Button variant="primary" disabled={pending} onClick={() => run("connect")}>Connect Search Console sites</Button><Link className="inline-flex min-h-11 items-center text-accent-text underline" href={`/w/${slug}/settings/integrations`}>Google connection settings</Link></div>
    {!sites.length ? <p>No sites yet. Connect Google, then connect your Search Console sites.</p> : <>
      <nav aria-label="Search Console sites" className="flex flex-wrap gap-3">{sites.map(s => <Link className="inline-flex min-h-11 max-w-full items-center break-all border-b-2 border-line px-2 text-accent-text aria-[current=page]:border-accent-text" aria-current={s.id === selected ? "page" : undefined} key={s.id} href={`/w/${slug}/seo?site=${encodeURIComponent(s.id)}`}>{s.siteUrl}</Link>)}</nav>
      <div className="flex flex-wrap items-center gap-3"><Button variant="secondary" disabled={pending} onClick={() => run("sync")}>Sync now</Button><p className="text-caption">Last sync: {sites.find(s => s.id === selected)?.lastSyncedAt ? formatDayTime(sites.find(s => s.id === selected)!.lastSyncedAt!, timeZone) : "Not synced yet"} · {timeZone}</p></div>
      <p className="text-ink-secondary">Last 30 days. Search Console data arrives several days late. Query and page totals can differ because Google omits some data.</p>
      <div className="grid gap-4 sm:grid-cols-2">{metricKeys.map(([key, label]) => {
        const points = summary.daily.map(r => r[key]); const maximum = Math.max(...points, 1);
        const path = points.map((n, i) => `${i * 300 / Math.max(1, points.length - 1)},${90 - n / maximum * 80}`).join(" ");
        return <section key={key} className="min-w-0 rounded-xl border border-line bg-panel p-5"><h2 className="text-label">{label}</h2><p className="text-h1 tabular-nums">{value(key, summary.totals[key])}</p>{points.length ? <svg viewBox="0 0 300 100" role="img" aria-label={`${label} trend. Daily values are in the table below.`} className="mt-3 w-full text-chart-accent"><polyline points={path} fill="none" stroke="currentColor" strokeWidth="2" />{points.length === 1 ? <circle cx="0" cy={90 - points[0]! / maximum * 80} r="3" fill="currentColor" /> : null}</svg> : <p className="mt-3 text-caption">No performance data yet.</p>}</section>;
      })}</div>
      {summary.daily.length ? <details className="rounded-xl border border-line bg-panel p-4"><summary className="min-h-11 cursor-pointer text-label">Daily performance values</summary><div className="overflow-x-auto"><Table className="w-full text-left"><caption className="sr-only">Daily search performance, Google reporting dates</caption><THead><TR>{["Date", ...metricKeys.map(([, label]) => label)].map(h => <TH scope="col" className="p-3" key={h}>{h}</TH>)}</TR></THead><TBody>{summary.daily.map(r => <TR key={r.date} className="border-t border-line"><TH scope="row" className="whitespace-nowrap p-3">{formatDate(r.date, "UTC")}</TH>{metricKeys.map(([key]) => <TD key={key} className="p-3 tabular-nums">{value(key, r[key])}</TD>)}</TR>)}</TBody></Table></div></details> : null}
      {table("Top queries", summary.queries)}{table("Top pages", summary.pages)}
      <section className="space-y-4 rounded-xl border border-line bg-panel p-5"><h2 className="text-h2">Page checks and sitemaps</h2><form className="space-y-4" onSubmit={event => { event.preventDefault(); const fd = new FormData(event.currentTarget); const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null; run(submitter?.value ?? "audit", String(fd.get("url"))); }}><Field label="Page or sitemap URL"><Input type="url" name="url" required maxLength={2048} /></Field><div className="flex flex-wrap gap-3"><Button type="submit" variant="primary" name="operation" value="audit" disabled={pending}>Audit page</Button><Button type="submit" name="operation" value="inspect" variant="secondary" disabled={pending}>Inspect URL</Button><Button type="submit" name="operation" value="submitSitemap" variant="secondary" disabled={pending}>Submit sitemap</Button></div></form><Button variant="secondary" disabled={pending} onClick={() => run("sitemaps")}>List sitemaps</Button>{output ? <pre tabIndex={0} className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface p-4 text-caption">{output}</pre> : null}</section>
      <section className="space-y-3"><h2 className="text-h2">Recent page audits</h2>{audits.length ? audits.map(a => <details className="rounded-xl border border-line bg-panel p-4" key={a.id}><summary className="min-h-11 cursor-pointer break-all"><span className="font-semibold">{a.score === null ? a.status : `${a.score}/100`}</span> · {a.url}<span className="block text-caption">{formatDayTime(a.at, timeZone)}</span></summary><ul className="space-y-2">{a.findings.map(f => <li key={f.check}><strong>{f.passed ? "Passed" : "Needs attention"}:</strong> {f.message}</li>)}</ul></details>) : <p>No page audits yet. Audit a page above.</p>}</section>
    </>}
  </div>;
}
