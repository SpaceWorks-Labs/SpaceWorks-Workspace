"use client";

import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronsUpDown, Inbox, LogOut, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ShellData } from "@/lib/appShell";
import { activeNavKey } from "@/lib/nav";
import { LAST_WORKSPACE_COOKIE } from "@/lib/workspaceCookie";
import { SpaceWorksLogo } from "@/components/brand/SpaceWorksLogo";
import { useAppColorMode } from "@/components/providers";
import { useRealtime } from "@/components/realtime/useRealtime";
import { Avatar } from "@/components/ui/display";
import { IconButton } from "@/components/ui/button";
import { RouteProgress } from "@/components/chrome/RouteProgress";
import { NavLink, SidebarNav } from "@/components/chrome/SidebarNav";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu";

function WorkspaceSwitcher({ data, onNavigate }: { data: ShellData; onNavigate?: () => void }) {
  return (
    <Menu>
      <MenuTrigger className="group w-full rounded-md border border-line bg-panel text-left transition-colors hover:border-line-strong">
        <span className="flex min-h-[58px] items-center gap-2.5 px-3 py-2">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-ink">{data.workspace.name}</span>
            <span className="block text-caption text-ink-muted">{data.workspace.roleLabel}</span>
          </span>
          <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-ink-muted" />
          <span className="sr-only">Switch workspace</span>
        </span>
      </MenuTrigger>
      <MenuContent align="start" className="min-w-[240px]">
        <MenuLabel>Workspaces</MenuLabel>
        {data.workspaces.map((workspace) => (
          <MenuItem key={workspace.slug} asChild>
            <Link href={`/w/${workspace.slug}`} onClick={onNavigate} aria-current={workspace.slug === data.workspace.slug ? "true" : undefined}>
              <span className={cn("min-w-0 truncate", workspace.slug === data.workspace.slug && "font-semibold")}>{workspace.name}</span>
            </Link>
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

function AccountMenu({ data, onNavigate }: { data: ShellData; onNavigate?: () => void }) {
  const { mode, toggleColorMode } = useAppColorMode();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const name = data.user.name ?? data.user.email;
  return (
    <Menu>
      <MenuTrigger
        ref={triggerRef}
        className="flex min-h-12 w-full items-center gap-2.5 rounded-md border border-line bg-panel p-2 text-left transition-colors hover:bg-surface data-[state=open]:bg-surface"
      >
        <Avatar name={name} src={data.user.image} size="sm" className="size-8 text-xs" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">{name}</span>
          {data.user.name ? <span className="block truncate text-caption text-ink-muted">{data.user.email}</span> : null}
        </span>
        <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-ink-muted" />
      </MenuTrigger>
      <MenuContent side="top" align="start" className="min-w-[232px]">
        <MenuLabel>{name}</MenuLabel>
        <MenuItem asChild>
          <Link href="/account" onClick={onNavigate}>Account settings</Link>
        </MenuItem>
        {data.isSuperAdmin ? (
          <MenuItem asChild>
            <Link href="/admin" onClick={onNavigate}>Instance admin</Link>
          </MenuItem>
        ) : null}
        <MenuItem
          icon={mode === "dark" ? <Sun /> : <Moon />}
          onSelect={() => {
            const rect = triggerRef.current?.getBoundingClientRect();
            toggleColorMode(rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined);
          }}
        >
          {mode === "dark" ? "Light mode" : "Dark mode"}
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<LogOut />} onSelect={() => void signOut({ callbackUrl: "/login" })}>
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

function NotificationsLink({ data, onNavigate }: { data: ShellData; onNavigate?: () => void }) {
  const count = data.unreadNotifications;
  const label = count > 0 ? `Notifications, ${count} unread` : "Notifications";
  return (
    <Link
      href={`/w/${data.workspace.slug}/notifications`}
      onClick={onNavigate}
      aria-label={label}
      className="relative inline-flex size-11 shrink-0 items-center justify-center rounded-md text-ink transition-colors hover:bg-sidebar-hover"
    >
      <Inbox aria-hidden className="size-5" />
      {count > 0 ? (
        <span aria-hidden className="absolute right-1 top-1 min-w-5 rounded-full bg-accent-soft px-1.5 text-center text-xs font-semibold leading-5 tabular-nums text-accent-text">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
}

function SidebarContents({ data, onNavigate, headerAction }: { data: ShellData; onNavigate?: () => void; headerAction?: ReactNode }) {
  const pathname = usePathname() ?? "";
  const active = activeNavKey(data.nav, pathname);
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-5">
      <div className="relative flex shrink-0 items-center justify-center">
        <Link href={`/w/${data.workspace.slug}`} onClick={onNavigate} aria-label="Space Works Workspace home" className="inline-flex rounded-md">
          <span className="flex flex-col items-center gap-1.5">
            <SpaceWorksLogo variant="lockup-stacked" height={64} label={null} />
            <span className="text-label font-semibold uppercase tracking-[0.18em] text-ink-muted">Workspace</span>
          </span>
        </Link>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <div className="min-w-0 flex-1"><WorkspaceSwitcher data={data} onNavigate={onNavigate} /></div>
        {headerAction ?? <NotificationsLink data={data} onNavigate={onNavigate} />}
      </div>
      <nav aria-label="Workspace" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        <SidebarNav groups={data.nav} active={active} onNavigate={onNavigate} />
        {data.pinned.length ? <div className="flex flex-col gap-0.5">
          <p className="px-3 pb-0.5 text-overline text-ink-muted">Pinned</p>
          {data.pinned.map((link) => <NavLink key={link.id} href={`/w/${data.workspace.slug}/links#${link.id}`} active={false} onNavigate={onNavigate}>{link.title}</NavLink>)}
        </div> : null}
      </nav>
      <div className="mt-auto pt-2">
        <AccountMenu data={data} onNavigate={onNavigate} />
      </div>
    </div>
  );
}

/**
 * Workspace app shell (docs/DESIGN.md §4.13): a 256px Citron sidebar with
 * text-only navigation from lib/nav.ts on desktop, and a top bar with a
 * navigation sheet below the md breakpoint. Unread notifications refresh
 * live through the workspace realtime stream.
 */
export function AppShell({ data, children }: { data: ShellData; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${LAST_WORKSPACE_COOKIE}=${encodeURIComponent(data.workspace.slug)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  }, [data.workspace.slug]);

  useRealtime(data.workspace.slug, (event) => {
    if (event.type === "notification.created") router.refresh();
  });

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <Suspense fallback={null}><RouteProgress /></Suspense>
      <aside className="sticky top-0 hidden h-dvh w-[256px] shrink-0 border-r border-line bg-sidebar md:block">
        <SidebarContents data={data} />
      </aside>

      <div className="sticky top-0 z-40 flex min-h-[72px] items-center justify-between gap-2 border-b border-line bg-canvas px-4 md:hidden">
        <Link href={`/w/${data.workspace.slug}`} aria-label="Workspace home" className="inline-flex shrink-0 items-center rounded-md">
          <SpaceWorksLogo variant="symbol" height={48} label={null} />
        </Link>
        <div className="flex items-center gap-1">
          <NotificationsLink data={data} />
          <DialogPrimitive.Root open={menuOpen} onOpenChange={setMenuOpen}>
            <DialogPrimitive.Trigger asChild>
              <IconButton label="Open navigation menu">
                <span className="text-xs font-semibold">Menu</span>
              </IconButton>
            </DialogPrimitive.Trigger>
            <DialogPrimitive.Portal>
              <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[var(--yy-overlay)]" />
              <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 w-[min(288px,86vw)] overflow-y-auto border-r border-line bg-sidebar shadow-float focus:outline-none">
                <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
                <DialogPrimitive.Description className="sr-only">Workspace navigation</DialogPrimitive.Description>
                <SidebarContents
                  data={data}
                  onNavigate={() => setMenuOpen(false)}
                  headerAction={
                    <DialogPrimitive.Close asChild>
                      <IconButton label="Close navigation menu" variant="quiet">
                        <span className="text-xs font-semibold">Close</span>
                      </IconButton>
                    </DialogPrimitive.Close>
                  }
                />
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          </DialogPrimitive.Root>
        </div>
      </div>

      <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 focus:outline-none sm:px-6 md:px-8 md:py-8">
        <div className="mx-auto w-full max-w-[1200px]">{children}</div>
      </main>
    </div>
  );
}
