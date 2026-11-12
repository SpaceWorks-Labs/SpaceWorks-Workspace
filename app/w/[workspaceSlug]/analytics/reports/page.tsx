import { notFound } from "next/navigation";
import { MetabaseFrame } from "@/components/admin/observability/MetabaseFrame";
import { Callout, PageHeader } from "@/components/ui/display";
import { getObsSettings } from "@/lib/observability/keys";
import { workspaceEmbed } from "@/lib/observability/metabase/embed";
import { resolveWorkspaceConnection } from "@/lib/observability/workspaceConfig";
import { requireWorkspace } from "@/lib/permissions";
import { canViewAnalytics } from "@/lib/roles";

export const metadata = { title: "Reports in Metabase" };

export default async function ReportsPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/analytics/reports">) {
  const { workspaceSlug } = await params;
  const actor = await requireWorkspace(workspaceSlug, "MEMBER", { module: "analytics" });
  if (!canViewAnalytics(actor.membership)) notFound();
  const raw = (await searchParams).dashboard;
  const wanted = Number(Array.isArray(raw) ? raw[0] : raw);
  const [embed, grafana, settings] = await Promise.all([
    workspaceEmbed(actor.workspace.id, Number.isSafeInteger(wanted) ? wanted : undefined),
    resolveWorkspaceConnection("grafana", actor.workspace.id),
    getObsSettings(),
  ]);
  const path = grafana.source === "instance" ? settings.grafana.dashboardPath ?? "" : "";
  const grafanaUrl = grafana.config.url && grafana.source !== "off" ? `${grafana.config.url.replace(/\/$/, "")}${path}` : null;
  const base = `/w/${workspaceSlug}/analytics/reports`;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Reports in Metabase" description="Your workspace's own reports. Each one is filtered to this workspace and the link expires after a few minutes." />
      {embed.dashboards.length > 1 ? (
        <nav aria-label="Dashboards" className="flex flex-wrap gap-2">
          {embed.dashboards.map((id) => (
            <a key={id} href={`${base}?dashboard=${id}`} aria-current={id === embed.selected ? "page" : undefined} className="rounded-lg border border-line px-3 py-2 text-label text-ink aria-[current=page]:bg-sidebar">Dashboard {id}</a>
          ))}
        </nav>
      ) : null}
      {embed.embedUrl || embed.linkUrl ? (
        <MetabaseFrame title="Metabase report" embedUrl={embed.embedUrl} linkUrl={embed.linkUrl} reason={embed.reason} />
      ) : (
        <Callout tone="info" title="No reports yet">{embed.reason ?? "Ask a workspace admin to connect Metabase in Connected analytics."}</Callout>
      )}
      {grafanaUrl ? <a href={grafanaUrl} target="_blank" rel="noopener noreferrer" className="text-caption underline underline-offset-4">Open the Grafana dashboard (new tab)</a> : null}
    </div>
  );
}
