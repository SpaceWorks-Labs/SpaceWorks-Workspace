// Generated from app/w/[workspaceSlug]/campaigns/lists/[listId]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getList } from "@/lib/campaigns/lists";
import { requireWorkspace } from "@/lib/permissions";

export async function loadPage({ params }: { params: Promise<{ workspaceSlug: string; listId: string }> }) {
const { workspaceSlug, listId } = await params;
const { workspace } = await requireWorkspace(workspaceSlug, "ADMIN");
const list = await getList(workspace.id, listId);
if (!list) notFound();
const counts = await Promise.all((["CONFIRMED", "UNCONFIRMED", "UNSUBSCRIBED"] as const).map((status) => prisma.listSubscription.count({ where: { workspaceId: workspace.id, listId, status } })));
return viewDto({ workspace, list, counts } as const);
}
