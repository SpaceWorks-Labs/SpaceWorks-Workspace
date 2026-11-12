// Generated from app/w/[workspaceSlug]/campaigns/subscribers/import/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { listLists } from "@/lib/campaigns/lists";
import { requireWorkspace } from "@/lib/permissions";

export async function loadPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
const { workspaceSlug } = await params;
const { workspace } = await requireWorkspace(workspaceSlug, "ADMIN");
const lists = await listLists(workspace.id);
return viewDto({ lists } as const);
}
