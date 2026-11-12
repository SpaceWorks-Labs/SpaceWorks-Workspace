// Generated from app/admin/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { loadAdminDashboard } from "@/lib/admin/dashboard";
import { requireSuperAdminMfa } from "@/lib/permissions";

export async function loadAdminOverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
await requireSuperAdminMfa();
const query = await searchParams;
const dashboard = await loadAdminDashboard({ range: query.range, sort: query.sort });
return viewDto({ dashboard } as const);
}
