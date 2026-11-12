import { CampaignTabs } from "@/components/campaigns/CampaignTabs";
import { ImportForm } from "@/components/campaigns/subscribers/ImportForm";
import { EmptyState, PageHeader } from "@/components/ui/display";
import { listLists } from "@/lib/campaigns/lists";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Import subscribers" };

export default async function Page({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireWorkspace(workspaceSlug, "ADMIN");
  const lists = await listLists(workspace.id);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Import subscribers" />
      <CampaignTabs slug={workspaceSlug} />
      {lists.length === 0 ? <EmptyState title="Create a list first.">Imported people are added to the lists you choose.</EmptyState> : <ImportForm slug={workspaceSlug} lists={lists.map((l) => ({ id: l.id, name: l.name }))} />}
    </div>
  );
}
