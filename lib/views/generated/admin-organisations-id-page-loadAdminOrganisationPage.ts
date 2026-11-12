// Generated from app/admin/organisations/[id]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { loadOrgAudit, loadOrgMembers, loadOrgOverview, loadOrgRequests } from "@/lib/admin/orgDetail";
import { loadOrgLimitsView } from "@/lib/admin/limitsView";
import { viewerTimeZone } from "@/lib/format/datetime";
import { requireSuperAdminMfa } from "@/lib/permissions";
const TABS = [
  { key: "overview", label: "Overview" },
  { key: "members", label: "Members" },
  { key: "limits", label: "Limits and modules" },
  { key: "usage", label: "Usage" },
  { key: "audit", label: "Audit" },
  { key: "requests", label: "Requests" },
] as const;
export async function loadAdminOrganisationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; page?: string }> }) {
await requireSuperAdminMfa();
const { id } = await params;
const query = await searchParams;
const tab = TABS.find((item) => item.key === query.tab)?.key ?? "overview";
const overview = await loadOrgOverview(id);
if (!overview) notFound();
const { workspace } = overview;
const tz = viewerTimeZone();
const members = tab === "overview" || tab === "members" ? await loadOrgMembers(id) : [];
const limitsView = tab === "limits" || tab === "usage" ? await loadOrgLimitsView(id) : null;
const audit = tab === "audit" ? await loadOrgAudit(id, Number(query.page) || 1) : null;
const requests = tab === "requests" ? await loadOrgRequests(id) : null;
return viewDto({ tab, overview, workspace, tz, members, limitsView, audit, requests } as const);
}
