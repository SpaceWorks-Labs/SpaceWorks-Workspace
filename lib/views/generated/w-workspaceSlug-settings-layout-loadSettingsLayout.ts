// Generated from app/w/[workspaceSlug]/settings/layout.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { navContextFor } from "@/lib/navContext";
import { requireWorkspace } from "@/lib/permissions";
import { settingsTabsFor } from "@/lib/settingsTabs";

export async function loadSettingsLayout({ children, params }: LayoutProps<"/w/[workspaceSlug]/settings">) {
const { workspaceSlug } = await params;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN");
const tabs = settingsTabsFor(workspace.slug, await navContextFor(workspace, membership));
return viewDto({ workspace, tabs } as const);
}
