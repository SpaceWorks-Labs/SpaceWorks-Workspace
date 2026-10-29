import { hasAllowedRequestOrigin } from "@/lib/requestOrigin";

/**
 * Small HTTP helpers for the assistant's cookie-authenticated route handlers
 * (chat stream, boardroom transcript, markdown export). Server Actions have
 * built-in origin checks; route handlers do not, so mutating ones require a
 * same-origin request with a JSON body (which a cross-site form cannot send).
 */
export function isSameOriginJsonRequest(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  if (!hasAllowedRequestOrigin(request)) return false;
  return (request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json");
}

export const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } as const;

export function notFoundResponse() {
  return new Response("Not found", { status: 404, headers: PRIVATE_HEADERS });
}
