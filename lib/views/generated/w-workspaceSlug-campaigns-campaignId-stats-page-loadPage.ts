// Generated from app/w/[workspaceSlug]/campaigns/[campaignId]/stats/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { getCampaign } from "@/lib/campaigns/campaigns";
import { getCampaignStats } from "@/lib/campaigns/stats";
import { requireWorkspace } from "@/lib/permissions";

export async function loadPage({ params }: { params: Promise<{ workspaceSlug: string; campaignId: string }> }) {
const { workspaceSlug, campaignId } = await params;
const { workspace } = await requireWorkspace(workspaceSlug, "MEMBER");
const campaign = await getCampaign(workspace.id, campaignId);
const stats = campaign ? await getCampaignStats(workspace.id, campaign.id) : null;
if (!campaign || !stats) notFound();
const tracking = campaign.trackOpens || campaign.trackClicks;
return viewDto({ campaign, stats, tracking } as const);
}
