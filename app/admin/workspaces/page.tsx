import { redirect } from "next/navigation";
import { requireSuperAdminMfa } from "@/lib/permissions";

/** Workspaces now live under Organisations. */
export default async function AdminWorkspacesPage() {
  await requireSuperAdminMfa();
  redirect("/admin/organisations");
}
