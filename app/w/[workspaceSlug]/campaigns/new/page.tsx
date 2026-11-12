import { CampaignTabs } from "@/components/campaigns/CampaignTabs";
import { CampaignEditor } from "@/components/campaigns/editor/CampaignEditor";
import { PageHeader } from "@/components/ui/display";
import { loadEditorData } from "@/lib/campaigns/campaigns/editorData";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "New campaign" };

export default async function Page({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
  const data = await loadEditorData(workspace, membership);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="New campaign" />
      <CampaignTabs slug={workspaceSlug} />
      <CampaignEditor slug={workspaceSlug} campaign={null} {...data} />
    </div>
  );
}
