import { notFound } from "next/navigation";
import { ArchivedTasks } from "@/components/projects/ArchivedTasks";
import { requireWorkspace } from "@/lib/permissions";
import { findProjectByKey, listArchivedTasks, permissionsFor } from "@/lib/tasks/queries";

export const metadata = { title: "Archived tasks" };

/** Archived tasks of a project: restore them, or (admins and the project owner) delete them for good. */
export default async function ProjectArchivedPage({ params }: PageProps<"/w/[workspaceSlug]/projects/[key]/archived">) {
  const { workspaceSlug, key } = await params;
  const context = await requireWorkspace(workspaceSlug, "GUEST");
  const project = await findProjectByKey(context, key);
  if (!project) notFound();
  const tasks = await listArchivedTasks(context, project);
  const permissions = permissionsFor(context, project);
  return (
    <ArchivedTasks
      slug={context.workspace.slug}
      projectKey={project.key}
      tasks={tasks}
      timeZone={context.workspace.timezone}
      canDelete={permissions.canManage && project.status !== "ARCHIVED"}
      projectArchived={project.status === "ARCHIVED"}
    />
  );
}
