// Generated from app/w/[workspaceSlug]/projects/[key]/(project)/settings/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { listVisibleTeams } from "@/lib/projects/queries";
import { assignableMembers } from "@/lib/tasks/access";
import { findProjectByKey, permissionsFor, projectSummary } from "@/lib/tasks/queries";
import { listTaskTypes } from "@/lib/tasks/service";

export async function loadProjectSettingsPage({ params }: PageProps<"/w/[workspaceSlug]/projects/[key]/settings">) {
const { workspaceSlug, key } = await params;
const context = await requireWorkspace(workspaceSlug, "MEMBER");
const project = await findProjectByKey(context, key);
if (!project || !permissionsFor(context, project).canManage) notFound();
const [summary, members, teams, types] = await Promise.all([projectSummary(project), assignableMembers(context.workspace.id, null), listVisibleTeams(context), listTaskTypes(context, project.id)]);
return viewDto({ context, project, summary, members, teams, types } as const);
}
