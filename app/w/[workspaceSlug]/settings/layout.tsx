import { SettingsLayout as SettingsPageLayout } from "@/components/ui/layouts";
import { PageHeader } from "@/components/ui/display";
import { SettingsTabsNav } from "@/components/settings/SettingsTabsNav";
import { navContextFor } from "@/lib/navContext";
import { requireWorkspace } from "@/lib/permissions";
import { settingsTabsFor } from "@/lib/settingsTabs";

/** Tabs follow the member's role, module switches and organisation status (lib/settingsTabs.ts). */
export default async function SettingsLayout({ children, params }: LayoutProps<"/w/[workspaceSlug]/settings">) {
  const { workspaceSlug } = await params;
  const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN");
  const tabs = settingsTabsFor(workspace.slug, await navContextFor(workspace, membership));
  return (
    <SettingsPageLayout header={<PageHeader title="Settings" description={`How ${workspace.name} runs: details, people, labels and the record of changes.`} />} tabs={<SettingsTabsNav tabs={tabs} />}>
      {children}
    </SettingsPageLayout>
  );
}
