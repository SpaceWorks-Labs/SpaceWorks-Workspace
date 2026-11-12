import { PageHeader } from "@/components/ui/display";
import { NavTabs } from "@/components/ui/tabs";
import { dashboardHref } from "@/lib/admin/dashboard/compute";
import { DASHBOARD_RANGES, type AdminDashboardView } from "@/lib/admin/dashboard/types";
import { formatRelativeTime, viewerTimeZone } from "@/lib/format/datetime";
import { GrowthSection } from "./GrowthSection";
import { KpiSection } from "./KpiSection";
import { ModuleAdoptionCard } from "./ModuleAdoptionCard";
import { OrgUsageSection } from "./OrgUsageSection";
import { PlatformsCard } from "./PlatformsCard";
import { RecentActivitySection } from "./RecentActivitySection";
import { SystemHealthCard } from "./SystemHealthCard";
import { UsageTotalsCard } from "./UsageTotalsCard";

/** The instance super-admin dashboard. Pure: renders an already-authorised view. */
export function AdminDashboard({ data }: { data: AdminDashboardView }) {
  const { range } = data;
  const ranges = DASHBOARD_RANGES.map((days) => ({ href: dashboardHref(days, data.usage.sort), label: `Last ${days} days`, active: days === range }));
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Instance admin"
          description={`Health, growth and usage across every organisation. Aggregates only; workspace content stays private to members. Figures from ${formatRelativeTime(data.generatedAt, viewerTimeZone()).toLowerCase()}.`}
        />
        <NavTabs label="Period" items={ranges} />
      </div>
      <KpiSection kpis={data.kpis} range={range} />
      <GrowthSection growth={data.growth} range={range} />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <SystemHealthCard health={data.health} />
        <PlatformsCard platforms={data.platforms} metabase={data.metabase} />
      </div>
      <OrgUsageSection usage={data.usage} range={range} />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <UsageTotalsCard totals={data.totals} range={range} />
        <ModuleAdoptionCard adoption={data.usage.adoption} activeOrgs={data.usage.activeOrgs} />
      </div>
      <RecentActivitySection recent={data.recent} />
    </div>
  );
}
