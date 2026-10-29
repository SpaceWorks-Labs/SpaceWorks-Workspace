import "server-only";

import type { Membership, Workspace } from "@prisma/client";
import { findWorkspaceForUser, getCurrentUser, type SessionUser } from "@/lib/permissions";
import { hasAllowedRequestOrigin } from "@/lib/requestOrigin";

/**
 * Route-handler helpers for the docs and files areas (uploads with progress,
 * presence pings, exports, old-version downloads). Server Actions get
 * same-origin protection from Next.js; these POST handlers require a custom
 * request header, which a cross-site form cannot send and a cross-origin
 * fetch cannot send without a CORS preflight we never answer, plus a
 * matching Origin when the browser sends one.
 */

export const CLIENT_HEADER = "x-sw-client";

export type RouteActor = { user: SessionUser; workspace: Workspace; membership: Membership };

export async function routeActor(slug: string): Promise<RouteActor | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const access = await findWorkspaceForUser(slug, user.id);
  return access ? { user, ...access } : null;
}

export function isTrustedMutation(request: Request): boolean {
  return request.headers.get(CLIENT_HEADER) === "1" && hasAllowedRequestOrigin(request);
}

export function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export const notFoundResponse = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
