import { RequestStatusChip } from "@/components/orgs/RequestStatusChip";
import { RequestAccessButton, RequestMoreButton } from "@/components/orgs/RequestPlanButtons";
import { Callout, Card, CardHeader, Chip, EmptyState, ProgressBar } from "@/components/ui/display";
import { formatBytes } from "@/lib/limits/format";
import { describeRequest } from "@/lib/orgRequests/summary";
import type { PlanView } from "@/lib/orgRequests/plan";

const STATUS_COPY = { ACTIVE: "Active", SUSPENDED: "Suspended", PENDING: "Pending", REJECTED: "Not approved" } as const;

function amount(value: number, unit: "count" | "bytes") {
  return unit === "bytes" ? formatBytes(value) : value.toLocaleString("en");
}

export function PlanStatus({ view }: { view: PlanView }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={view.status === "ACTIVE" ? "success" : "danger"}>{STATUS_COPY[view.status]}</Chip>
        <span className="text-body-ui text-ink-muted">Plan: {view.plan ?? "Standard"}</span>
      </div>
      {view.status === "SUSPENDED" ? (
        <Callout tone="warning" title="This organisation is suspended">
          {view.statusReason ? `Reason: ${view.statusReason}. ` : ""}Members cannot open the workspace until the instance admin reactivates it. Owners and admins can still see this page and settings.
        </Callout>
      ) : null}
    </div>
  );
}

export function PlanLimits({ slug, view }: { slug: string; view: PlanView }) {
  return (
    <Card>
      <CardHeader title="Limits and usage" description="What this organisation can use. Ask for more if you are close to a limit." />
      <ul className="flex flex-col divide-y divide-line">
        {view.limits.map((row) => (
          <li key={row.key} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="text-label text-ink">{row.label}</p>
              {row.used !== null && row.limit !== null ? (
                <>
                  <ProgressBar label={`${row.label} used`} value={row.used} max={row.limit} tone={row.used >= row.limit ? "warning" : "accent"} />
                  <p className="text-caption text-ink-muted">{amount(row.used, row.unit)} of {amount(row.limit, row.unit)} used</p>
                </>
              ) : (
                <p className="text-caption text-ink-muted">
                  {row.limit === null ? "Unlimited" : amount(row.limit, row.unit)}{row.used !== null ? ` · ${amount(row.used, row.unit)} used` : ""}
                </p>
              )}
            </div>
            {row.limit !== null ? <RequestMoreButton slug={slug} limit={row.key} label={row.label} unit={row.unit} /> : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function PlanModules({ slug, view }: { slug: string; view: PlanView }) {
  const pendingModules = new Set(view.requests.filter((r) => r.status === "PENDING" && r.kind === "FEATURE").map((r) => String(r.payload.module ?? "")));
  return (
    <Card>
      <CardHeader title="Features" description="Modules switched on for this organisation." />
      <ul className="grid gap-2 sm:grid-cols-2">
        {view.modules.map((module) => (
          <li key={module.key} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
            <span className="text-body-ui text-ink">{module.label}</span>
            {module.enabled ? <Chip tone="success" size="sm">On</Chip> : pendingModules.has(module.key) ? <Chip tone="warning" size="sm">Requested</Chip> : (
              <div className="flex items-center gap-2"><Chip size="sm">Off</Chip><RequestAccessButton slug={slug} module={module.key} label={module.label} /></div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function PlanRequests({ view }: { view: PlanView }) {
  return (
    <Card>
      <CardHeader title="Your requests" />
      {view.requests.length === 0 ? <EmptyState title="No requests yet.">Ask for more capacity or a feature above.</EmptyState> : (
        <ul className="flex flex-col divide-y divide-line">
          {view.requests.map((request) => (
            <li key={request.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1">
                <p className="text-label text-ink">{describeRequest(request)}</p>
                {request.decisionNote ? <p className="text-body-ui text-ink-muted">Note from the admin: {request.decisionNote}</p> : null}
              </div>
              <RequestStatusChip status={request.status} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
