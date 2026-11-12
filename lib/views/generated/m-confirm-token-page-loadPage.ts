// Generated from app/m/confirm/[token]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { previewConfirmation } from "@/lib/campaigns/subscriptions";
import { resolvePublicWorkspace } from "@/lib/campaigns/public/gate";

export async function loadPage({ params }: PageProps<"/m/confirm/[token]">) {
const { token } = await params;
const preview = await previewConfirmation(token);
const live = Boolean(preview && (await resolvePublicWorkspace({ id: preview.workspaceId })));
return viewDto({ preview, live } as const);
}
