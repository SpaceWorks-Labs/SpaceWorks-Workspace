import { PageHeader } from "@/components/ui/display";
import { ConnectedAnalytics } from "@/components/settings/analytics/ConnectedAnalytics";
import { requireWorkspace } from "@/lib/permissions";
import { getWorkspaceAnalyticsView } from "@/lib/observability/workspaceStore";

export const metadata = { title: "Connected analytics" };

export default async function Page({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN");
  const view = await getWorkspaceAnalyticsView(workspace.id);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Connected analytics" description="Choose whether this workspace uses the instance's analytics tools, its own accounts, or none. Nothing is sent unless you turn it on, and secrets are never shown again." />
      <ConnectedAnalytics slug={workspaceSlug} view={view} isOwner={membership.role === "OWNER"} />
    </div>
  );
}
