import Link from "next/link";
import { notFound } from "next/navigation";
import { OrgActions } from "@/components/admin/orgs/OrgActions";
import { OrgLimitsForm } from "@/components/admin/orgs/OrgLimitsForm";
import { OrgMembersPanel } from "@/components/admin/orgs/OrgMembersPanel";
import { OrgAuditPanel, OrgOverviewPanel, OrgRequestsPanel } from "@/components/admin/orgs/OrgReadPanels";
import { OrgStatusChip } from "@/components/admin/orgs/OrgStatusChip";
import { OrgUsagePanel } from "@/components/admin/orgs/OrgUsagePanel";
import { PageHeader } from "@/components/ui/display";
import { NavTabs } from "@/components/ui/tabs";
import { loadOrgAudit, loadOrgMembers, loadOrgOverview, loadOrgRequests } from "@/lib/admin/orgDetail";
import { loadOrgLimitsView } from "@/lib/admin/limitsView";
import { viewerTimeZone } from "@/lib/format/datetime";
import { requireSuperAdminMfa } from "@/lib/permissions";

export const metadata = { title: "Organisation" };

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "members", label: "Members" },
  { key: "limits", label: "Limits and modules" },
  { key: "usage", label: "Usage" },
  { key: "audit", label: "Audit" },
  { key: "requests", label: "Requests" },
] as const;

export default async function AdminOrganisationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; page?: string }> }) {
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
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        kicker={<Link href="/admin/organisations" className="underline underline-offset-4">All organisations</Link>}
        title={<span className="inline-flex flex-wrap items-center gap-3">{workspace.name} <OrgStatusChip status={workspace.status} /></span>}
        description={`/w/${workspace.slug}`}
        actions={<Link href={`/w/${workspace.slug}`} className="inline-flex h-11 items-center rounded-md border border-line bg-panel px-4 text-label text-ink hover:bg-muted">Open organisation</Link>}
      />
      <NavTabs label="Organisation sections" items={TABS.map((item) => ({ href: `/admin/organisations/${id}?tab=${item.key}`, label: item.label, active: item.key === tab }))} />
      {tab === "overview" ? (
        <>
          <OrgOverviewPanel overview={overview} tz={tz} />
          <OrgActions
            workspaceId={id}
            status={workspace.status}
            archived={Boolean(workspace.archivedAt)}
            candidates={members.filter((m) => m.status === "ACTIVE").map((m) => ({ id: m.id, label: `${m.user.name ?? "No name"} (${m.user.email}), ${m.role.toLowerCase()}` }))}
          />
        </>
      ) : null}
      {tab === "members" ? <OrgMembersPanel workspaceId={id} members={members} /> : null}
      {limitsView && tab === "limits" ? <OrgLimitsForm workspaceId={id} view={limitsView} /> : null}
      {limitsView && tab === "usage" ? <OrgUsagePanel usage={limitsView.usage} limits={limitsView.effective} /> : null}
      {audit ? <OrgAuditPanel id={id} slug={workspace.slug} audit={audit} tz={tz} /> : null}
      {requests ? <OrgRequestsPanel requests={requests} tz={tz} /> : null}
    </div>
  );
}
