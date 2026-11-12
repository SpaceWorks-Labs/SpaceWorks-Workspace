import "server-only";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { getObsSettings, type ObsSettings } from "./keys";
import { checkWorkspaceHost, hostMatchesAllowlist, parseHttpsOrigin, parseLinkoutUrl } from "./hosts";
import { isWorkspaceProvider, type WorkspaceMode, type WorkspaceProvider } from "./config";

export type ConnectionConfig = { key?: string; host?: string; projectId?: string; siteUrl?: string; url?: string; dashboardIds?: string[] };
export type ResolvedConnection = {
  provider: WorkspaceProvider;
  /** `off` and `linkout` never send data; `linkout` carries only a link. */
  source: "instance" | "workspace" | "linkout" | "off";
  active: boolean;
  config: ConnectionConfig;
  /** Decrypted server-side secret (Metabase embedding secret). Never send to a browser. */
  secret: string | null;
  reason?: string;
};

export const PROJECT_ID = /^[a-z0-9]{4,32}$/i;
export const POSTHOG_KEY = /^phc_[A-Za-z0-9]{10,100}$/;
export const DASHBOARD_ID = /^[0-9]{1,9}$/;

type Row = { enabled: boolean; mode: string; publicConfig: unknown; secretEnc: string | null };
const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");

function readSecret(row: Row): string | null {
  if (!row.secretEnc) return null;
  try {
    return decryptSecret("workspace-analytics", row.secretEnc);
  } catch {
    return null;
  }
}

function instanceConnection(provider: WorkspaceProvider, s: ObsSettings): ResolvedConnection {
  const base = { provider, source: "instance" as const, secret: null };
  switch (provider) {
    case "posthog": return { ...base, active: s.posthog.enabled && Boolean(s.posthog.key), config: { key: s.posthog.key ?? undefined, host: s.posthog.host } };
    case "clarity": return { ...base, active: s.clarity.enabled && Boolean(s.clarity.projectId), config: { projectId: s.clarity.projectId ?? undefined } };
    case "grafana": return { ...base, active: Boolean(s.grafana.url), config: { url: s.grafana.url ?? undefined } };
    case "metabase": return { ...base, active: s.metabase.enabled && Boolean(s.metabase.siteUrl && s.metabase.secretKey), config: { siteUrl: s.metabase.siteUrl ?? undefined, dashboardIds: s.metabase.adminDashboardIds }, secret: s.metabase.secretKey };
  }
}

/** Is the workspace's own config complete and its host acceptable? Static checks only (no DNS). */
export async function validateOwnConnection(provider: WorkspaceProvider, row: Pick<Row, "publicConfig" | "secretEnc">, s: ObsSettings, opts: { dns?: boolean } = {}): Promise<{ ok: true; config: ConnectionConfig } | { ok: false; error: string }> {
  const cfg = asRecord(row.publicConfig);
  if (provider === "clarity") {
    const projectId = str(cfg.projectId);
    return PROJECT_ID.test(projectId) ? { ok: true, config: { projectId } } : { ok: false, error: "Enter the Clarity project id." };
  }
  if (provider === "posthog") {
    const key = str(cfg.key);
    if (!POSTHOG_KEY.test(key)) return { ok: false, error: "Enter the PostHog project key (it starts with phc_)." };
    const host = await checkWorkspaceHost(str(cfg.host), s.overrides.hostAllowlist, { dns: opts.dns ?? false });
    return host.ok ? { ok: true, config: { key, host: host.origin } } : { ok: false, error: host.error };
  }
  if (provider === "grafana") {
    const link = parseLinkoutUrl(str(cfg.url));
    return link.ok ? { ok: true, config: { url: link.url } } : link;
  }
  const dashboardIds = Array.isArray(cfg.dashboardIds) ? cfg.dashboardIds.map(String).filter((id) => DASHBOARD_ID.test(id)) : [];
  const site = await checkWorkspaceHost(str(cfg.siteUrl), s.overrides.hostAllowlist, { dns: opts.dns ?? false });
  if (!site.ok) return { ok: false, error: site.error };
  if (!row.secretEnc) return { ok: false, error: "Add the Metabase embedding secret." };
  return { ok: true, config: { siteUrl: site.origin, dashboardIds } };
}

/**
 * Precedence for one provider in one workspace:
 * overrides disallowed or provider not listed -> instance default;
 * `off` -> nothing sent; `own` (complete and valid) replaces the instance
 * config and is never sent alongside it; `inherit` -> instance default;
 * `linkout` -> a link only. Clarity additionally needs the owner's opt-in.
 */
export async function resolveWorkspaceConnection(provider: WorkspaceProvider, workspaceId: string, preload?: { settings?: ObsSettings; row?: Row | null }): Promise<ResolvedConnection> {
  const settings = preload?.settings ?? (await getObsSettings());
  const row = preload && "row" in preload ? preload.row ?? null : await prisma.workspaceAnalyticsConnection.findUnique({ where: { workspaceId_provider: { workspaceId, provider } } });
  const instance = instanceConnection(provider, settings);
  const off = (reason: string): ResolvedConnection => ({ provider, source: "off", active: false, config: {}, secret: null, reason });
  const canOverride = settings.overrides.allowed && settings.overrides.providers.includes(provider);

  if (provider === "clarity") {
    if (!row || !row.enabled || row.mode === "off") return off("The workspace owner has not enabled Clarity.");
    if (row.mode === "own" && canOverride) {
      const own = await validateOwnConnection(provider, row, settings);
      return own.ok ? { provider, source: "workspace", active: true, config: own.config, secret: null } : off(own.error);
    }
    return instance;
  }
  if (!row || !canOverride || row.mode === "inherit" || (!row.enabled && row.mode !== "off")) return instance;
  if (row.mode === "off") return off("This workspace turned this tool off.");
  if (row.mode === "linkout") {
    const link = parseLinkoutUrl(str(asRecord(row.publicConfig).url));
    return link.ok ? { provider, source: "linkout", active: false, config: { url: link.url }, secret: null } : off(link.error);
  }
  if (row.mode === "own" && provider !== "grafana") {
    const own = await validateOwnConnection(provider, row, settings);
    return own.ok ? { provider, source: "workspace", active: true, config: own.config, secret: readSecret(row) } : off(own.error);
  }
  return instance;
}

/** Re-check an own-config host at use time (tunnels, signing): allow-listed and https, with DNS. */
export async function ownHostStillAllowed(origin: string, settings: ObsSettings): Promise<boolean> {
  const parsed = parseHttpsOrigin(origin);
  if (!parsed.ok || !hostMatchesAllowlist(parsed.url.hostname, settings.overrides.hostAllowlist)) return false;
  return (await checkWorkspaceHost(origin, settings.overrides.hostAllowlist)).ok;
}

export { isWorkspaceProvider };
export type { WorkspaceMode };
