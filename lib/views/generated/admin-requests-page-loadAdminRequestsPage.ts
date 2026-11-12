// Generated from app/admin/requests/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { cn } from "@/lib/cn";
import { viewerTimeZone } from "@/lib/format/datetime";
import { listRequests } from "@/lib/admin/requestQueue";
import { requireSuperAdminMfa } from "@/lib/permissions";
type SearchParams = { kind?: string; status?: string; page?: string };
const pill = (active: boolean) => cn("rounded-full border px-3 py-1.5 text-label", active ? "border-line-strong bg-muted text-ink" : "border-line bg-panel text-ink-muted hover:bg-subtle");
export async function loadAdminRequestsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
await requireSuperAdminMfa();
const params = await searchParams;
const { rows, total, page, pages, status } = await listRequests({ kind: params.kind, status: params.status, page: Number(params.page) || 1 });
const tz = viewerTimeZone();
const href = (next: SearchParams) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries({ kind: params.kind, status, ...next })) if (value) search.set(key, value);
    return `/admin/requests?${search.toString()}`;
  };
return viewDto({ rows, total, page, pages, status, tz } as const);
}
