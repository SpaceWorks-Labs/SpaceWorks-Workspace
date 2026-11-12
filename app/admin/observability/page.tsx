import { MetabaseFrame } from "@/components/admin/observability/MetabaseFrame";
import { ObservabilityConsole } from "@/components/admin/observability/ObservabilityConsole";
import { Card, CardHeader, PageHeader } from "@/components/ui/display";
import { getProviderStatus } from "@/lib/observability";
import { PROVIDER_IDS } from "@/lib/observability/admin/providers";
import { getConsoleData } from "@/lib/observability/admin/settings";
import { instanceEmbed } from "@/lib/observability/metabase/embed";
import { requireSuperAdminMfa } from "@/lib/permissions";

export const metadata = { title: "Observability" };

export default async function AdminObservabilityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireSuperAdminMfa();
  const raw = (await searchParams).dashboard;
  const wanted = Number(Array.isArray(raw) ? raw[0] : raw);
  const [data, embed, statuses] = await Promise.all([
    getConsoleData(),
    instanceEmbed(Number.isSafeInteger(wanted) ? wanted : undefined),
    Promise.all(PROVIDER_IDS.map(async (id) => {
      try {
        const s = await getProviderStatus(id);
        return [id, !s.enabled ? "Off." : s.configured ? "Ready." : `Missing: ${s.missing.join(", ")}.`] as const;
      } catch { return [id, "Status unavailable."] as const; }
    })),
  ]);
  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL ?? process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Observability" description="Everything here is off until you turn it on. Saved values override environment variables, and secrets are encrypted and never shown again." />
      <ObservabilityConsole data={data} baseUrl={baseUrl} statuses={Object.fromEntries(statuses)} />
      {embed.selected !== null || embed.linkUrl ? (
        <Card padding="lg" as="section" aria-label="Instance reports">
          <CardHeader title="Instance reports" description="Dashboards listed under Metabase instance dashboard ids." />
          {embed.dashboards.length > 1 ? (
            <nav aria-label="Dashboards" className="mb-4 flex flex-wrap gap-2">
              {embed.dashboards.map((id) => (
                <a key={id} href={`/admin/observability?dashboard=${id}`} aria-current={id === embed.selected ? "page" : undefined} className="rounded-lg border border-line px-3 py-2 text-label text-ink aria-[current=page]:bg-sidebar">Dashboard {id}</a>
              ))}
            </nav>
          ) : null}
          <MetabaseFrame title="Instance report" embedUrl={embed.embedUrl} linkUrl={embed.linkUrl} reason={embed.reason} />
        </Card>
      ) : null}
    </div>
  );
}
