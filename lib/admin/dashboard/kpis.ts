import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { countOrganisationsByStatus } from "@/lib/admin/orgList";
import { countPendingRequests } from "@/lib/admin/requestQueue";
import { fillSeries, type DashboardWindow } from "./compute";
import type { DashboardKpis, GrowthSeries, Trend } from "./types";

const DAY_MS = 86_400_000;

/** Distinct people with activity-feed events in [from, to). ActivityEvent is the only per-day activity record. */
async function distinctActors(from: Date, to: Date): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(DISTINCT "actorId")::int AS n FROM "ActivityEvent"
    WHERE "actorId" IS NOT NULL AND "createdAt" >= ${from}::timestamp AND "createdAt" < ${to}::timestamp`;
  return rows[0]?.n ?? 0;
}

/** Two counts, one per period: [previousSince, since) and [since, until]. */
async function trend(count: (range: { gte: Date; lt?: Date }) => Promise<number>, w: DashboardWindow): Promise<Trend> {
  const [current, previous] = await Promise.all([count({ gte: w.since }), count({ gte: w.previousSince, lt: w.since })]);
  return { current, previous };
}

export async function loadKpis(w: DashboardWindow): Promise<DashboardKpis> {
  const now = w.until.getTime();
  const [orgs, total, disabled, active7, active30, signUps, newOrgs, activeMembers, invitesSent, invitesAccepted, pendingRequests] = await Promise.all([
    countOrganisationsByStatus(),
    prisma.user.count(),
    prisma.user.count({ where: { disabledAt: { not: null } } }),
    prisma.user.count({ where: { disabledAt: null, lastSeenAt: { gte: new Date(now - 7 * DAY_MS) } } }),
    prisma.user.count({ where: { disabledAt: null, lastSeenAt: { gte: new Date(now - 30 * DAY_MS) } } }),
    trend((createdAt) => prisma.user.count({ where: { createdAt } }), w),
    trend((createdAt) => prisma.workspace.count({ where: { createdAt } }), w),
    trend((range) => distinctActors(range.gte, range.lt ?? new Date(now + 1)), w),
    trend((createdAt) => prisma.invitation.count({ where: { createdAt } }), w),
    trend((acceptedAt) => prisma.invitation.count({ where: { acceptedAt } }), w),
    countPendingRequests(),
  ]);
  return {
    orgs: { ACTIVE: orgs.ACTIVE, PENDING: orgs.PENDING, SUSPENDED: orgs.SUSPENDED, REJECTED: orgs.REJECTED },
    users: { total, disabled, active7, active30 },
    signUps, newOrgs, activeMembers, invitesSent, invitesAccepted, pendingRequests,
  };
}

type Binned = { bucket: Date; n: number };

/** Rows created per bucket; the table name is a fixed literal, never input. */
function createdPerBucket(table: "Workspace" | "User", w: DashboardWindow): Promise<Binned[]> {
  const stride = `${w.bucketDays} days`;
  return prisma.$queryRaw<Binned[]>`
    SELECT date_bin(${stride}::interval, "createdAt", ${w.since}::timestamp) AS bucket, COUNT(*)::int AS n
    FROM ${Prisma.raw(`"${table}"`)} WHERE "createdAt" >= ${w.since}::timestamp GROUP BY 1`;
}

function activePerBucket(w: DashboardWindow): Promise<Binned[]> {
  const stride = `${w.bucketDays} days`;
  return prisma.$queryRaw<Binned[]>`
    SELECT date_bin(${stride}::interval, "createdAt", ${w.since}::timestamp) AS bucket, COUNT(DISTINCT "actorId")::int AS n
    FROM "ActivityEvent" WHERE "actorId" IS NOT NULL AND "createdAt" >= ${w.since}::timestamp GROUP BY 1`;
}

export async function loadGrowth(w: DashboardWindow): Promise<GrowthSeries> {
  const [orgs, users, active] = await Promise.all([createdPerBucket("Workspace", w), createdPerBucket("User", w), activePerBucket(w)]);
  return { bucketDays: w.bucketDays, newOrgs: fillSeries(orgs, w), newUsers: fillSeries(users, w), activeMembers: fillSeries(active, w) };
}
