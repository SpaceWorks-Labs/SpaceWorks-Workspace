// Generated from app/m/[workspaceSlug]/subscribe/[listSlug]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { resolvePublicWorkspace } from "@/lib/campaigns/public/gate";

export async function loadPage({ params }: PageProps<"/m/[workspaceSlug]/subscribe/[listSlug]">) {
const { workspaceSlug, listSlug } = await params;
const workspace = await resolvePublicWorkspace({ slug: workspaceSlug });
if (!workspace) notFound();
const list = await prisma.mailingList.findUnique({ where: { workspaceId_slug: { workspaceId: workspace.id, slug: listSlug } } });
if (!list || list.visibility !== "PUBLIC" || list.archivedAt) notFound();
return viewDto({ workspace, list } as const);
}
