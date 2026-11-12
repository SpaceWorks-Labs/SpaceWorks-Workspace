import { SectionHeading, StatTile } from "@/components/ui/display";
import { compactNumber, trendText } from "@/lib/admin/dashboard/compute";
import type { DashboardKpis } from "@/lib/admin/dashboard/types";

export function KpiSection({ kpis, range }: { kpis: DashboardKpis; range: number }) {
  const { orgs, users } = kpis;
  const totalOrgs = orgs.ACTIVE + orgs.PENDING + orgs.SUSPENDED + orgs.REJECTED;
  return (
    <section aria-label="Platform at a glance" className="flex flex-col gap-3">
      <SectionHeading title="Platform at a glance" description={`Counts now, with change over the last ${range} days.`} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Organisations"
          value={compactNumber(totalOrgs)}
          hint={`${orgs.ACTIVE} active, ${orgs.PENDING} pending, ${orgs.SUSPENDED} suspended, ${orgs.REJECTED} rejected`}
          href="/admin/organisations"
        />
        <StatTile
          label="Pending requests"
          value={compactNumber(kpis.pendingRequests)}
          hint={kpis.pendingRequests > 0 ? "Waiting for your decision" : "Nothing waiting"}
          tone={kpis.pendingRequests > 0 ? "attention" : "default"}
          href="/admin/requests"
        />
        <StatTile label="People" value={compactNumber(users.total)} hint={`${users.disabled} disabled`} href="/admin/users" />
        <StatTile
          label="Active people"
          value={`${compactNumber(users.active7)} / ${compactNumber(users.active30)}`}
          hint="Seen in the last 7 / 30 days"
          progress={{ value: users.active30, max: Math.max(1, users.total - users.disabled), tone: "accent" }}
        />
        <StatTile label={`New sign-ups (${range} days)`} value={compactNumber(kpis.signUps.current)} hint={trendText(kpis.signUps, range)} />
        <StatTile label={`New organisations (${range} days)`} value={compactNumber(kpis.newOrgs.current)} hint={trendText(kpis.newOrgs, range)} />
        <StatTile label={`Active members (${range} days)`} value={compactNumber(kpis.activeMembers.current)} hint={trendText(kpis.activeMembers, range)} />
        <StatTile
          label={`Invitations (${range} days)`}
          value={`${compactNumber(kpis.invitesSent.current)} sent`}
          hint={`${kpis.invitesAccepted.current} accepted. ${trendText(kpis.invitesSent, range)}`}
        />
      </div>
    </section>
  );
}
