// Generated from app/admin/layout.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { cookies } from "next/headers";
import { lastWorkspacePath } from "@/lib/homePath";
import { requireSuperAdminMfa } from "@/lib/permissions";
import { LAST_WORKSPACE_COOKIE } from "@/lib/workspaceCookie";
import { listUserWorkspaces } from "@/lib/workspaces";

export async function loadAdminLayout({ children }: { children: React.ReactNode }) {
const session = await requireSuperAdminMfa();
const workspace = lastWorkspacePath({ workspaces: await listUserWorkspaces(session.user.id), lastSlug: (await cookies()).get(LAST_WORKSPACE_COOKIE)?.value });
return viewDto({ workspace } as const);
}
