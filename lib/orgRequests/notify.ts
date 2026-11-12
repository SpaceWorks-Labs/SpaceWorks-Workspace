import "server-only";

import type { OrgRequestKind } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { renderOrgRequestAdminEmail, renderOrgRequestDecidedEmail, renderOrgRequestReceivedEmail } from "@/lib/email/templates-orgs";
import { dispatch } from "@/lib/notify";
import { appBaseUrl as baseUrl } from "@/lib/notify/render";
import { enqueueEmail } from "@/lib/outbox";

/** Queue a heads-up to the super admin (a plain link to the sign-in-protected queue, never a bearer link). */
export async function emailSuperAdmin(tx: DbClient, input: { summary: string; requesterName: string; message?: string | null }) {
  const to = process.env.SUPER_ADMIN_EMAIL?.trim();
  if (!to) return;
  const mail = renderOrgRequestAdminEmail({ ...input, queueUrl: `${baseUrl()}/admin/requests` });
  await enqueueEmail(tx, { to, ...mail });
}

/** Tell the requester a new-organisation request arrived and what happens next. */
export async function emailRequester(tx: DbClient, input: { to: string; summary: string }) {
  const mail = renderOrgRequestReceivedEmail({ summary: input.summary, url: `${baseUrl()}/account/organisations` });
  await enqueueEmail(tx, { to: input.to, ...mail });
}

/** Email the requester and, when a workspace exists, add the in-app `org.request_decided` notification. */
export async function notifyDecision(request: {
  id: string; kind: OrgRequestKind; requestedById: string; workspaceId: string | null; decidedById: string | null; decisionNote: string | null;
}, approved: boolean, summary: string, workspaceSlug: string | null) {
  const requester = await prisma.user.findUnique({ where: { id: request.requestedById }, select: { email: true } });
  const path = workspaceSlug ? (request.kind === "NEW_ORG" ? `/w/${workspaceSlug}` : `/w/${workspaceSlug}/settings/plan`) : "/account/organisations";
  if (requester) {
    const mail = renderOrgRequestDecidedEmail({
      summary, approved, note: request.decisionNote, url: `${baseUrl()}${path}`,
      actionLabel: approved && request.kind === "NEW_ORG" ? "Open your organisation" : "View your requests",
    });
    await enqueueEmail(prisma, { to: requester.email, ...mail });
  }
  if (!request.workspaceId) return;
  await dispatch(request.workspaceId, {
    type: "org.request_decided",
    title: `Request ${approved ? "approved" : "not approved"}: ${summary}`.slice(0, 150),
    body: request.decisionNote ?? undefined,
    url: path,
    actorId: request.decidedById,
    recipients: [request.requestedById],
    data: { requestId: request.id, kind: request.kind, status: approved ? "APPROVED" : "REJECTED", workspaceId: request.workspaceId },
  }).catch(() => undefined);
}
