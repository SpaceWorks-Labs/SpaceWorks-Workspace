import "server-only";
import { resourcePaths } from "./resources";
import { NextResponse } from "next/server";
import { backendHeaders, backendUrl } from "./request";
import { backendOrigin, frontendOrigin } from "./config";

const blocked = /^\/api\/(?:frontend(?:\/|$)|internal(?:\/|$)|health\/db(?:\/|$))/i;
const forwardedRequestHeaders = ["accept", "content-type", "authorization", "user-agent", "if-none-match", "range", "if-range", "x-sw-client", "x-auth-return-redirect", "x-hub-signature-256", "x-github-delivery", "x-github-event", "x-slack-request-timestamp", "x-slack-signature", "x-signature-timestamp", "x-signature-ed25519", "x-telegram-bot-api-secret-token", "mcp-protocol-version", "mcp-session-id", "last-event-id"];
const forwardedResponseHeaders = ["content-type", "cache-control", "etag", "content-disposition", "content-range", "accept-ranges", "retry-after", "vary", "x-content-type-options", "referrer-policy", "x-accel-buffering", "content-security-policy", "permissions-policy", "www-authenticate", "allow", "mcp-session-id"];

export async function proxyBackendResource(request: Request) { return proxyRequest(request, true); }
export async function proxyBackendApi(request: Request) { return proxyRequest(request, false); }
async function proxyRequest(request: Request, resource: boolean) {
  const url = new URL(request.url);
  let decodedPath: string;
  try { decodedPath = decodeURIComponent(url.pathname); } catch { return new NextResponse("Not found", { status: 404 }); }
  if ((resource ? !resourcePaths.some(pattern => pattern.test(url.pathname)) : !url.pathname.startsWith("/api/")) || /%2f|%5c/i.test(url.pathname) || decodedPath.includes("\\") || decodedPath.includes("%") || blocked.test(decodedPath)) return new NextResponse("Not found", { status: 404 });
  const safe = request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS";
  // These endpoints authenticate signed provider payloads or hashed heartbeat
  // capabilities on the backend. They never inherit browser session authority.
  const provider = /^\/api\/(?:integrations\/(?:github\/webhook|(?:slack|discord|telegram|whatsapp|mattermost)\/[^/]+\/.+)|app-reviews\/slack\/events|hb\/[^/]+(?:\/[^/]+)?)$/.test(url.pathname);
  // CLI endpoints authenticate device codes or bearer tokens, never browser cookies.
  const cli = url.pathname.startsWith("/api/cli/") || url.pathname.startsWith("/api/v1/auth/universal/");
  const machine = provider || cli || (url.pathname.startsWith("/api/v1/") || url.pathname === "/api/mcp") && request.headers.get("authorization")?.startsWith("Bearer ");
  if (!safe && !machine && request.headers.get("origin") !== frontendOrigin()) return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const outgoing = await backendHeaders(request.headers);
  if (provider || cli) outgoing.delete("cookie");
  for (const name of forwardedRequestHeaders) {
    const value = request.headers.get(name);
    if (value) outgoing.set(name, value);
  }
  try {
    const init: RequestInit & { duplex?: "half"; } = {
      method: request.method, headers: outgoing, redirect: "manual", cache: "no-store",
      signal: AbortSignal.timeout(60_000),
      ...(!safe && request.body ? { body: request.body, duplex: "half" as const } : {}),
    };
    const upstream = await fetch(backendUrl(url.pathname + url.search), init);
    const responseHeaders = new Headers({ "X-Frame-Options": "DENY" });
    for (const name of forwardedResponseHeaders) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    for (const value of upstream.headers.getSetCookie()) responseHeaders.append("set-cookie", value);
    const location = upstream.headers.get("location");
    if (location) {
      const target = new URL(location, backendOrigin());
      responseHeaders.set("location", target.origin === backendOrigin() ? frontendOrigin() + target.pathname + target.search + target.hash : target.href);
    }
    return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    console.error("[frontend] Backend request failed");
    return NextResponse.json({ error: "The server could not be reached. Try again shortly." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
