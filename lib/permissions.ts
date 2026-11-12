import "server-only";

import type { Workspace } from "@prisma/client";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hasRoleAtLeast } from "@/lib/roles";
import { hasValidSuperAdminMfaProof, SUPER_ADMIN_MFA_COOKIE } from "@/lib/superAdminMfa";
import type { WorkspaceRole } from "@prisma/client";
import { isSuperAdminEmail, passesWorkspaceGate, superAdminMembership, type GateOptions, type WorkspaceMembership } from "@/lib/workspaceGate";

export type { GateOptions, WorkspaceMembership } from "@/lib/workspaceGate";

export * from "@/lib/roles";

export type SessionUser = { id: string; name: string | null; email: string; image: string | null };

/** The signed-in, enabled user (read from the database), or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, image: true, disabledAt: true },
  });
  if (!user || user.disabledAt) return null;
  return { id: user.id, name: user.name, email: user.email, image: user.image };
});

/** /login, carrying the page the visitor asked for (the proxy's x-sw-path) so sign-in can return there. */
async function signInUrl(): Promise<string> {
  try {
    const path = (await headers()).get("x-sw-path");
    if (path && path !== "/" && path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/api/") && path !== "/login") {
      return `/login?callbackUrl=${encodeURIComponent(path)}`;
    }
  } catch {
    // Outside a request (scripts, tests): plain sign-in.
  }
  return "/login";
}

/** Pages and actions: redirect to /login when signed out (or disabled), then back to the page afterwards. */
export async function requireAuth(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect(await signInUrl());
  return user;
}

export type WorkspaceContext = {
  user: SessionUser;
  workspace: Workspace;
  /** A real row, or a synthetic OWNER context (`viaSuperAdmin`, `id` "") for the super admin. */
  membership: WorkspaceMembership;
};

/**
 * Resolve a workspace by slug for the signed-in user. Non-members, suspended
 * members, archived workspaces and unknown slugs all get the same notFound(),
 * so a slug never reveals whether a workspace exists. Members below
 * `minRole` also get notFound() (the page simply does not exist for them).
 * Workspaces that are not ACTIVE, and modules switched off for the workspace
 * (read from the x-sw-path header, or `options.module`), are notFound() too;
 * see `passesWorkspaceGate`. The signed-in super admin (with fresh MFA) gets a
 * silent synthetic OWNER membership in any workspace.
 */
export const requireWorkspace = cache(async (slug: string, minRole: WorkspaceRole = "GUEST", options: GateOptions = {}): Promise<WorkspaceContext> => {
  const user = await requireAuth();
  const context = await findWorkspaceForUser(slug, user.id, options);
  if (!context || !hasRoleAtLeast(context.membership.role, minRole)) notFound();
  return { user, ...context };
});

/** Non-throwing lookup used by route handlers (which return their own 404). */
export async function findWorkspaceForUser(slug: string, userId: string, options: GateOptions = {}): Promise<{ workspace: Workspace; membership: WorkspaceMembership } | null> {
  if (typeof slug !== "string" || slug.length === 0 || slug.length > 64) return null;
  const workspace = await prisma.workspace.findUnique({ where: { slug } });
  if (!workspace || workspace.archivedAt) return null;
  const membership = await prisma.membership.findUnique({ where: { userId_workspaceId: { userId, workspaceId: workspace.id } } });
  const real = membership?.status === "ACTIVE" && membership.role === "OWNER" && (await passesWorkspaceGate(workspace, membership, options));
  if (real) return { workspace, membership: membership! };
  // Not an admitted OWNER: the super admin (with fresh MFA) gets full silent access even with a lower real membership.
  if (process.env.SUPER_ADMIN_EMAIL) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (user && isSuperAdminEmail(user.email)) {
      const synthetic = await superAdminMembership(workspace, { id: userId, email: user.email }, true);
      if (synthetic) return { workspace, membership: synthetic };
    }
  }
  if (membership?.status === "ACTIVE" && (await passesWorkspaceGate(workspace, membership, options))) return { workspace, membership };
  return null;
}

/**
 * Server Action variant: never redirects or throws notFound (those would
 * surface as navigation in the client); returns null so the action can
 * respond `{ error }`.
 */
export async function getWorkspaceForAction(slug: string, minRole: WorkspaceRole = "GUEST", options: GateOptions = {}): Promise<WorkspaceContext | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const context = await findWorkspaceForUser(slug, user.id, options);
  if (!context || !hasRoleAtLeast(context.membership.role, minRole)) return null;
  return { user, ...context };
}

export { isSuperAdminEmail } from "@/lib/workspaceGate";

/**
 * Instance super-admin: the signed-in user whose email matches
 * SUPER_ADMIN_EMAIL. Everyone else gets notFound() so the panel's existence
 * is not revealed.
 */
export async function requireSuperAdmin(): Promise<Session & { user: { id: string; email: string } }> {
  const session = await auth();
  if (!session?.user?.id) redirect(await signInUrl());
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { email: true, disabledAt: true } });
  if (!user || user.disabledAt || !isSuperAdminEmail(user.email)) notFound();
  return { ...session, user: { ...session.user, id: session.user.id, email: user.email } } as Session & { user: { id: string; email: string } };
}

/**
 * Super-admin plus a fresh, separate TOTP step-up. Every app/admin/**\/page.tsx
 * must call this itself: layouts do not re-run on client navigation.
 */
export async function requireSuperAdminMfa() {
  const session = await requireSuperAdmin();
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { mfaEnabledAt: true, sessionVersion: true } });
  const proof = (await cookies()).get(SUPER_ADMIN_MFA_COOKIE)?.value;
  if (!user?.mfaEnabledAt || !hasValidSuperAdminMfaProof(proof, session.user.id, user.sessionVersion)) {
    redirect("/admin-mfa");
  }
  return session;
}
