import "server-only";
import type { WorkspaceContext } from "@/lib/permissions";
import { canContribute, canManageWorkspace } from "@/lib/roles";
import { navForMember } from "@/lib/nav";
import { listUserWorkspaces } from "@/lib/workspaces";
import { searchActor } from "@/lib/shell/context";
import { shellMessage } from "@/lib/shell/messages";
import { pinnedLinks } from "@/lib/shell/links";
export async function workspaceToolsData(context: WorkspaceContext) {
  const { workspace, user, membership } = context;
  const [workspaces, pinned] = await Promise.all([
    listUserWorkspaces(user.id),
    pinnedLinks(searchActor(context)),
  ]);
  const t = (key: Parameters<typeof shellMessage>[1]) =>
    shellMessage(workspace.defaultLocale, key);
  const base = `/w/${workspace.slug}`;
  const commands: Array<{
    label: string;
    href?: string;
    theme?: boolean;
    create?: "task" | "doc";
  }> = navForMember(workspace.slug, {
    role: membership.role,
    workspace,
  }).flatMap((group) =>
    group.items.map((item) => ({
      label: `Go to ${item.label.toLowerCase()}`,
      href: item.href,
    })),
  );
  commands.push(
    { label: t("activity"), href: `${base}/activity` },
    { label: t("links"), href: `${base}/links` },
    { label: "Go to notifications", href: `${base}/notifications` },
    {
      label: t("preferences"),
      href: `${base}/notifications/preferences`,
    },
    ...workspaces.map((w) => ({
      label: `Switch workspace: ${w.name}`,
      href: `/w/${w.slug}`,
    })),
    { label: t("theme"), theme: true },
  );
  if (canContribute(membership))
    commands.unshift(
      { label: t("createTask"), create: "task" },
      { label: t("createDoc"), create: "doc" },
    );
  if (canManageWorkspace(membership))
    commands.push(
      { label: "Workspace export", href: `${base}/settings/export` },
      { label: "CSV import", href: `${base}/settings/import` },
      { label: "Retention and locale", href: `${base}/settings/retention` },
    );
  return {
    commands,
    pinned,
    userId: user.id,
    slug: workspace.slug,
    locale: workspace.defaultLocale,
  };
}
