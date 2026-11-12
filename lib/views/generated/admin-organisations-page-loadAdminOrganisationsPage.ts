// Generated from app/admin/organisations/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { listOrganisations } from "@/lib/admin/orgList";
import { viewerTimeZone } from "@/lib/format/datetime";
import { requireSuperAdminMfa } from "@/lib/permissions";
type SearchParams = { status?: string; q?: string; page?: string };
export async function loadAdminOrganisationsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
await requireSuperAdminMfa();
const params = await searchParams;
const { rows, total, page, pages } = await listOrganisations({ status: params.status, q: params.q, page: Number(params.page) || 1 });
const tz = viewerTimeZone();
return viewDto({ rows, total, page, pages, tz } as const);
}
