// Generated from app/w/[workspaceSlug]/campaigns/templates/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { listTemplates } from "@/lib/campaigns/campaigns";
import { requireWorkspace } from "@/lib/permissions";

export async function loadPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
const { workspaceSlug } = await params;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
const templates = await listTemplates(workspace.id);
return viewDto({ membership, templates } as const);
}
