import { PlanLimits, PlanModules, PlanRequests, PlanStatus } from "@/components/orgs/PlanOverview";
import { PageHeader } from "@/components/ui/display";
import { loadPlanView } from "@/lib/orgRequests/plan";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Plan and limits" };

export default async function Page({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireWorkspace(workspaceSlug, "OWNER");
  const view = await loadPlanView(workspace.id);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Plan and limits" description={`What ${workspace.name} can use, and how to ask for more.`} />
      <PlanStatus view={view} />
      <PlanLimits slug={workspace.slug} view={view} />
      <PlanModules slug={workspace.slug} view={view} />
      <PlanRequests view={view} />
    </div>
  );
}
