import { ServicesTabs } from "./ServicesTabs";
import { Chip, type ChipTone } from "@/components/ui/display";
import { formatUptime } from "@/lib/monitor/stats";
const tones: Record<string, ChipTone> = { UP: "success", HEALTHY: "success", DOWN: "danger", UNHEALTHY: "danger", DEGRADED: "warning", MAINTENANCE: "info", RESOLVED: "success", INVESTIGATING: "danger", IDENTIFIED: "warning", MONITORING: "info" };
export function Status({ status }: { status: string }) { return <Chip tone={tones[status] ?? "neutral"}>{status.charAt(0) + status.slice(1).toLowerCase().replaceAll("_", " ")}</Chip>; }
export function ServicesNav({ slug, manage, costs }: { slug: string; manage: boolean; costs: boolean }) {
  const tabs = [["", "Overview"], ["/incidents", "Incidents"], ["/maintenance", "Maintenance"], ["/cloud", "Cloud resources"], ["/on-call", "On call"], ...(costs ? [["/costs", "Costs"]] : []), ...(manage ? [["/status-page", "Status page"], ["/settings", "Settings"]] : [])];
  return <ServicesTabs slug={slug} tabs={tabs} />;
}
export function Sparkline({ values, label = "Latency" }: { values: Array<number | null>; label?: string }) {
  const usable = values.filter((v): v is number => v !== null);
  if (!usable.length) return <p className="text-caption text-ink-muted">No latency data yet.</p>;
  const max = Math.max(1, ...usable), min = Math.min(...usable), span = Math.max(1, max - min);
  const points = values.map((v, i) => v === null ? null : `${(i / Math.max(1, values.length - 1)) * 280 + 4},${56 - ((v - min) / span) * 48}`).filter(Boolean).join(" ");
  return <svg viewBox="0 0 288 64" role="img" aria-label={`${label}: ${min.toFixed(0)} to ${max.toFixed(0)} milliseconds`} className="h-16 w-full text-chart-accent"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" /></svg>;
}
export function UptimeBars({ bars }: { bars: Array<{ day: string; uptime: number | null }> }) {
  return <div><div className="flex h-8 gap-px" role="img" aria-label={`${bars.length} days of uptime; ${bars.filter(b => b.uptime !== null && b.uptime < 99).length} days below 99%. Expand daily values for details.`}>{bars.map(b => <div key={b.day} className={`min-w-0 flex-1 rounded-sm ${b.uptime === null ? "bg-track" : b.uptime < 99 ? "bg-chart-danger" : "bg-chart-success"}`} title={`${b.day}: ${formatUptime(b.uptime)}`}><span className="sr-only">{b.day}: {formatUptime(b.uptime)}. </span></div>)}</div><div className="mt-2 flex justify-between text-caption text-ink-muted"><span>{bars.length} days ago</span><span>Today</span></div><details className="mt-3 text-caption"><summary className="inline-flex min-h-11 cursor-pointer items-center text-accent-text">Daily uptime values</summary><ul className="grid gap-2 sm:grid-cols-3">{bars.map(b => <li key={b.day}>{b.day}: {formatUptime(b.uptime)}</li>)}</ul></details></div>;
}
