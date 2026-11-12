// Generated from app/w/[workspaceSlug]/settings/plan/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { loadPlanView } from "@/lib/orgRequests/plan";
import { requireWorkspace } from "@/lib/permissions";

export async function loadPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
const { workspaceSlug } = await params;
const { workspace } = await requireWorkspace(workspaceSlug, "OWNER");
const view = await loadPlanView(workspace.id);
return viewDto({ workspace, view } as const);
}
