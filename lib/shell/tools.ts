import "server-only";
import type { WorkspaceContext } from "@/lib/permissions";
import { isSuperAdminEmail } from "@/lib/permissions";
import { canContribute } from "@/lib/roles";
import { navForMember } from "@/lib/nav";
import { navContextFor } from "@/lib/navContext";
import { settingsTabsFor } from "@/lib/settingsTabs";
import { listUserWorkspaces } from "@/lib/workspaces";
import { searchActor } from "@/lib/shell/context";
import { shellMessage } from "@/lib/shell/messages";
import { pinnedLinks } from "@/lib/shell/links";

/** Settings tabs offered as palette commands (the rest stay one click away in the settings tabs). */
const SETTINGS_COMMANDS: Record<string, string> = { export: "Workspace export", import: "CSV import", retention: "Retention and locale" };

/**
 * Command palette data. Every "Go to" command comes from the same nav and
 * settings-tab rules as the sidebar (lib/navContext.ts), so the palette never
 * offers a page that would 404 for this member.
 */
export async function workspaceToolsData(context: WorkspaceContext) {
  const { workspace, user, membership } = context;
  const [workspaces, pinned, navContext] = await Promise.all([
    listUserWorkspaces(user.id),
    pinnedLinks(searchActor(context)),
    navContextFor(workspace, membership),
  ]);
  const t = (key: Parameters<typeof shellMessage>[1]) =>
    shellMessage(workspace.defaultLocale, key);
  const base = `/w/${workspace.slug}`;
  const nav = navForMember(workspace.slug, navContext);
  const visible = new Set(nav.flatMap((group) => group.items.map((item) => item.key)));
  const commands: Array<{
    label: string;
    href?: string;
    theme?: boolean;
    create?: "task" | "doc";
  }> = nav.flatMap((group) =>
    group.items.map((item) => ({
      label: `Go to ${item.label.toLowerCase()}`,
      href: item.href,
    })),
  );
  if (workspace.status === "ACTIVE")
    commands.push({ label: "Go to notifications", href: `${base}/notifications` });
  commands.push(
    ...workspaces.map((w) => ({
      label: `Switch workspace: ${w.name}`,
      href: `/w/${w.slug}`,
    })),
    { label: t("theme"), theme: true },
  );
  if (isSuperAdminEmail(user.email))
    commands.push({ label: "Open instance admin", href: "/admin" });
  if (canContribute(membership) && workspace.status === "ACTIVE") {
    if (visible.has("docs")) commands.unshift({ label: t("createDoc"), create: "doc" });
    commands.unshift({ label: t("createTask"), create: "task" });
  }
  for (const tab of settingsTabsFor(workspace.slug, navContext))
    if (SETTINGS_COMMANDS[tab.key]) commands.push({ label: SETTINGS_COMMANDS[tab.key]!, href: tab.href });
  return {
    commands,
    pinned: visible.has("links") ? pinned : [],
    userId: user.id,
    slug: workspace.slug,
    locale: workspace.defaultLocale,
  };
}
