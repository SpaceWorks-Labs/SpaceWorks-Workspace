import "server-only";

import { prisma } from "@/lib/db";
import type { RecentActivity } from "./types";

const TAKE = 8;

/**
 * Latest instance audit events, organisation requests and sign-ups. Names and
 * emails only, as the console's users and requests pages already show; audit
 * metadata and IP addresses stay out.
 */
export async function loadRecentActivity(): Promise<RecentActivity> {
  const [audit, requests, signUps] = await Promise.all([
    prisma.auditEvent.findMany({
      where: { action: { startsWith: "admin." } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: TAKE,
      select: { id: true, action: true, createdAt: true, actor: { select: { name: true, email: true } }, workspace: { select: { id: true, name: true } } },
    }),
    prisma.orgRequest.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: TAKE,
      select: { id: true, kind: true, status: true, requestedName: true, createdAt: true, requestedBy: { select: { name: true, email: true } }, workspace: { select: { name: true } } },
    }),
    prisma.user.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: TAKE,
      select: { id: true, name: true, email: true, createdAt: true, emailVerified: true },
    }),
  ]);
  return {
    audit: audit.map((event) => ({ id: event.id, action: event.action, at: event.createdAt.toISOString(), actor: event.actor, org: event.workspace })),
    requests: requests.map((request) => ({
      id: request.id, kind: request.kind, status: request.status, name: request.requestedName ?? request.workspace?.name ?? null,
      at: request.createdAt.toISOString(), requester: request.requestedBy,
    })),
    signUps: signUps.map((user) => ({ id: user.id, name: user.name, email: user.email, at: user.createdAt.toISOString(), verified: Boolean(user.emailVerified) })),
  };
}
