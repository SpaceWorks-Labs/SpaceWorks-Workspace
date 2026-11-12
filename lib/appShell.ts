import "server-only";
import { pinnedLinks } from "@/lib/shell/links";
import type { Workspace } from "@prisma/client";
import { countUnreadNotifications } from "@/lib/notifications";
import { navForMember, type ResolvedNavGroup } from "@/lib/nav";
import { navContextFor } from "@/lib/navContext";
import { isSuperAdminEmail, type SessionUser, type WorkspaceMembership } from "@/lib/permissions";
import { roleLabel } from "@/lib/roles";
import { listUserWorkspaces, type UserWorkspace } from "@/lib/workspaces";

export type ShellData = {
  user: { name: string | null; email: string; image: string | null };
  workspace: { slug: string; name: string; roleLabel: string };
  workspaces: UserWorkspace[];
  nav: ResolvedNavGroup[];
  unreadNotifications: number;
  pinned: { id: string; title: string; url: string }[];
  isSuperAdmin: boolean;
};

export async function getShellData(user: SessionUser, workspace: Workspace, membership: WorkspaceMembership): Promise<ShellData> {
  const [workspaces, unread, pinned, navContext] = await Promise.all([listUserWorkspaces(user.id), countUnreadNotifications(user.id, workspace.id), pinnedLinks({ workspaceId: workspace.id, userId: user.id, role: membership.role }), navContextFor(workspace, membership)]);
  const nav = navForMember(workspace.slug, navContext);
  // Pinned links open /links, so they follow the Links nav item (role, Knowledge module, suspension).
  const linksVisible = nav.some((group) => group.items.some((item) => item.key === "links"));
  return {
    user: { name: user.name, email: user.email, image: user.image },
    workspace: { slug: workspace.slug, name: workspace.name, roleLabel: membership.viaSuperAdmin ? "Super admin" : roleLabel(membership.role) },
    workspaces,
    pinned: linksVisible ? pinned : [],
    nav,
    unreadNotifications: unread,
    isSuperAdmin: isSuperAdminEmail(user.email),
  };
}
