import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { TaskDetail } from "@/components/tasks/TaskDetail";
import { requireWorkspace } from "@/lib/permissions";
import { parseTaskReference } from "@/lib/tasks/links";
import { getTaskDetail } from "@/lib/tasks/queries";

async function load(workspaceSlug: string, ref: string) {
  const context = await requireWorkspace(workspaceSlug, "GUEST");
  const reference = parseTaskReference(decodeURIComponent(ref));
  const task = reference ? await getTaskDetail(context, reference.number) : null;
  // Numbers are unique per workspace: an old key (the task moved projects) still resolves.
  return { context, task };
}

export async function generateMetadata({ params }: PageProps<"/w/[workspaceSlug]/t/[ref]">): Promise<Metadata> {
  const { workspaceSlug, ref } = await params;
  const { task } = await load(workspaceSlug, ref);
  return { title: task ? `${task.reference} ${task.title}` : "Task" };
}

/**
 * Short task links: `/w/<slug>/t/BOT-12`, `/t/12` or `/t/%2312`. Project
 * tasks redirect to their board page; tasks without a project (meeting
 * action items, personal tasks) live here.
 */
export default async function ShortTaskPage({ params }: PageProps<"/w/[workspaceSlug]/t/[ref]">) {
  const { workspaceSlug, ref } = await params;
  await requireWorkspace(workspaceSlug, "GUEST");
  const { context, task } = await load(workspaceSlug, ref);
  if (!task) notFound();
  if (task.project) redirect(task.url);
  return <TaskDetail slug={context.workspace.slug} initial={task} variant="page" />;
}
