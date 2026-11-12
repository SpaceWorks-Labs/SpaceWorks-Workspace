// Generated from app/account/organisations/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { prisma } from "@/lib/db";
import { formatDayTime } from "@/lib/format/datetime";
import { getInstanceSettings } from "@/lib/instanceSettings";
import { listRequestsForUser } from "@/lib/orgRequests/service";
import { describeRequest } from "@/lib/orgRequests/summary";
import { requireAuth } from "@/lib/permissions";

export async function loadOrganisationRequestsPage() {
const user = await requireAuth();
const [requests, profile, settings] = await Promise.all([
    listRequestsForUser(user.id),
    prisma.user.findUnique({ where: { id: user.id }, select: { timezone: true } }),
    getInstanceSettings(["workspaces.requireApproval"]),
  ]);
const requireApproval = settings["workspaces.requireApproval"]?.trim().toLowerCase() !== "false";
const timeZone = profile?.timezone || "UTC";
const items = requests.map((request) => ({
    id: request.id,
    summary: describeRequest(request, request.workspaceName),
    status: request.status,
    createdAt: formatDayTime(request.createdAt, timeZone),
    decisionNote: request.decisionNote,
    message: request.message,
    editable: request.kind === "NEW_ORG" && request.status === "PENDING"
      ? { name: request.requestedName ?? "", slug: request.requestedSlug ?? "", message: request.message ?? "" }
      : null,
    openHref: request.status === "APPROVED" && request.workspaceOpen && request.workspaceSlug
      ? request.kind === "NEW_ORG" ? `/w/${request.workspaceSlug}` : `/w/${request.workspaceSlug}/settings/plan`
      : null,
  }));
return viewDto({ requireApproval, items } as const);
}
