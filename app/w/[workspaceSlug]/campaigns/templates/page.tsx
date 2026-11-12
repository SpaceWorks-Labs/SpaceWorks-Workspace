import { PageHeader } from "@/components/ui/display";
import { CampaignTabs } from "@/components/campaigns/CampaignTabs";
import { TemplateManager } from "@/components/campaigns/templates/TemplateManager";
import { DEFAULT_TEMPLATE_HTML } from "@/lib/campaigns/render";
import { listTemplates } from "@/lib/campaigns/campaigns";
import { canManageCampaigns } from "@/lib/campaigns/roles";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Email templates" };

export default async function Page({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
  const templates = await listTemplates(workspace.id);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Email campaigns" description="Templates wrap your campaign content." />
      <CampaignTabs slug={workspaceSlug} />
      <TemplateManager slug={workspaceSlug} templates={templates.map((t) => ({ id: t.id, name: t.name, subject: t.subject, bodyHtml: t.bodyHtml, isDefault: t.isDefault }))} builtInHtml={DEFAULT_TEMPLATE_HTML} canDelete={canManageCampaigns(membership)} />
    </div>
  );
}
