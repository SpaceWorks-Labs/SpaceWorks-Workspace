import "server-only";
import { prisma } from "@/lib/db";
import { dispatch } from "@/lib/notify";
import { verifySha256 } from "@/lib/messaging/signatures";
import { readInboundBody } from "@/lib/messaging/inbound";
import type { Prisma } from "@prisma/client";
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown, max = 200) => typeof v === "string" ? v.slice(0, max) : "";
export async function receiveGithub(request: Request) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return new Response(null, { status: 503 });
  let body: string; try { body = await readInboundBody(request, 1000000); } catch { return new Response(null, { status: 413 }); }
  if (!verifySha256(secret, body, request.headers.get("x-hub-signature-256"))) return new Response(null, { status: 401 });
  let p: Record<string, unknown>; try { p = obj(JSON.parse(body)); } catch { return new Response(null, { status: 400 }); }
  const delivery = request.headers.get("x-github-delivery"); const kind = request.headers.get("x-github-event");
  if (!delivery || delivery.length > 128 || !kind || kind.length > 80) return new Response(null, { status: 400 });
  if (kind === "ping") return Response.json({ ok: true });
  const installationId = String(obj(p.installation).id ?? "");
  if (kind === "installation" && ["deleted", "suspend", "unsuspend"].includes(String(p.action))) {
    await prisma.integrationConnection.updateMany({ where: { provider: "GITHUB", externalId: installationId }, data: { status: p.action === "deleted" ? "REVOKED" : p.action === "suspend" ? "ERROR" : "ACTIVE", lastError: p.action === "unsuspend" ? null : "GitHub installation access changed. Check the App installation." } });
    return Response.json({ ok: true });
  }
  const connections = await prisma.integrationConnection.findMany({ where: { provider: "GITHUB", externalId: installationId, status: "ACTIVE", workspace: { status: "ACTIVE", archivedAt: null } }, select: { id: true, workspaceId: true } });
  for (const connection of connections) {
    const fullName = text(obj(p.repository).full_name, 256);
    const repo = fullName ? await prisma.githubRepo.findFirst({ where: { workspaceId: connection.workspaceId, connectionId: connection.id, fullName } }) : null;
    // Only installed, explicitly synchronised repositories are allowed to populate a workspace feed.
    if (!repo) continue;
    const item = obj(p.pull_request ?? p.issue ?? p.release ?? p.check_run ?? p.workflow_run);
    const candidate = text(item.html_url, 2048); const url = candidate.startsWith("https://github.com/") ? candidate : undefined;
    const action = text(p.action, 80); const title = text(item.title ?? item.name) || `${fullName}: ${kind}`;
    await prisma.githubEvent.createMany({ data: [{ workspaceId: connection.workspaceId, repoId: repo.id, deliveryId: `${delivery}:${connection.workspaceId}`, kind, action, title, url, actorLogin: text(obj(p.sender).login, 80), payload: { number: typeof p.number === "number" ? p.number : typeof item.number === "number" ? item.number : 0, conclusion: text(item.conclusion), notified: false } }], skipDuplicates: true });
  }
  return Response.json({ ok: true });
}
export async function dispatchGithubEvents() {
  const events = await prisma.githubEvent.findMany({ where: { payload: { path: ["notified"], equals: false }, workspace: { status: "ACTIVE", archivedAt: null } }, include: { repo: true, workspace: { select: { slug: true } } }, take: 100, orderBy: { receivedAt: "asc" } });
  for (const event of events) {
    const delivered = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "GithubEvent" WHERE id = ${event.id} AND "workspaceId" = ${event.workspaceId} FOR UPDATE`;
      const current = await tx.githubEvent.findFirst({ where: { id: event.id, workspaceId: event.workspaceId, payload: { path: ["notified"], equals: false } } });
      if (!current) return null;
      let result: Awaited<ReturnType<typeof dispatch>> | null = null;
      const payload = obj(event.payload); const common = { title: event.title, url: `/w/${event.workspace.slug}/settings/integrations`, scope: { githubRepoId: event.repoId ?? undefined, projectId: event.repo?.linkedProjectId ?? undefined }, dedupeKey: `github:${event.id}`, data: { repoId: event.repoId ?? "", number: Number(payload.number ?? 0), url: event.url ?? "" } };
      if (event.kind === "pull_request" && event.action === "opened") result = await dispatch(event.workspaceId, { ...common, type: "github.pr.opened" }, { tx });
      else if (event.kind === "pull_request" && event.action === "review_requested") result = await dispatch(event.workspaceId, { ...common, type: "github.review.requested" }, { tx });
      else if (event.kind === "issues" && event.action === "opened") result = await dispatch(event.workspaceId, { ...common, type: "github.issue.opened" }, { tx });
      else if (["check_run", "workflow_run"].includes(event.kind) && payload.conclusion === "failure") result = await dispatch(event.workspaceId, { ...common, type: "github.ci.failed", data: { repoId: common.data.repoId, runId: event.id, branch: null, url: event.url ?? "" } }, { tx });
      else if (event.kind === "release" && event.action === "published") result = await dispatch(event.workspaceId, { ...common, type: "github.release.published", data: { repoId: common.data.repoId, tag: event.title, url: event.url ?? "" } }, { tx });
      await tx.githubEvent.updateMany({ where: { id: event.id, workspaceId: event.workspaceId }, data: { payload: { ...payload, notified: true } as Prisma.InputJsonValue } });
      return result;
    });
    await delivered?.afterCommit();
  }
}
