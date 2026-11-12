"use client";

import { usePathname } from "next/navigation";
import { NavTabs } from "@/components/ui/tabs";

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/settings", label: "Instance settings" },
  { href: "/admin/organisations", label: "Organisations" },
  { href: "/admin/requests", label: "Requests" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/sign-in", label: "Sign-in" },
  { href: "/admin/sso", label: "SSO" },
  { href: "/admin/backups", label: "Backups" },
  { href: "/admin/jobs", label: "Jobs" },
  { href: "/admin/observability", label: "Observability" },
  { href: "/admin/outbox", label: "Email outbox" },
];

export function AdminTabs() {
  const pathname = usePathname() ?? "";
  return <NavTabs label="Instance admin" items={TABS.map((tab) => ({ ...tab, active: tab.href === "/admin" ? pathname === "/admin" : pathname.startsWith(tab.href) }))} />;
}
