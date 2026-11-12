import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { TaskDetail } from "@/components/tasks/TaskDetail";
import { requireWorkspace } from "@/lib/permissions";
import { canonicalTaskRedirect } from "@/lib/tasks/links";
import { getTaskDetail } from "@/lib/tasks/queries";

function parseNumber(value: string) {
  return /^\d{1,9}$/.test(value) ? Number(value) : null;
}

export async function generateMetadata({ params }: PageProps<"/w/[workspaceSlug]/projects/[key]/[number]">): Promise<Metadata> {
  const { workspaceSlug, number } = await params;
  const context = await requireWorkspace(workspaceSlug, "GUEST");
  const parsed = parseNumber(number);
  const task = parsed ? await getTaskDetail(context, parsed) : null;
  return { title: task ? `${task.reference} ${task.title}` : "Task" };
}

/**
 * Full task page. Task numbers are unique per workspace, so a link with an
 * old project key (the key was changed, or the task moved to another project)
 * redirects to the current one.
 */
export default async function TaskPage({ params }: PageProps<"/w/[workspaceSlug]/projects/[key]/[number]">) {
  const { workspaceSlug, key, number } = await params;
  const context = await requireWorkspace(workspaceSlug, "GUEST");
  const parsed = parseNumber(number);
  const task = parsed ? await getTaskDetail(context, parsed) : null;
  if (!task) notFound();
  const canonical = canonicalTaskRedirect(context.workspace.slug, key, { number: task.number, projectKey: task.project?.key ?? null });
  if (canonical) redirect(canonical);
  return <TaskDetail slug={context.workspace.slug} initial={task} variant="page" />;
}
