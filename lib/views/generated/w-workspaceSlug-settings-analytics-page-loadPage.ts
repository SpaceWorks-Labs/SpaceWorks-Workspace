// Generated from app/w/[workspaceSlug]/settings/analytics/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { getWorkspaceAnalyticsView } from "@/lib/observability/workspaceStore";

export async function loadPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
const { workspaceSlug } = await params;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN");
const view = await getWorkspaceAnalyticsView(workspace.id);
return viewDto({ membership, view } as const);
}
