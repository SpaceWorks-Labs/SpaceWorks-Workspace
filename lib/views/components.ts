import "server-only";
import { requireWorkspace } from "@/lib/permissions";
import { approvalInbox, getApprovalView } from "@/lib/approvals/engine";
import { hiddenTeamIds, teamScopeFilter } from "@/lib/teamAccess";
import { repositoryItems } from "@/lib/integrations/github/api";
import { prisma } from "@/lib/db";
import { getLoaderConfig } from "@/lib/observability/layoutProps";
export async function loadApprovalInbox({ params }: { params: { workspaceSlug: string } }) {
  const actor = await requireWorkspace(params.workspaceSlug, "MEMBER");
  const rows = await approvalInbox(actor);
  return { actor, rows: await Promise.all(rows.map(async row => ({ ...row, view: await getApprovalView(actor, row.subjectType, row.subjectId) }))) };
}
export async function loadGithubPullRequests({ params }: { params: { workspaceSlug: string; projectId: string } }) {
  const { workspace, membership } = await requireWorkspace(params.workspaceSlug);
  const hidden = await hiddenTeamIds(workspace.id, membership);
  const project = await prisma.project.findFirst({ where: { id: params.projectId, workspaceId: workspace.id, ...teamScopeFilter(hidden) }, select: { id: true } });
  if (!project) return null;
  const repos = await prisma.githubRepo.findMany({ where: { workspaceId: workspace.id, linkedProjectId: project.id, connection: { workspaceId: workspace.id, status: "ACTIVE" } }, select: { id: true, fullName: true, installationId: true } });
  return Promise.all(repos.map(async repo => ({ id: repo.id, fullName: repo.fullName, items: await repositoryItems(repo.installationId, repo.fullName).catch(() => null) })));
}
/** Root-layout analytics config. A reader so the split frontend gets it through the gateway. */
export async function loadObservabilityConfig({ params }: { params: { workspaceSlug?: string } }) {
  return getLoaderConfig(params.workspaceSlug || null);
}
