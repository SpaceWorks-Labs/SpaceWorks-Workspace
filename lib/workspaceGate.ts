import "server-only";

import type { Membership, Workspace } from "@prisma/client";
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { getWorkspaceModules } from "@/lib/limits/modules";
import { isModuleEnabled, moduleRouteForPath, type ModuleKey } from "@/lib/modules";
import { getRedis } from "@/lib/redis";
import { hasRoleAtLeast } from "@/lib/roles";
import { hasValidSuperAdminMfaProof, SUPER_ADMIN_MFA_COOKIE } from "@/lib/superAdminMfa";

/**
 * What requireWorkspace and friends return as the caller's membership. A real
 * row, or (for the super admin) a synthetic OWNER context with `viaSuperAdmin`
 * set. The synthetic one is never stored; its `id` is "" (falsy, matches no
 * row), so code that looks a membership up by id simply finds nothing.
 */
export type WorkspaceMembership = Membership & { viaSuperAdmin?: boolean };

export type GateOptions = { module?: ModuleKey };

/** Pathname set by proxy.ts for pages, Server Action posts and route handlers; null outside a request. */
export async function requestPath(): Promise<string | null> {
  try {
    return (await headers()).get("x-sw-path");
  } catch {
    return null;
  }
}

/** A suspended organisation shows its owners and admins only the plan page and settings home. */
function suspendedPathAllowed(path: string | null, slug: string): boolean {
  if (!path) return false;
  const clean = path.split(/[?#]/)[0]!.replace(/\/+$/, "").toLowerCase();
  const base = `/w/${slug.toLowerCase()}/settings`;
  return clean === base || clean === `${base}/plan`;
}

/**
 * Status and module gate for a real member. Returns false when the workspace
 * must look like it does not exist: PENDING/REJECTED for everyone; SUSPENDED
 * unless an owner or admin is on /settings or /settings/plan (a missing
 * x-sw-path counts as not allowed); a module the super admin switched off.
 */
export async function passesWorkspaceGate(workspace: Workspace, membership: Pick<Membership, "role">, options: GateOptions = {}): Promise<boolean> {
  const path = await requestPath();
  if (workspace.status === "PENDING" || workspace.status === "REJECTED") return false;
  if (workspace.status === "SUSPENDED") return hasRoleAtLeast(membership.role, "ADMIN") && suspendedPathAllowed(path, workspace.slug);
  const route = path ? moduleRouteForPath(path) : null;
  const key = options.module ?? route?.module ?? null;
  if (!key) return true;
  const modules = await getWorkspaceModules(workspace.id);
  if (!isModuleEnabled(modules, key)) return false;
  const sub = !options.module && route?.sub ? `${key}.${route.sub}` : null;
  return !(sub && modules.disabledModules.includes(sub));
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();

export function isSuperAdminEmail(email: string | null | undefined) {
  const configured = process.env.SUPER_ADMIN_EMAIL;
  return Boolean(configured && email && normalizeEmail(email) === normalizeEmail(configured));
}

const AUDIT_WINDOW_SECONDS = 12 * 60 * 60;
const MEMORY_KEY = Symbol.for("sww.superAdminAccess");
type GlobalWithMemory = typeof globalThis & { [MEMORY_KEY]?: Map<string, number> };

const memoryWindow = () => ((globalThis as GlobalWithMemory)[MEMORY_KEY] ??= new Map<string, number>());

/** Forget a window key so a failed audit write is retried on the next access. */
async function clearAccessWindow(workspaceId: string, userId: string) {
  const key = `sww:admin-access:${workspaceId}:${userId}`;
  memoryWindow().delete(key);
  try {
    await getRedis()?.del(key);
  } catch {
    // Best effort: worst case the audit is deduped until the key expires.
  }
}

/** True the first time per workspace and admin within 12 hours (Redis when configured, else memory). */
async function firstAccessInWindow(workspaceId: string, userId: string): Promise<boolean> {
  const key = `sww:admin-access:${workspaceId}:${userId}`;
  const redis = getRedis();
  if (redis) {
    try {
      return (await redis.set(key, "1", "EX", AUDIT_WINDOW_SECONDS, "NX")) === "OK";
    } catch {
      // Fall back to process memory.
    }
  }
  const memory = memoryWindow();
  const now = Date.now();
  if ((memory.get(key) ?? 0) > now) return false;
  memory.set(key, now + AUDIT_WINDOW_SECONDS * 1000);
  return true;
}

/**
 * Silent super-admin access: the configured super admin with a fresh MFA
 * proof gets a synthetic OWNER context.
 * Without a valid proof they are an ordinary non-member. No row is created.
 */
export async function superAdminMembership(workspace: Workspace, user: { id: string; email: string }, isSuperAdmin: boolean): Promise<WorkspaceMembership | null> {
  if (!isSuperAdmin) return null;
  let proof: string | undefined;
  try {
    proof = (await cookies()).get(SUPER_ADMIN_MFA_COOKIE)?.value;
  } catch {
    return null;
  }
  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { mfaEnabledAt: true, sessionVersion: true, disabledAt: true } });
  if (!row?.mfaEnabledAt || row.disabledAt || !hasValidSuperAdminMfaProof(proof, user.id, row.sessionVersion)) return null;
  if (await firstAccessInWindow(workspace.id, user.id)) {
    try {
      await recordAuditEvent({ action: "admin.workspace_accessed", workspaceId: workspace.id, actorId: user.id, targetType: "Workspace", targetId: workspace.id });
    } catch {
      await clearAccessWindow(workspace.id, user.id);
    }
  }
  const now = new Date();
  return { id: "", userId: user.id, workspaceId: workspace.id, role: "OWNER", title: null, status: "ACTIVE", joinedAt: now, updatedAt: now, viaSuperAdmin: true };
}
