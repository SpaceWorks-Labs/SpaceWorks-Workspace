import "server-only";
import { getInstanceSettings } from "@/lib/instanceSettings";
import { resolveWorkspaceConnection } from "@/lib/observability/workspaceConfig";
import { frameAllowed, httpsOrigin } from "./frame";
import { embedUrl, EmbedRefused, parseDashboardIds, signDashboardToken } from "./sign";

export type EmbedResult = {
  /** Dashboards the viewer may pick from (the scope's allow-list). */
  dashboards: number[];
  selected: number | null;
  /** Signed iframe URL. Null unless embedding is configured and the CSP allows framing that origin. */
  embedUrl: string | null;
  /** Plain Metabase site URL for a link-out. */
  linkUrl: string | null;
  reason?: string;
};

const none = (reason: string, extra: Partial<EmbedResult> = {}): EmbedResult => ({ dashboards: [], selected: null, embedUrl: null, linkUrl: null, reason, ...extra });

async function build(opts: { siteUrl: string | null | undefined; secret: string | null; allowed: number[]; wanted?: number; workspaceId?: string }): Promise<EmbedResult> {
  const linkUrl = httpsOrigin(opts.siteUrl);
  if (!linkUrl || !opts.secret) return none("Metabase embedding isn't set up yet.");
  if (opts.allowed.length === 0) return none("No dashboards have been shared yet.", { linkUrl });
  const selected = opts.wanted && opts.allowed.includes(opts.wanted) ? opts.wanted : opts.allowed[0];
  if (!frameAllowed(linkUrl)) return { dashboards: opts.allowed, selected, embedUrl: null, linkUrl, reason: "This instance doesn't allow framing that Metabase address, so the report opens in Metabase instead." };
  try {
    const token = await signDashboardToken({ secret: opts.secret, dashboardId: selected, allowed: opts.allowed, workspaceId: opts.workspaceId });
    return { dashboards: opts.allowed, selected, embedUrl: embedUrl(linkUrl, token), linkUrl };
  } catch (error) {
    if (error instanceof EmbedRefused) return none(error.message, { linkUrl });
    throw error;
  }
}

/** Instance dashboards for the admin console: allow-list is `obs.metabase.adminDashboardIds`. */
export async function instanceEmbed(wanted?: number): Promise<EmbedResult> {
  const s = await getInstanceSettings(["obs.metabase.enabled", "obs.metabase.siteUrl", "obs.metabase.secretKey", "obs.metabase.adminDashboardIds"]);
  if (s["obs.metabase.enabled"] !== "true") return none("Metabase is turned off.");
  return build({ siteUrl: s["obs.metabase.siteUrl"], secret: s["obs.metabase.secretKey"] ?? null, allowed: parseDashboardIds(s["obs.metabase.adminDashboardIds"]), wanted });
}

/**
 * A workspace's own dashboards. Only a workspace's own Metabase (mode `own`)
 * embeds, with its own secret and dashboard ids; the instance's admin
 * dashboards are never offered here. The workspace id is server-derived.
 */
export async function workspaceEmbed(workspaceId: string, wanted?: number): Promise<EmbedResult> {
  const conn = await resolveWorkspaceConnection("metabase", workspaceId);
  if (conn.source === "linkout") return none("This workspace links to its reports in Metabase.", { linkUrl: conn.config.url ?? null });
  if (conn.source !== "workspace" || !conn.active) return none("No reports have been connected for this workspace yet.");
  return build({ siteUrl: conn.config.siteUrl, secret: conn.secret, allowed: parseDashboardIds(conn.config.dashboardIds ?? []), wanted, workspaceId });
}
