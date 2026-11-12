"use client";

import { usePathname } from "next/navigation";
import { NavTabs } from "@/components/ui/tabs";
import type { ResolvedSettingsTab } from "@/lib/settingsTabs";

/** Underline tabs for the settings tabs this member may open (resolved on the server). */
export function SettingsTabsNav({ tabs }: { tabs: ResolvedSettingsTab[] }) {
  const pathname = usePathname() ?? "";
  return (
    <NavTabs
      label="Workspace settings"
      items={tabs.map((tab) => ({
        href: tab.href,
        label: tab.label,
        active: tab.key === "general" ? pathname === tab.href : pathname.startsWith(tab.href),
      }))}
    />
  );
}
