"use client";

import { usePathname } from "next/navigation";
import { NavTabs } from "@/components/ui/tabs";

/** Board / Timeline / Overview / Updates / Report / Settings tabs for a project (Settings only for admins and the owner). */
export function ProjectTabs({ base, canManage }: { base: string; canManage: boolean }) {
  const pathname = usePathname();
  const items = [
    { href: base, label: "Board", active: pathname === base },
    { href: `${base}/timeline`, label: "Timeline", active: pathname === `${base}/timeline` },
    { href: `${base}/overview`, label: "Overview", active: pathname === `${base}/overview` },
    { href: `${base}/updates`, label: "Updates", active: pathname === `${base}/updates` },
    { href: `${base}/report`, label: "Report", active: pathname === `${base}/report` },
    ...(canManage ? [{ href: `${base}/settings`, label: "Settings", active: pathname === `${base}/settings` }] : []),
  ];
  return <NavTabs label="Project" items={items} />;
}
