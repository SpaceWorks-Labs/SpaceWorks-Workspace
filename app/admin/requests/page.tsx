import Link from "next/link";
import { Pager } from "@/components/admin/Pager";
import { RequestCard } from "@/components/admin/requests/RequestCard";
import { EmptyState, PageHeader } from "@/components/ui/display";
import { cn } from "@/lib/cn";
import { formatDate, viewerTimeZone } from "@/lib/format/datetime";
import { REQUEST_KINDS, REQUEST_STATUSES } from "@/lib/admin/filterOptions";
import { listRequests } from "@/lib/admin/requestQueue";
import { describeRequest } from "@/lib/orgRequests/summary";
import { requireSuperAdminMfa } from "@/lib/permissions";

export const metadata = { title: "Requests" };

type SearchParams = { kind?: string; status?: string; page?: string };
const pill = (active: boolean) => cn("rounded-full border px-3 py-1.5 text-label", active ? "border-line-strong bg-muted text-ink" : "border-line bg-panel text-ink-muted hover:bg-subtle");

export default async function AdminRequestsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireSuperAdminMfa();
  const params = await searchParams;
  const { rows, total, page, pages, status } = await listRequests({ kind: params.kind, status: params.status, page: Number(params.page) || 1 });
  const tz = viewerTimeZone();
  const href = (next: SearchParams) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries({ kind: params.kind, status, ...next })) if (value) search.set(key, value);
    return `/admin/requests?${search.toString()}`;
  };
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Requests" description={`${total} ${status.toLowerCase()}. Oldest first, so nothing waits behind newer ones.`} />
      <div className="flex flex-col gap-3">
        <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
          {REQUEST_STATUSES.map((value) => <Link key={value} className={pill(status === value)} href={href({ status: value, page: undefined })}>{value.charAt(0) + value.slice(1).toLowerCase()}</Link>)}
        </nav>
        <nav aria-label="Filter by kind" className="flex flex-wrap gap-2">
          <Link className={pill(!params.kind)} href={href({ kind: "", page: undefined })}>All kinds</Link>
          {REQUEST_KINDS.map((value) => <Link key={value} className={pill(params.kind === value)} href={href({ kind: value, page: undefined })}>{{ NEW_ORG: "New organisation", MORE_LIMIT: "More capacity", FEATURE: "Feature", OTHER: "Other" }[value]}</Link>)}
        </nav>
      </div>
      {rows.length === 0 ? <EmptyState title="Nothing in this queue.">New requests from owners and members appear here.</EmptyState> : (
        <div className="flex flex-col gap-4">
          {rows.map((row) => (
            <RequestCard
              key={row.id}
              data={{
                id: row.id, kind: row.kind, status: row.status,
                title: describeRequest(row, row.workspace?.name ?? null),
                requester: `${row.requestedBy.name ?? "No name"} (${row.requestedBy.email})`,
                message: row.message, decisionNote: row.decisionNote, createdLabel: formatDate(row.createdAt, tz),
                workspaceHref: row.workspaceId ? `/admin/organisations/${row.workspaceId}` : null,
              }}
            />
          ))}
        </div>
      )}
      <Pager basePath="/admin/requests" params={{ kind: params.kind, status }} page={page} pages={pages} />
    </div>
  );
}
