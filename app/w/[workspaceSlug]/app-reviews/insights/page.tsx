import Link from "next/link";
import { formatDate } from "@/lib/format/datetime";
import { requireWorkspace } from "@/lib/permissions";
import { canManageAppReviews } from "@/lib/roles";
import { reviewInsights } from "@/lib/appReviews/queries";
import { ReviewNav, platformLabel } from "@/components/appReviews/ReviewNav";
import { Card } from "@/components/ui/display";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { buttonClasses } from "@/components/ui/button";

export default async function AppReviewInsightsPage({ params }: PageProps<"/w/[workspaceSlug]/app-reviews/insights">) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug, "MEMBER");
  const data = await reviewInsights(ctx);
  if (!data) return null;
  const { summary: s, daily, distribution, volumes } = data;
  const manage = canManageAppReviews(ctx.membership);
  const dayLabel = (day: string) => formatDate(`${day}T00:00:00Z`, "UTC");
  const points = daily.map((d, i) => `${30 + (i * 540) / Math.max(1, daily.length - 1)},${180 - d.average * 30}`).join(" ");
  return <div className="min-w-0 space-y-5 [overflow-wrap:anywhere]"><ReviewNav slug={workspaceSlug} active="insights" manage={manage} />
    <p className="text-caption text-ink-muted">Last 90 days · {ctx.workspace.timezone} · Written reviews imported here; store-wide ratings may differ.</p>
    {!s.total ? <Card><p>No reviews yet. They show up here within 15 minutes of being posted.</p><Link href={`/w/${workspaceSlug}/app-reviews${manage ? "/settings" : ""}`} className={buttonClasses({ variant: "quiet", className: "mt-3" })}>{manage ? "Connect an app" : "Open inbox"}</Link></Card> : <>
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">{[
        ["Average rating", `${s.average?.toFixed(2) ?? "—"} / 5`], ["Reviews", String(s.total)],
        ["Reply rate", `${Math.round(s.replied / s.total * 100)}%`], ["Median time to reply", s.medianMinutes === null ? "No replies yet" : s.medianMinutes < 60 ? `${Math.round(s.medianMinutes)} min` : s.medianMinutes < 1440 ? `${(s.medianMinutes / 60).toFixed(1)} hours` : `${(s.medianMinutes / 1440).toFixed(1)} days`],
      ].map(([label, v]) => <Card key={label}><p className="text-caption text-ink-muted">{label}</p><p className="mt-2 text-h3 tabular-nums">{v}</p></Card>)}</div>
      <Card><h2 className="text-h3">Average rating over time</h2><p className="mt-2 text-caption text-ink-muted">Daily averages, on days with imported reviews. Each point has equal weight.</p>
        <svg viewBox="0 0 600 210" role="img" aria-labelledby="rating-chart-title rating-chart-description" className="mt-4 w-full text-accent-text">
          <title id="rating-chart-title">Daily average rating</title><desc id="rating-chart-description">Ratings from 1 to 5. The table below contains every daily value.</desc>
          {[1, 2, 3, 4, 5].map(r => <g key={r}><line x1="30" x2="570" y1={180 - r * 30} y2={180 - r * 30} stroke="currentColor" strokeOpacity="0.25" /><text x="5" y={185 - r * 30} fill="currentColor" fontSize="13">{r}</text></g>)}
          <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" />{daily.map((d, i) => <circle key={d.day} cx={30 + i * 540 / Math.max(1, daily.length - 1)} cy={180 - d.average * 30} r="3" fill="currentColor"><title>{`${dayLabel(d.day)}: ${d.average.toFixed(2)} out of 5`}</title></circle>)}
          <text x="30" y="202" fill="currentColor" fontSize="12">{daily[0] ? dayLabel(daily[0].day) : ""}</text><text x="570" y="202" textAnchor="end" fill="currentColor" fontSize="12">{daily.at(-1) ? dayLabel(daily.at(-1)!.day) : ""}</text>
        </svg>
        <Table label="Daily review ratings"><caption className="sr-only">Average rating and number of reviews by local date</caption><THead><TR><TH>Date</TH><TH>Reviews</TH><TH>Average out of 5</TH></TR></THead><TBody>{daily.map(d => <TR key={d.day}><TH scope="row">{dayLabel(d.day)}</TH><TD>{d.total}</TD><TD>{d.average.toFixed(2)}</TD></TR>)}</TBody></Table>
      </Card>
      <Card><h2 className="mb-4 text-h3">Rating distribution</h2><Table label="Rating distribution"><THead><TR><TH>Rating</TH><TH>Share</TH><TH>Reviews</TH></TR></THead><TBody>{[5, 4, 3, 2, 1].map(r => {
        const count = distribution.find(d => d.rating === r)?._count ?? 0;
        return <TR key={r}><TH scope="row">{r} out of 5</TH><TD><meter min={0} max={s.total} value={count} aria-label={`${r} out of 5: ${count} reviews`} className="w-full min-w-20 accent-primary" />{Math.round(count / s.total * 100)}%</TD><TD>{count}</TD></TR>;
      })}</TBody></Table></Card>
      <Card><h2 className="mb-4 text-h3">Volume by app, platform and version</h2><Table label="Review volume"><THead><TR><TH>App</TH><TH>Platform</TH><TH>Version</TH><TH>Reviews</TH></TR></THead><TBody>{volumes.sort((a, b) => b._count - a._count).map(v => <TR key={`${v.appId}:${v.appVersion}`}><TH scope="row">{v.appName}</TH><TD>{platformLabel(v.platform)}</TD><TD>{v.appVersion ?? "Not provided"}</TD><TD>{v._count}</TD></TR>)}</TBody></Table></Card>
    </>}
  </div>;
}
