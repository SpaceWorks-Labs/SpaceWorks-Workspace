import "server-only";
import type { CloudConnection, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { dispatch } from "@/lib/notify";
import { providerAdapter } from "./index";
import { createProviderHttp } from "./http";
import { openCloudCredentials } from "../secrets";
import { claimOnce, cacheGet, cacheSet } from "../coord";
import { refreshCatalogueStatus } from "../catalogue";
import { monthStartUtc } from "./providers/common";
import { aggregateCosts } from "./costs";
import { CloudApiError, type AdapterContext, type CloudProviderAdapter, type ProviderHttp } from "./types";

export async function syncConnection(connection: CloudConnection, now: Date, adapter: CloudProviderAdapter = providerAdapter(connection.provider), http?: ProviderHttp, signal?: AbortSignal) {
  const workspaceId = connection.workspaceId;
  try {
    const ctx: AdapterContext = { credentials: openCloudCredentials(connection.credentialsEnc), config: connection.config as Record<string, unknown>, http: http ?? createProviderHttp({ key: connection.id, spacingMs: adapter.minRequestSpacingMs, signal }), now, signal };
    const resources = await adapter.listResources(ctx);
    const ids = new Map<string, string>();
    for (const resource of resources) {
      const previous = await prisma.cloudResource.findFirst({ where: { workspaceId, connectionId: connection.id, externalId: resource.externalId }, select: { status: true } });
      const row = await prisma.cloudResource.upsert({ where: { connectionId_externalId: { connectionId: connection.id, externalId: resource.externalId } }, create: { ...resource, workspaceId, connectionId: connection.id, lastSeenAt: now, raw: resource.raw as Prisma.InputJsonValue | undefined }, update: { ...resource, lastSeenAt: now, goneAt: null, raw: resource.raw as Prisma.InputJsonValue | undefined } });
      ids.set(resource.externalId, row.id);
      if (resource.status === "UNHEALTHY" && previous?.status !== "UNHEALTHY") await dispatch(workspaceId, { type: "cloud.resource_unhealthy", title: `${resource.name} is unhealthy`, scope: { cloudConnectionId: connection.id }, resource: { type: "cloud_resource", id: row.id }, dedupeKey: `resource:${row.id}:${now.toISOString()}`, data: { connectionId: connection.id, resourceId: row.id, status: resource.status } });
      await refreshCatalogueStatus(workspaceId, row.id, "CLOUD_RESOURCE");
      if (ctx.config.autoCreateMonitors === true) await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id" = ${workspaceId} FOR NO KEY UPDATE`;
        if (await tx.monitor.findFirst({ where: { workspaceId, cloudResourceId: row.id } })) return;
        const cap = Math.max(1, Number.parseInt(process.env.MONITOR_MAX_PER_WORKSPACE ?? "100", 10) || 100);
        if (await tx.monitor.count({ where: { workspaceId } }) >= cap) return;
        await tx.monitor.create({ data: { workspaceId, name: resource.name, type: "CLOUD_RESOURCE", cloudResourceId: row.id, intervalSec: 300, createdById: connection.createdById } });
      });
    }
    await prisma.cloudResource.updateMany({ where: { workspaceId, connectionId: connection.id, externalId: { notIn: resources.map(r => r.externalId) }, goneAt: null }, data: { goneAt: now, status: "UNKNOWN" } });
    // Inventory is useful even when metrics or billing permissions are unavailable.
    const errors: string[] = [];
    if (adapter.getCosts && (!connection.lastCostSyncAt || now.getTime() - connection.lastCostSyncAt.getTime() >= 86400000) && await claimOnce(`cost:${connection.id}:${now.toISOString().slice(0, 10)}`, 86400000)) {
      try {
        for (const cost of await adapter.getCosts(ctx)) {
          if (!Number.isFinite(cost.amount)) continue;
          await prisma.costSnapshot.upsert({ where: { connectionId_granularity_periodStart: { connectionId: connection.id, granularity: cost.granularity, periodStart: cost.periodStart } }, create: { ...cost, workspaceId, connectionId: connection.id, fetchedAt: now }, update: { ...cost, fetchedAt: now } });
        }
        await prisma.cloudConnection.updateMany({ where: { id: connection.id, workspaceId }, data: { lastCostSyncAt: now } });
      } catch { errors.push("Costs unavailable. Check billing access."); }
    }
    if (adapter.getMetrics) {
      try {
        const points = await adapter.getMetrics(ctx, resources);
        await prisma.cloudMetricSample.createMany({ data: points.filter(p => ids.has(p.externalId) && Number.isFinite(p.value) && !Number.isNaN(p.ts.getTime())).map(p => ({ resourceId: ids.get(p.externalId)!, metric: p.metric, ts: p.ts, value: p.value })), skipDuplicates: true });
      } catch { errors.push("Metrics unavailable. Check the metrics read permissions."); }
    }
    if (adapter.listAlarms) {
      try {
        for (const alarm of await adapter.listAlarms(ctx)) {
          const key = `alarm:${connection.id}:${alarm.name}`;
          const previous = await cacheGet<string>(key);
          if (alarm.state === "ALARM" && previous !== "ALARM") await dispatch(workspaceId, { type: "cloud.alarm", title: `Cloud alarm: ${alarm.name}`, scope: { cloudConnectionId: connection.id }, dedupeKey: `${key}:${now.toISOString()}`, data: { connectionId: connection.id, alarmName: alarm.name, state: alarm.state } });
          await cacheSet(key, alarm.state, 7 * 86400000);
        }
      } catch { errors.push("Alarms unavailable. Check the alarm read permissions."); }
    }
    await prisma.cloudConnection.updateMany({ where: { id: connection.id, workspaceId }, data: { lastSyncAt: now, lastError: errors.join(" ") || null, nextSyncAt: new Date(now.getTime() + 300000) } });
  } catch (error) {
    const message = error instanceof CloudApiError ? error.message : "Cloud sync failed. Check the credentials and read permissions.";
    await prisma.cloudConnection.updateMany({ where: { id: connection.id, workspaceId }, data: { lastError: message, nextSyncAt: new Date(now.getTime() + (error instanceof CloudApiError && error.kind === "rate_limited" ? Math.max(3600000, error.retryAfterMs ?? 0) : 300000)) } });
    throw new CloudApiError(message, error instanceof CloudApiError ? error.kind : "http");
  }
}
export async function syncDueConnections(now: Date, budgetMs = 40000) {
  const signal = AbortSignal.timeout(budgetMs);
  const rows = await prisma.cloudConnection.findMany({ where: { enabled: true, nextSyncAt: { lte: now }, workspace: { status: "ACTIVE", archivedAt: null } }, take: 10, orderBy: { nextSyncAt: "asc" } });
  for (const row of rows) {
    if (signal.aborted) break;
    const claimed = await prisma.cloudConnection.updateMany({ where: { id: row.id, workspaceId: row.workspaceId, nextSyncAt: row.nextSyncAt }, data: { nextSyncAt: new Date(now.getTime() + 900000) } });
    if (claimed.count) await syncConnection(row, now, providerAdapter(row.provider), undefined, signal).catch(() => undefined);
  }
}
export async function checkCostBudgets(now: Date) {
  for (const budget of await prisma.costBudget.findMany({ where: { workspace: { status: "ACTIVE", archivedAt: null } } })) {
    const rows = await prisma.costSnapshot.findMany({ where: { workspaceId: budget.workspaceId, ...(budget.connectionId ? { connectionId: budget.connectionId } : {}), currency: budget.currency, periodStart: { gte: monthStartUtc(now), lte: now } } });
    const spentMinor = aggregateCosts(rows.map(r => ({ ...r, amount: Number(r.amount) }))).reduce((s, r) => s + r.spentMinor, 0);
    for (const threshold of budget.thresholdsPct) if (spentMinor * 100 >= budget.monthlyLimitMinor * threshold) {
      const result = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "CostBudget" WHERE "id" = ${budget.id} AND "workspaceId" = ${budget.workspaceId} FOR UPDATE`;
        const key = `cost:${budget.id}:${monthStartUtc(now).toISOString()}:${threshold}`;
        // Dedupe is monthly, so a new month automatically resets thresholds.
        const exists = await tx.notificationEventRecord.findFirst({ where: { workspaceId: budget.workspaceId, dedupeKey: key }, select: { id: true } });
        if (exists) return;
        const result = await dispatch(budget.workspaceId, { type: "cost.threshold_exceeded", title: `Cloud spend reached ${threshold}% of budget`, scope: { costBudgetId: budget.id, ...(budget.connectionId ? { cloudConnectionId: budget.connectionId } : {}) }, dedupeKey: key, data: { costBudgetId: budget.id, connectionId: budget.connectionId, thresholdPct: threshold, spentMinor, limitMinor: budget.monthlyLimitMinor, currency: budget.currency } }, { tx });
        return result;
      });
      await result?.afterCommit();
    }
  }
}
