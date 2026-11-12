// Generated from app/w/[workspaceSlug]/campaigns/new/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { loadEditorData } from "@/lib/campaigns/campaigns/editorData";
import { requireWorkspace } from "@/lib/permissions";

export async function loadPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
const { workspaceSlug } = await params;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
const data = await loadEditorData(workspace, membership);
return viewDto({ data } as const);
}
