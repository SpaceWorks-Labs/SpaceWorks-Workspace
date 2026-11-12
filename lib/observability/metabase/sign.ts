import { SignJWT } from "jose";

/** Metabase static embedding tokens never live longer than this. */
export const MAX_EMBED_TTL_SECONDS = 600;
const DEFAULT_TTL_SECONDS = 300;

/** Parse "1, 2,3" into unique positive integers. Anything else is dropped. */
export function parseDashboardIds(raw: unknown): number[] {
  const items = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  const ids = items.map((item) => Number(String(item).trim())).filter((n) => Number.isSafeInteger(n) && n > 0);
  return [...new Set(ids)];
}

export class EmbedRefused extends Error {}

export type SignInput = {
  secret: string;
  dashboardId: number;
  /** The scope's dashboard allow-list: instance `adminDashboardIds` or the workspace's own ids. */
  allowed: readonly number[];
  /** Server-derived workspace id. Always wins over anything in `params`. Omit for instance dashboards. */
  workspaceId?: string;
  /** Extra locked parameters. A client-supplied `workspace_id` is discarded. */
  params?: Record<string, unknown>;
  ttlSeconds?: number;
  now?: Date;
};

/** HS256 Metabase embedding token for one allow-listed dashboard. */
export async function signDashboardToken(input: SignInput): Promise<string> {
  if (!input.secret) throw new EmbedRefused("Metabase embedding is not configured.");
  if (!Number.isSafeInteger(input.dashboardId) || !input.allowed.includes(input.dashboardId)) throw new EmbedRefused("That dashboard is not available.");
  const ttl = Math.min(MAX_EMBED_TTL_SECONDS, Math.max(30, input.ttlSeconds ?? DEFAULT_TTL_SECONDS));
  const params: Record<string, unknown> = { ...(input.params ?? {}) };
  delete params.workspace_id;
  if (input.workspaceId) params.workspace_id = input.workspaceId;
  const issued = Math.floor((input.now ?? new Date()).getTime() / 1000);
  return new SignJWT({ resource: { dashboard: input.dashboardId }, params })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(issued)
    .setExpirationTime(issued + ttl)
    .sign(new TextEncoder().encode(input.secret));
}

/** The iframe URL Metabase serves for a signed token. The site URL must already be validated https. */
export function embedUrl(siteUrl: string, token: string) {
  return `${siteUrl.replace(/\/+$/, "")}/embed/dashboard/${token}#bordered=false&titled=true`;
}
