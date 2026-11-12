// Generated from app/w/[workspaceSlug]/projects/[key]/(project)/archived/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { findProjectByKey, listArchivedTasks, permissionsFor } from "@/lib/tasks/queries";

export async function loadProjectArchivedPage({ params }: PageProps<"/w/[workspaceSlug]/projects/[key]/archived">) {
const { workspaceSlug, key } = await params;
const context = await requireWorkspace(workspaceSlug, "GUEST");
const project = await findProjectByKey(context, key);
if (!project) notFound();
const tasks = await listArchivedTasks(context, project);
const permissions = permissionsFor(context, project);
return viewDto({ context, project, tasks, permissions } as const);
}
