import "server-only";
import { prisma } from "@/lib/db";
import { dailyBars, mergeRollups, uptimePercent, worstStatus } from "./stats";
import { activeOccurrence, nextOccurrence } from "./maintenance";
import { checkRateLimitById, getClientIpFromHeaders } from "@/lib/rateLimit";

export const publicHeaders = { "Cache-Control": "public, max-age=30, s-maxage=30, stale-while-revalidate=30", "X-Content-Type-Options": "nosniff" };
export async function publicRateAllowed(headers: Headers) { return checkRateLimitById("apiRead", `monitor-status:${getClientIpFromHeaders(headers)}`); }
/** Explicit allowlist of public fields. Targets, config, credentials and raw outcomes never leave this module. */
export async function publicSummary(slug: string, now = new Date()) {
  const page = await prisma.statusPage.findFirst({ where: { enabled: true, workspace: { slug, status: "ACTIVE", archivedAt: null } }, select: { id: true, workspaceId: true, title: true, descriptionMd: true, footerMd: true, noindex: true, showUptimePercent: true, showPastIncidentsDays: true, components: { where: { monitor: { workspace: { slug, status: "ACTIVE", archivedAt: null } } }, orderBy: { sortOrder: "asc" }, select: { monitorId: true, key: true, displayName: true, group: true, showLatency: true, monitor: { select: { enabled: true, lastStatus: true } } } } } });
  if (!page) return null;
  const ids = page.components.map(c => c.monitorId), since = new Date(now.getTime() - 90 * 86400000);
  const rollups = await prisma.monitorRollup.findMany({ where: { workspaceId: page.workspaceId, monitorId: { in: ids }, granularity: "DAY", bucketStart: { gte: since } } });
  const components = page.components.map(c => {
    const rows = rollups.filter(r => r.monitorId === c.monitorId), summary = mergeRollups(rows);
    return { key: c.key, displayName: c.displayName, group: c.group, status: c.monitor.enabled ? c.monitor.lastStatus : "PAUSED", uptime: page.showUptimePercent ? uptimePercent(summary) : null, latencyP95: c.showLatency ? summary.latencyP95 : null, bars: dailyBars(rows, 90, now).map(b => ({ day: b.day.toISOString().slice(0, 10), uptime: b.uptime })), ...(c.showLatency ? { latency: rows.map(r => r.latencyAvg) } : {}) };
  });
  const incidents = await prisma.incident.findMany({ where: { workspaceId: page.workspaceId, public: true, monitors: { some: { monitorId: { in: ids }, monitor: { workspaceId: page.workspaceId } } }, OR: [{ status: { not: "RESOLVED" } }, { resolvedAt: { gte: new Date(now.getTime() - page.showPastIncidentsDays * 86400000) } }] }, orderBy: { startedAt: "desc" }, take: 50, select: { number: true, title: true, source: true, status: true, impact: true, startedAt: true, resolvedAt: true, monitors: { where: { monitorId: { in: ids } }, select: { monitorId: true } }, updates: { where: { public: true }, orderBy: { createdAt: "asc" }, select: { status: true, bodyMd: true, createdAt: true } } } });
  const windows = await prisma.maintenanceWindow.findMany({ where: { workspaceId: page.workspaceId, showOnStatusPage: true, OR: [{ allMonitors: true }, { monitors: { some: { monitorId: { in: ids } } } }] }, select: { title: true, descriptionMd: true, startsAt: true, endsAt: true, rrule: true, durationMin: true, timezone: true } });
  return { title: page.title, description: page.descriptionMd, footer: page.footerMd, noindex: page.noindex, overallStatus: worstStatus(components.map(c => c.status)) ?? "UNKNOWN", components,
    incidents: incidents.map(i => ({ number: i.number, title: i.source === "AUTO" ? `${page.components.find(c => c.monitorId === i.monitors[0]?.monitorId)?.displayName ?? "Service"} interruption` : i.title, status: i.status, impact: i.impact, startedAt: i.startedAt.toISOString(), resolvedAt: i.resolvedAt?.toISOString() ?? null, updates: i.updates.map(u => ({ status: u.status, body: i.source === "AUTO" ? `${u.status === "RESOLVED" ? "Service recovered" : "Investigating"}.` : u.bodyMd, createdAt: u.createdAt.toISOString() })) })),
    maintenance: windows.flatMap(w => { const occurrence = activeOccurrence(w, now) ?? nextOccurrence(w, now); return occurrence && occurrence.start.getTime() <= now.getTime() + 30 * 86400000 ? [{ title: w.title, description: w.descriptionMd, startsAt: occurrence.start.toISOString(), endsAt: occurrence.end.toISOString() }] : []; }), updatedAt: now.toISOString() };
}
export function escapeXml(text: string) { return text.replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!); }
export function statusBadge(label: string, value: string, status: string) {
  const token = status === "UP" ? "--sw-teal" : status === "DOWN" ? "--yy-danger-solid" : "--sw-ink";
  // Standalone SVG has its own brand token declarations because CSS cannot cross an <img> boundary.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="28" role="img" aria-label="${escapeXml(`${label}: ${value}`)}"><style>:root{--sw-ink:rgb(20,44,42);--sw-teal:rgb(0,110,99);--sw-cream:rgb(255,244,232);--yy-danger-solid:rgb(185,28,28)}</style><rect width="300" height="28" rx="6" fill="var(${token})"/><text x="150" y="19" text-anchor="middle" fill="var(--sw-cream)" font-family="sans-serif" font-size="12">${escapeXml(`${label.slice(0, 30)}: ${value}`)}</text></svg>`;
}
