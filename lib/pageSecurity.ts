import { NextResponse, type NextRequest } from "next/server";
import { extraCspSources } from "@/lib/pageSecurity/extra";

/** Per-request CSP nonce and frame/transform headers for HTML pages. */
export function buildContentSecurityPolicy(nonce: string, isProduction = process.env.NODE_ENV === "production") {
  const extra = extraCspSources();
  const withExtra = (base: string, origins: string[]) => [base, ...origins].join(" ");
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    withExtra("form-action 'self' https://accounts.google.com", extra.formAction),
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    withExtra(`connect-src 'self'${process.env.NEXT_PUBLIC_BACKEND_ORIGIN && /^https?:\/\/[a-zA-Z0-9.-]+(?::[0-9]+)?$/.test(process.env.NEXT_PUBLIC_BACKEND_ORIGIN) ? ` ${process.env.NEXT_PUBLIC_BACKEND_ORIGIN}` : ""}`, extra.connect),
    ...(extra.frame.length > 0 ? [withExtra("frame-src 'self'", extra.frame)] : []),
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isProduction ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    ...(isProduction ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

export function pageSecurity(request: NextRequest) {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = btoa(String.fromCharCode(...bytes));
  const csp = buildContentSecurityPolicy(nonce);
  const incoming = new Headers(request.headers);
  incoming.set("Content-Security-Policy", csp);
  incoming.set("x-nonce", nonce);
  incoming.set("x-sw-path", request.nextUrl.pathname);
  const response = NextResponse.next({ request: { headers: incoming } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Cache-Control", "no-transform");
  response.headers.set("X-Frame-Options", "DENY");
  return response;
}
