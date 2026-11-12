import "server-only";

import type { Workspace } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isModuleEnabled } from "@/lib/modules";
import { getWorkspaceModules } from "@/lib/limits/modules";

export type PublicWorkspace = Pick<Workspace, "id" | "slug" | "name" | "status">;

/**
 * Public campaign routes live outside /w, so the page and module gates in
 * lib/permissions do not run. Resolve the workspace here: it must be ACTIVE
 * and have the campaigns module on, otherwise the caller answers 404.
 */
export async function resolvePublicWorkspace(where: { id: string } | { slug: string }): Promise<PublicWorkspace | null> {
  const workspace = await prisma.workspace.findUnique({ where, select: { id: true, slug: true, name: true, status: true } });
  if (!workspace || workspace.status !== "ACTIVE") return null;
  return isModuleEnabled(await getWorkspaceModules(workspace.id), "campaigns") ? workspace : null;
}

/** Headers for every public campaign response. */
export const PUBLIC_HEADERS: Record<string, string> = {
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex",
  "Cache-Control": "no-store",
};

export function publicJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: PUBLIC_HEADERS });
}

export function publicRedirect(request: Request, path: string): Response {
  return new Response(null, { status: 303, headers: { ...PUBLIC_HEADERS, Location: new URL(path, request.url).toString() } });
}

export function publicNotFound(): Response {
  return new Response("Not found", { status: 404, headers: PUBLIC_HEADERS });
}
