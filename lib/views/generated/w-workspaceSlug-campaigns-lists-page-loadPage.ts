// Generated from app/w/[workspaceSlug]/campaigns/lists/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { listLists } from "@/lib/campaigns/lists";
import { canManageCampaigns } from "@/lib/campaigns/roles";
import { requireWorkspace } from "@/lib/permissions";

export async function loadPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
const { workspaceSlug } = await params;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
const lists = await listLists(workspace.id, { includeArchived: true });
const canManage = canManageCampaigns(membership);
return viewDto({ lists, canManage } as const);
}
