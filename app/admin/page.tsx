import { AdminDashboard } from "@/components/admin/dashboard/AdminDashboard";
import { loadAdminDashboard } from "@/lib/admin/dashboard";
import { requireSuperAdminMfa } from "@/lib/permissions";

export const metadata = { title: "Overview" };

export default async function AdminOverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireSuperAdminMfa();
  const query = await searchParams;
  const dashboard = await loadAdminDashboard({ range: query.range, sort: query.sort });
  return <AdminDashboard data={dashboard} />;
}
