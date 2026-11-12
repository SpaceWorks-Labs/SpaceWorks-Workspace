// Generated from app/w/[workspaceSlug]/my-tasks/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { parseMyTasksTab } from "@/lib/tasks/myTasks";
import { directReportIds, listMyTasks, listQuickAddProjects, workspaceLabels } from "@/lib/tasks/queries";

export async function loadMyTasksPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/my-tasks">) {
const { workspaceSlug } = await params;
const context = await requireWorkspace(workspaceSlug, "MEMBER");
const [reports, projects, labels] = await Promise.all([directReportIds(context), listQuickAddProjects(context), workspaceLabels(context.workspace.id)]);
const requested = parseMyTasksTab((await searchParams).tab);
const tab = requested === "team" && reports.length === 0 ? "assigned" : requested;
const tasks = await listMyTasks(context, new Date(), tab);
return viewDto({ context, reports, projects, labels, tab, tasks } as const);
}
