import { resourcePaths } from "@/lib/frontend/resources";
import { isIP } from "node:net";
import { CLIENT_IP_HEADER, GATEWAY_HEADER, isFrontendPeer } from "@/lib/frontend/peer";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { pageSecurity } from "@/lib/pageSecurity";
import { checkRateLimit } from "@/lib/rateLimit";

function tooMany(apiV1 = false) {
  return NextResponse.json(
    apiV1 ? { error: { code: "RATE_LIMITED", message: "Too many requests. Try again later." } } : { error: "Too many requests. Try again later." },
    { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } },
  );
}

/**
 * Request gate: distributed rate limits for Server Actions, API routes and
 * Auth.js mutations, plus CSP nonce and security headers on pages.
 * Authentication itself happens in pages/layouts/route handlers, never here.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (request.headers.has(GATEWAY_HEADER)) {
    if (!isFrontendPeer(request.headers)) return new NextResponse("Not found", { status: 404 });
    const ip = request.headers.get(CLIENT_IP_HEADER)?.trim();
    const header = process.env.TRUSTED_PROXY_IP_HEADER;
    if (header && ["x-real-ip", "x-forwarded-for", "cf-connecting-ip"].includes(header)) request.headers.set(header, ip && isIP(ip) ? ip : "unknown");
  }
  // Machine integrations, public capability handlers and metadata keep their routes.
  if (process.env.DEPLOYMENT_MODE === "backend" && !resourcePaths.some(pattern => pattern.test(pathname)) && !pathname.startsWith("/api/") && !pathname.startsWith("/blog/") && !pathname.startsWith("/status/") && !/\/(opengraph-image|twitter-image)(?:\/|$)/.test(pathname)) return new NextResponse("Not found", { status: 404 });


  // Server Actions post to page URLs. One ceiling before the per-action limits.
  if (request.method === "POST" && request.headers.has("next-action")) {
    if (!(await checkRateLimit(request, "action"))) return tooMany();
  }

  // Liveness must not depend on Redis; everything else under /api is limited.
  // The SSE stream has its own per-user limit inside the route.
  if (pathname.startsWith("/api") && pathname !== "/api/health" && pathname !== "/api/metrics" && !pathname.startsWith("/api/realtime/")) {
    // Read-only page views from the verified website (split hosting) get their own budget: one page view
    // and its link prefetches fan out into many gateway reads for the same visitor.
    const gatewayView = request.headers.has(GATEWAY_HEADER) && pathname.startsWith("/api/frontend/view/");
    if (!(await checkRateLimit(request, gatewayView ? "frontendView" : "global"))) return tooMany(pathname.startsWith("/api/v1"));
  }

  // Auth.js polls session/CSRF with GETs; only mutating auth requests use the strict bucket.
  if (pathname.startsWith("/api/auth") && request.method !== "GET") {
    if (!(await checkRateLimit(request, "auth"))) return tooMany();
  }

  if (pathname.startsWith("/api")) {
    const forwarded = new Headers(request.headers);
    forwarded.set("x-sw-path", pathname);
    const response = NextResponse.next({ request: { headers: forwarded } });
    response.headers.set("X-Frame-Options", "DENY");
    return response;
  }

  return pageSecurity(request);
}

export const config = {
  matcher: [
    "/api/:path*",
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|brand/).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
