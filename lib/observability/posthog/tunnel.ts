import "server-only";
import { getCurrentUser } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { getObsSettings } from "../keys";
import { verifyObsToken } from "../identity";
import { ownHostStillAllowed, resolveWorkspaceConnection } from "../workspaceConfig";
import { readCapped } from "../sentry/tunnel";

export const POSTHOG_TUNNEL_MAX_BYTES = 256 * 1024;
const EXACT = new Set(["/e", "/capture", "/decide", "/flags", "/i/v0/e"]);
const STATIC = /^\/static\/[A-Za-z0-9._-]{1,100}$/;
const QUERY_KEYS = new Set(["ip", "_", "ver", "compression", "retry_count", "beacon"]);
const notFound = () => new Response(null, { status: 404 });

/** Whitelist of PostHog paths the tunnel may forward. Rejects `..`, encodings and empty segments. */
export function allowedPosthogPath(segments: readonly string[]): string | null {
  if (segments.length === 0 || segments.some((s) => !s || s === "." || s === ".." || /[%\\]/.test(s) || s.includes(".."))) return null;
  const path = `/${segments.join("/")}`.replace(/\/$/, "");
  return EXACT.has(path) || STATIC.test(path) ? path : null;
}

function forwardedQuery(search: string): string {
  const out = new URLSearchParams();
  for (const [key, value] of new URLSearchParams(search)) if (QUERY_KEYS.has(key) && value.length <= 64) out.append(key, value);
  const text = out.toString();
  return text ? `?${text}` : "";
}

async function resolveTarget(workspaceId: string | null, userId: string): Promise<string | null> {
  const settings = await getObsSettings();
  if (!workspaceId) return settings.posthog.enabled && settings.posthog.key ? settings.posthog.host : null;
  const member = await prisma.membership.findFirst({ where: { workspaceId, userId, status: "ACTIVE" }, select: { id: true } });
  if (!member) return null;
  const resolved = await resolveWorkspaceConnection("posthog", workspaceId, { settings });
  if (!resolved.active || !resolved.config.host) return null;
  if (resolved.source === "workspace" && !(await ownHostStillAllowed(resolved.config.host, settings))) return null;
  return resolved.config.host;
}

/**
 * The workspace comes from a short-lived signed token minted by the page (never
 * from a query parameter) and must belong to the signed-in user.
 */
export async function handlePosthogTunnel(request: Request, segments: string[], fetchImpl: typeof fetch = fetch): Promise<Response> {
  const path = allowedPosthogPath(segments);
  if (!path || (request.method !== "GET" && request.method !== "POST")) return notFound();
  const user = await getCurrentUser();
  if (!user) return notFound();
  const header = request.headers.get("x-sww-obs");
  const token = header ? verifyObsToken(header) : null;
  if (header && (!token || token.u !== user.id)) return notFound();
  const host = await resolveTarget(token?.w ?? null, user.id);
  if (!host) return notFound();
  let body: BodyInit | undefined;
  if (request.method === "POST") {
    const bytes = await readCapped(request, POSTHOG_TUNNEL_MAX_BYTES);
    if (!bytes) return new Response(null, { status: 413 });
    body = bytes as unknown as BodyInit;
  }
  const headers: Record<string, string> = {};
  for (const name of ["content-type", "content-encoding"]) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }
  try {
    const upstream = await fetchImpl(`${host}${path}${forwardedQuery(new URL(request.url).search)}`, {
      method: request.method, headers, body, redirect: "manual", signal: AbortSignal.timeout(10_000),
    });
    if (upstream.status >= 300 && upstream.status < 400) return new Response(null, { status: 502 });
    const out = new Headers({ "cache-control": request.method === "GET" ? "public, max-age=3600" : "no-store" });
    const type = upstream.headers.get("content-type");
    if (type) out.set("content-type", type);
    return new Response(upstream.body, { status: upstream.status, headers: out });
  } catch {
    return new Response(null, { status: 502 });
  }
}
