// Generated from app/w/[workspaceSlug]/campaigns/[campaignId]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { getCampaign } from "@/lib/campaigns/campaigns";
import { loadEditorData } from "@/lib/campaigns/campaigns/editorData";
import { requireWorkspace } from "@/lib/permissions";

export async function loadPage({ params }: { params: Promise<{ workspaceSlug: string; campaignId: string }> }) {
const { workspaceSlug, campaignId } = await params;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
const campaign = await getCampaign(workspace.id, campaignId);
if (!campaign) notFound();
const data = await loadEditorData(workspace, membership);
const base = `/w/${workspaceSlug}/campaigns`;
return viewDto({ workspace, campaign, data, base } as const);
}
