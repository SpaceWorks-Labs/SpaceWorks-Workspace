// Generated from app/admin/settings/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { getInstanceSettingsForDisplay } from "@/lib/instanceSettings";
import { requireSuperAdminMfa } from "@/lib/permissions";
const isOrgDefaultKey = (key: string) => key.startsWith("limits.") || key === "modules.disabledByDefault" || key === "workspaces.requireApproval";
export async function loadAdminSettingsPage() {
await requireSuperAdminMfa();
const settings = await getInstanceSettingsForDisplay();
return viewDto({ settings } as const);
}
