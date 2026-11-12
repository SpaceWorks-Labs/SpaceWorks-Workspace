import { Card, CardHeader, SectionHeading } from "@/components/ui/display";
import type { GrowthSeries } from "@/lib/admin/dashboard/types";
import { TrendChart } from "./TrendChart";

export function GrowthSection({ growth, range }: { growth: GrowthSeries; range: number }) {
  const per = growth.bucketDays > 1 ? "per week" : "per day";
  const charts = [
    { title: "New organisations", description: `Organisations created ${per}, any status.`, points: growth.newOrgs },
    { title: "New people", description: `Accounts created ${per}.`, points: growth.newUsers },
    { title: "Active members", description: `People with recorded activity ${per} (the activity feed).`, points: growth.activeMembers },
  ];
  return (
    <section aria-label="Growth" className="flex flex-col gap-3">
      <SectionHeading title="Growth" description={`The last ${range} days, in UTC.`} />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {charts.map((chart) => (
          <Card key={chart.title} as="article" className="min-w-0">
            <CardHeader titleAs="h3" title={chart.title} description={chart.description} />
            <TrendChart title={chart.title} points={chart.points} bucketDays={growth.bucketDays} />
          </Card>
        ))}
      </div>
    </section>
  );
}
