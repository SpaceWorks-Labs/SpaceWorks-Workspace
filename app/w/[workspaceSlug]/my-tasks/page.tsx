import { MyTasks } from "@/components/tasks/MyTasks";
import { PageHeader } from "@/components/ui/display";
import { requireWorkspace } from "@/lib/permissions";
import { parseMyTasksTab } from "@/lib/tasks/myTasks";
import { directReportIds, listMyTasks, listQuickAddProjects, workspaceLabels } from "@/lib/tasks/queries";

export const metadata = { title: "My tasks" };

export default async function MyTasksPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/my-tasks">) {
  const { workspaceSlug } = await params;
  const context = await requireWorkspace(workspaceSlug, "MEMBER");
  const [reports, projects, labels] = await Promise.all([directReportIds(context), listQuickAddProjects(context), workspaceLabels(context.workspace.id)]);
  const requested = parseMyTasksTab((await searchParams).tab);
  const tab = requested === "team" && reports.length === 0 ? "assigned" : requested;
  const tasks = await listMyTasks(context, new Date(), tab);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="My tasks" description="Your work across projects, by when it's due." />
      <MyTasks
        slug={context.workspace.slug}
        viewerId={context.user.id}
        initial={tasks}
        initialTab={tab}
        hasTeam={reports.length > 0}
        projects={projects}
        labels={labels}
        timeZone={context.workspace.timezone}
        projectsHref={`/w/${context.workspace.slug}/projects`}
      />
    </div>
  );
}
