import Link from "next/link";
import { cn } from "@/lib/cn";
import { ORG_STATUSES } from "@/lib/admin/filterOptions";

const STATUS_LABEL: Record<string, string> = { PENDING: "Pending", ACTIVE: "Active", SUSPENDED: "Suspended", REJECTED: "Rejected" };

/** Plain GET form: search box plus status links, no client state. */
export function OrgFilters({ status, q }: { status?: string; q?: string }) {
  const href = (value?: string) => {
    const search = new URLSearchParams();
    if (value) search.set("status", value);
    if (q) search.set("q", q);
    const text = search.toString();
    return `/admin/organisations${text ? `?${text}` : ""}`;
  };
  const pill = (active: boolean) => cn("rounded-full border px-3 py-1.5 text-label", active ? "border-line-strong bg-muted text-ink" : "border-line bg-panel text-ink-muted hover:bg-subtle");
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <form method="get" action="/admin/organisations" className="flex gap-2" role="search">
        {status ? <input type="hidden" name="status" value={status} /> : null}
        <input name="q" defaultValue={q ?? ""} maxLength={100} placeholder="Search name, address or owner email" aria-label="Search organisations" className="h-11 w-full min-w-0 rounded-md border border-line bg-panel px-3 text-body-ui text-ink md:w-80" />
        <button type="submit" className="h-11 rounded-md border border-line bg-panel px-4 text-label text-ink hover:bg-muted">Search</button>
      </form>
      <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
        <Link className={pill(!status)} href={href()}>All</Link>
        {ORG_STATUSES.map((value) => <Link key={value} className={pill(status === value)} href={href(value)}>{STATUS_LABEL[value]}</Link>)}
      </nav>
    </div>
  );
}
