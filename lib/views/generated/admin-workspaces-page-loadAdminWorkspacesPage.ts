// Generated from app/admin/workspaces/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { redirect } from "next/navigation";
import { requireSuperAdminMfa } from "@/lib/permissions";

export async function loadAdminWorkspacesPage() {
await requireSuperAdminMfa();
redirect("/admin/organisations");

}
