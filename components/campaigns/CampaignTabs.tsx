"use client";

import { usePathname } from "next/navigation";
import { NavTabs } from "@/components/ui/tabs";

/** Underline tabs shared by every email campaigns page. */
export function CampaignTabs({ slug }: { slug: string }) {
  const pathname = usePathname() ?? "";
  const base = `/w/${slug}/campaigns`;
  const sub = (path: string) => pathname === `${base}/${path}` || pathname.startsWith(`${base}/${path}/`);
  const items = [
    { href: base, label: "Campaigns", active: !["lists", "subscribers", "templates", "settings"].some(sub) },
    { href: `${base}/lists`, label: "Lists", active: sub("lists") },
    { href: `${base}/subscribers`, label: "Subscribers", active: sub("subscribers") },
    { href: `${base}/templates`, label: "Templates", active: sub("templates") },
    { href: `${base}/settings`, label: "Settings", active: sub("settings") },
  ];
  return <NavTabs label="Email campaigns" items={items} />;
}
