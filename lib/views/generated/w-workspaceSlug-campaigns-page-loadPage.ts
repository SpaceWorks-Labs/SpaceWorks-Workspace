// Generated from app/w/[workspaceSlug]/campaigns/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { listCampaigns } from "@/lib/campaigns/campaigns";
import { emailCapSummary } from "@/lib/campaigns/limits";
import { requireWorkspace } from "@/lib/permissions";

export async function loadPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
const { workspaceSlug } = await params;
const { workspace } = await requireWorkspace(workspaceSlug, "MEMBER");
const [campaigns, cap] = await Promise.all([listCampaigns(workspace.id), emailCapSummary(workspace.id)]);
const base = `/w/${workspaceSlug}/campaigns`;
return viewDto({ workspace, campaigns, cap, base } as const);
}
