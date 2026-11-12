import type { Metadata } from "next";
import { cookies } from "next/headers";
import { SimpleShell } from "@/components/chrome/SimpleShell";
import { AdminTabs } from "@/components/admin/AdminTabs";
import { lastWorkspacePath } from "@/lib/homePath";
import { requireSuperAdminMfa } from "@/lib/permissions";
import { LAST_WORKSPACE_COOKIE } from "@/lib/workspaceCookie";
import { listUserWorkspaces } from "@/lib/workspaces";

export const metadata: Metadata = { title: { default: "Instance admin", template: "%s · Instance admin" } };

/**
 * Checked here for the chrome; every page also calls requireSuperAdminMfa() itself.
 * The console is the super admin's home, so "back" goes to a workspace they belong to
 * (never "/", which leads back here), or to their account when they have none.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSuperAdminMfa();
  const workspace = lastWorkspacePath({ workspaces: await listUserWorkspaces(session.user.id), lastSlug: (await cookies()).get(LAST_WORKSPACE_COOKIE)?.value });
  return (
    <SimpleShell nav={<AdminTabs />} backHref={workspace ?? "/account"} backLabel={workspace ? "Back to workspace" : "Your account"}>
      {children}
    </SimpleShell>
  );
}
