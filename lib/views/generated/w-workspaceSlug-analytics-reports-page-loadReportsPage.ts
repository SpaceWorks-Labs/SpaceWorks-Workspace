// Generated from app/w/[workspaceSlug]/analytics/reports/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { getObsSettings } from "@/lib/observability/keys";
import { workspaceEmbed } from "@/lib/observability/metabase/embed";
import { resolveWorkspaceConnection } from "@/lib/observability/workspaceConfig";
import { requireWorkspace } from "@/lib/permissions";
import { canViewAnalytics } from "@/lib/roles";

export async function loadReportsPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/analytics/reports">) {
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
return viewDto({ embed, grafanaUrl, base } as const);
}
