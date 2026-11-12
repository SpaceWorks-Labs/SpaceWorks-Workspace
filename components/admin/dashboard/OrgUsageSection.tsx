import Link from "next/link";
import { OrgStatusChip } from "@/components/admin/orgs/OrgStatusChip";
import { Card, CardHeader, Chip, EmptyState } from "@/components/ui/display";
import { NavTabs } from "@/components/ui/tabs";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { compactNumber, dashboardHref, LIMIT_LABELS, SORT_LABELS } from "@/lib/admin/dashboard/compute";
import { ORG_SORTS, type DashboardRange, type LimitUse, type OrgUsageRow, type OrgUsageView } from "@/lib/admin/dashboard/types";
import { formatBytes } from "@/lib/limits/format";

const linkClass = "font-semibold text-ink underline-offset-4 hover:underline";

function OrgCell({ row }: { row: OrgUsageRow }) {
  return (
    <TD className="min-w-48">
      <Link href={`/admin/organisations/${row.id}`} className={linkClass}>{row.name}</Link>
      <span className="block text-caption text-ink-muted">/{row.slug}{row.plan ? ` · ${row.plan}` : ""}</span>
    </TD>
  );
}

function limitValue(use: LimitUse) {
  const fmt = (n: number) => (use.key === "storage" ? formatBytes(n) : compactNumber(n));
  return `${fmt(use.used)} of ${fmt(use.max)}`;
}

function TopTable({ rows, range }: { rows: OrgUsageRow[]; range: number }) {
  if (!rows.length) return <EmptyState className="border-0" title="No organisation has used this yet." />;
  return (
    <Table label="Top organisations by usage">
      <THead>
        <tr>
          <TH>Organisation</TH><TH>Status</TH><TH>Members</TH><TH>Guests</TH><TH>Projects</TH><TH>Storage</TH>
          <TH>{`Tasks (${range} days)`}</TH><TH>Emails this month</TH><TH>Assistant tokens this month</TH>
        </tr>
      </THead>
      <TBody>
        {rows.map((row) => (
          <TR key={row.id}>
            <OrgCell row={row} />
            <TD><OrgStatusChip status={row.status} /></TD>
            <TD className="tabular-nums">{row.members}</TD>
            <TD className="tabular-nums">{row.guests}</TD>
            <TD className="tabular-nums">{row.projects}</TD>
            <TD className="whitespace-nowrap tabular-nums">{formatBytes(row.storageBytes)}</TD>
            <TD className="tabular-nums">{compactNumber(row.tasks)}</TD>
            <TD className="tabular-nums">{compactNumber(row.emailsMonth)}</TD>
            <TD className="tabular-nums">{compactNumber(row.assistantMonth)}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

function NearLimitTable({ rows }: { rows: OrgUsageRow[] }) {
  if (!rows.length) return <EmptyState className="border-0" title="No active organisation is near a limit." />;
  return (
    <Table label="Organisations near a limit">
      <THead>
        <tr><TH>Organisation</TH><TH>Near or over</TH><TH><span className="sr-only">Actions</span></TH></tr>
      </THead>
      <TBody>
        {rows.map((row) => (
          <TR key={row.id}>
            <OrgCell row={row} />
            <TD>
              <span className="flex flex-wrap gap-1.5">
                {row.near.map((use) => (
                  <Chip key={use.key} tone={use.ratio >= 1 ? "danger" : "warning"} size="sm">
                    {`${use.ratio >= 1 ? "At limit" : "Near limit"}: ${LIMIT_LABELS[use.key]} ${limitValue(use)}`}
                  </Chip>
                ))}
              </span>
            </TD>
            <TD className="text-right">
              <Link href={`/admin/organisations/${row.id}?tab=limits`} className="inline-flex min-h-11 items-center whitespace-nowrap font-semibold text-accent-text underline underline-offset-4">
                Review limits<span className="sr-only"> for {row.name}</span>
              </Link>
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

export function OrgUsageSection({ usage, range }: { usage: OrgUsageView; range: DashboardRange }) {
  const tabs = ORG_SORTS.map((sort) => ({ href: dashboardHref(range, sort, "#usage"), label: SORT_LABELS[sort], active: sort === usage.sort }));
  return (
    <div className="flex flex-col gap-3">
      <Card as="section" aria-label="Usage across organisations" id="usage" className="min-w-0 scroll-mt-6">
        <CardHeader title="Usage across organisations" description="The ten organisations with the most usage. Storage includes kept file versions." />
        <NavTabs label="Rank organisations by" items={tabs} className="mb-4" />
        <TopTable rows={usage.top} range={range} />
      </Card>
      <Card as="section" aria-label="Near limits" className="min-w-0">
        <CardHeader
          title="Near limits"
          description={`${usage.nearLimitTotal} active ${usage.nearLimitTotal === 1 ? "organisation is" : "organisations are"} at 80% or more of a limit.`}
        />
        <NearLimitTable rows={usage.nearLimit} />
      </Card>
    </div>
  );
}
