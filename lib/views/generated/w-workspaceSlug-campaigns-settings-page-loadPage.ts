// Generated from app/w/[workspaceSlug]/campaigns/settings/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { emailCapSummary, usesSharedSmtp } from "@/lib/campaigns/limits";
import { getCampaignSettings } from "@/lib/campaigns/settings";
import { requireWorkspace } from "@/lib/permissions";

export async function loadPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
const { workspaceSlug } = await params;
const { workspace } = await requireWorkspace(workspaceSlug, "ADMIN");
const [settings, cap, shared] = await Promise.all([getCampaignSettings(workspace.id), emailCapSummary(workspace.id), usesSharedSmtp(workspace.id)]);
return viewDto({ workspace, settings, cap, shared } as const);
}
