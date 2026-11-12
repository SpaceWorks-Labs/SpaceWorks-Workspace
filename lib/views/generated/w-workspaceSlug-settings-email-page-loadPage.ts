// Generated from app/w/[workspaceSlug]/settings/email/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { getWorkspaceEmailSettingsView } from "@/lib/email/workspaceSettings";
import { requireWorkspace } from "@/lib/permissions";

export async function loadPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
const { workspaceSlug } = await params;
const { workspace, user } = await requireWorkspace(workspaceSlug, "ADMIN");
const settings = await getWorkspaceEmailSettingsView(workspace.id);
const verifiedAt = settings?.lastVerifiedAt ? new Date(settings.lastVerifiedAt) : null;
return viewDto({ workspace, user, settings, verifiedAt } as const);
}
