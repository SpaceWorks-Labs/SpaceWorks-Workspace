import { ProgressBar } from "@/components/ui/display";
import { formatBytes } from "@/lib/limits/format";
import type { Limits } from "@/lib/limits";
import type { WorkspaceUsage } from "@/lib/limits/usage";

type Bar = { label: string; used: number; cap: number | null; text: string };

function bars(usage: WorkspaceUsage, limits: Limits): Bar[] {
  return [
    { label: "Members", used: usage.members, cap: limits.maxMembers, text: `${usage.members}${limits.maxMembers === null ? "" : ` / ${limits.maxMembers}`}` },
    { label: "Projects", used: usage.projects, cap: limits.maxProjects, text: `${usage.projects}${limits.maxProjects === null ? "" : ` / ${limits.maxProjects}`}` },
    { label: "Storage", used: usage.storageBytes, cap: limits.maxStorageBytes, text: `${formatBytes(usage.storageBytes)}${limits.maxStorageBytes === null ? "" : ` / ${formatBytes(limits.maxStorageBytes)}`}` },
  ];
}

/** Compact usage versus limit bars; unlimited kinds show the count only. */
export function OrgUsageBars({ usage, limits }: { usage: WorkspaceUsage; limits: Limits }) {
  return (
    <ul className="flex min-w-44 flex-col gap-1.5">
      {bars(usage, limits).map((bar) => (
        <li key={bar.label}>
          <span className="flex justify-between gap-2 text-caption text-ink-muted"><span>{bar.label}</span><span className="tabular-nums">{bar.text}</span></span>
          {bar.cap !== null && bar.cap > 0 ? <ProgressBar label={`${bar.label} used`} value={bar.used} max={bar.cap} tone={bar.used >= bar.cap ? "warning" : "accent"} /> : null}
        </li>
      ))}
    </ul>
  );
}
