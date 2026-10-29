import "server-only";

import { frontendOrigin } from "@/lib/frontend/config";
import { GATEWAY_HEADER, isFrontendPeer } from "@/lib/frontend/peer";

/** Keep browser CSRF checks valid across the authenticated split gateway. */
export function hasAllowedRequestOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  try {
    if (request.headers.has(GATEWAY_HEADER)) {
      // Caddy may overwrite forwarded-host with the API hostname. Only an
      // authenticated peer may use the separately configured frontend origin.
      return isFrontendPeer(request.headers) && origin === frontendOrigin();
    }
    if (!origin) return true;
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    return Boolean(host) && new URL(origin).host === host;
  } catch {
    return false;
  }
}
