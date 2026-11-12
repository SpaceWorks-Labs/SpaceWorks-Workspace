// Generated from app/w/[workspaceSlug]/projects/[key]/[number]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound, redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canonicalTaskRedirect } from "@/lib/tasks/links";
import { getTaskDetail } from "@/lib/tasks/queries";
function parseNumber(value: string) {
  return /^\d{1,9}$/.test(value) ? Number(value) : null;
}
export async function loadTaskPage({ params }: PageProps<"/w/[workspaceSlug]/projects/[key]/[number]">) {
const { workspaceSlug, key, number } = await params;
const context = await requireWorkspace(workspaceSlug, "GUEST");
const parsed = parseNumber(number);
const task = parsed ? await getTaskDetail(context, parsed) : null;
if (!task) notFound();
const canonical = canonicalTaskRedirect(context.workspace.slug, key, { number: task.number, projectKey: task.project?.key ?? null });
if (canonical) redirect(canonical);
return viewDto({ context, task } as const);
}
