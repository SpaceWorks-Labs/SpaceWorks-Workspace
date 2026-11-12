import { Card, CardHeader, ProgressBar } from "@/components/ui/display";
import { formatBytes } from "@/lib/limits/format";
import type { Limits } from "@/lib/limits";
import type { WorkspaceUsage } from "@/lib/limits/usage";

export function OrgUsagePanel({ usage, limits }: { usage: WorkspaceUsage; limits: Limits }) {
  const rows: Array<{ label: string; used: number; cap: number | null; fmt?: (n: number) => string }> = [
    { label: "Members", used: usage.members, cap: limits.maxMembers },
    { label: "Guests", used: usage.guests, cap: limits.maxGuests },
    { label: "Projects", used: usage.projects, cap: limits.maxProjects },
    { label: "Storage", used: usage.storageBytes, cap: limits.maxStorageBytes, fmt: formatBytes },
    { label: "API tokens", used: usage.apiTokens, cap: limits.maxApiTokens },
    { label: "Webhooks", used: usage.webhooks, cap: limits.maxWebhooks },
    { label: "Assistant tokens this month", used: usage.assistantTokensThisMonth, cap: limits.assistantMonthlyTokens },
    { label: "Emails this month", used: usage.emailsThisMonth, cap: limits.monthlyEmailCap },
  ];
  return (
    <Card>
      <CardHeader title="Usage" description="Live counts against the effective limits." />
      <ul className="grid gap-4 sm:grid-cols-2">
        {rows.map((row) => {
          const fmt = row.fmt ?? ((n: number) => n.toLocaleString("en"));
          return (
            <li key={row.label} className="flex flex-col gap-1.5">
              <span className="flex justify-between text-body-ui text-ink"><span>{row.label}</span><span className="tabular-nums text-ink-muted">{fmt(row.used)}{row.cap === null ? " (unlimited)" : ` / ${fmt(row.cap)}`}</span></span>
              {row.cap !== null && row.cap > 0 ? <ProgressBar label={`${row.label} used`} value={row.used} max={row.cap} tone={row.used >= row.cap ? "warning" : "accent"} /> : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
