import type { Metadata } from "next";
import { SimpleShell } from "@/components/chrome/SimpleShell";
import { MyRequestsList } from "@/components/orgs/MyRequestsList";
import { RequestOrganisationForm } from "@/components/orgs/RequestOrganisationForm";
import { Card, CardHeader, EmptyState, PageHeader, SectionHeading } from "@/components/ui/display";
import { prisma } from "@/lib/db";
import { formatDayTime } from "@/lib/format/datetime";
import { getInstanceSettings } from "@/lib/instanceSettings";
import { listRequestsForUser } from "@/lib/orgRequests/service";
import { describeRequest } from "@/lib/orgRequests/summary";
import { requireAuth } from "@/lib/permissions";

export const metadata: Metadata = { title: "Your organisations" };

export default async function OrganisationRequestsPage() {
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
  return (
    <SimpleShell backHref="/" backLabel="Back">
      <div className="flex flex-col gap-8">
        <PageHeader
          title="Your organisations"
          description={requireApproval
            ? "Start a new organisation for your community. The instance admin approves each one and you get an email with the decision."
            : "Start a new organisation for your community. It's ready straight away and you're its owner."}
        />
        <section id="request" className="scroll-mt-24">
          <Card>
            <CardHeader title={requireApproval ? "Request an organisation" : "Create an organisation"} />
            <RequestOrganisationForm requireApproval={requireApproval} />
          </Card>
        </section>
        <section className="flex flex-col gap-3">
          <SectionHeading title="Your requests" />
          {items.length === 0 ? <EmptyState title="No requests yet.">Requests you send show up here with their status.</EmptyState> : <MyRequestsList items={items} />}
        </section>
      </div>
    </SimpleShell>
  );
}
