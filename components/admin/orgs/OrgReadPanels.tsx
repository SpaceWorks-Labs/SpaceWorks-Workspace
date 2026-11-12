import { Card, CardHeader, Chip, DetailList, EmptyState } from "@/components/ui/display";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { OrgStatusChip } from "@/components/admin/orgs/OrgStatusChip";
import { Pager } from "@/components/admin/Pager";
import { formatDate, formatDayTime } from "@/lib/format/datetime";
import { describeRequest } from "@/lib/orgRequests/summary";
import type { loadOrgAudit, loadOrgOverview, loadOrgRequests } from "@/lib/admin/orgDetail";

type Overview = NonNullable<Awaited<ReturnType<typeof loadOrgOverview>>>;
const person = (p: { name: string | null; email: string } | null | undefined) => (p ? `${p.name ?? "No name"} (${p.email})` : "None");

export function OrgOverviewPanel({ overview, tz }: { overview: Overview; tz: string }) {
  const { workspace, request, owners } = overview;
  return (
    <Card>
      <CardHeader title="Overview" />
      <DetailList
        items={[
          { label: "Status", value: <OrgStatusChip status={workspace.status} /> },
          ...(workspace.statusReason ? [{ label: "Reason", value: workspace.statusReason }] : []),
          ...(workspace.suspendedAt ? [{ label: "Suspended", value: formatDate(workspace.suspendedAt, tz) }] : []),
          { label: "Plan", value: workspace.limits?.plan ?? "None" },
          { label: "Owners", value: owners.length ? owners.map((o) => person(o)).join(", ") : "None" },
          { label: "Created", value: formatDate(workspace.createdAt, tz) },
          { label: "Requested by", value: request ? person(request.requestedBy) : "Created by the instance admin" },
          ...(request ? [{ label: "Decision", value: `${request.status.toLowerCase()}${request.decidedAt ? ` on ${formatDate(request.decidedAt, tz)} by ${person(request.decidedBy)}` : ""}${request.decisionNote ? `: ${request.decisionNote}` : ""}` }] : []),
        ]}
      />
    </Card>
  );
}

export function OrgAuditPanel({ slug, audit, tz, id }: { slug: string; id: string; audit: Awaited<ReturnType<typeof loadOrgAudit>>; tz: string }) {
  if (audit.events.length === 0) return <EmptyState title="No audit events yet." />;
  return (
    <div className="flex flex-col gap-4">
      <Table label={`Audit log for ${slug}`}>
        <THead><tr><TH>When</TH><TH>Action</TH><TH>By</TH></tr></THead>
        <TBody>
          {audit.events.map((event) => (
            <TR key={event.id}>
              <TD className="whitespace-nowrap text-ink-muted">{formatDayTime(event.createdAt, tz)}</TD>
              <TD className="font-sans tabular-nums text-caption">{event.action}</TD>
              <TD>{event.actor ? person(event.actor) : "System"}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <Pager basePath={`/admin/organisations/${id}`} params={{ tab: "audit" }} page={audit.page} pages={audit.pages} />
    </div>
  );
}

type OrgRequestRow = Omit<Awaited<ReturnType<typeof loadOrgRequests>>[number], "payload"> & { payload: unknown };

export function OrgRequestsPanel({ requests, tz }: { requests: OrgRequestRow[]; tz: string }) {
  if (requests.length === 0) return <EmptyState title="No requests from this organisation." />;
  return (
    <Table label="Requests">
      <THead><tr><TH>Request</TH><TH>Status</TH><TH>By</TH><TH>Created</TH></tr></THead>
      <TBody>
        {requests.map((r) => (
          <TR key={r.id}>
            <TD><span className="block font-semibold">{describeRequest({ kind: r.kind, requestedName: null, payload: r.payload }, null)}</span>{r.message ? <span className="block text-caption text-ink-muted">{r.message}</span> : null}{r.decisionNote ? <span className="block text-caption text-ink-muted">Decision: {r.decisionNote}</span> : null}</TD>
            <TD><Chip tone={r.status === "APPROVED" ? "success" : r.status === "PENDING" ? "info" : "neutral"} size="sm">{r.status.toLowerCase()}</Chip></TD>
            <TD>{person(r.requestedBy)}</TD>
            <TD className="whitespace-nowrap text-ink-muted">{formatDate(r.createdAt, tz)}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
