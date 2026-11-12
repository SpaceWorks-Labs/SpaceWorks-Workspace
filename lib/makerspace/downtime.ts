import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { dispatch } from "@/lib/notify";
import { memberIdsAtLeast, type OpsActor } from "@/lib/approvals/context";
import { guard, id, lockAsset, note, OpsError, optionalDate, parse } from "@/lib/approvals/ops";
import { isDownAt, overlapHours } from "./downtimeMath";

const startSchema = z.object({ assetId: id, reason: z.string().trim().min(1, "Say why the machine is out of service.").max(500), from: optionalDate, to: optionalDate });

export async function startDowntime(actor: OpsActor, input: unknown, now = new Date()): Promise<string> {
  await guard(actor, true);
  const v = parse(startSchema, input);
  const from = v.from ?? now;
  if (v.to && v.to <= from) throw new OpsError("The end must be after the start.");
  const done = await prisma.$transaction(async (tx) => {
    await lockAsset(tx, actor.workspace.id, v.assetId);
    const clash = await tx.assetDowntime.findFirst({
      where: { workspaceId: actor.workspace.id, assetId: v.assetId, ...(v.to ? { from: { lt: v.to } } : {}), OR: [{ to: null }, { to: { gt: from } }] },
      select: { id: true },
    });
    if (clash) throw new OpsError("This machine already has downtime recorded for that time. Mark it back in service first.");
    const row = await tx.assetDowntime.create({ data: { workspaceId: actor.workspace.id, assetId: v.assetId, from, to: v.to ?? null, reason: v.reason, createdById: actor.user.id } });
    await note(actor, "asset", v.assetId, "downtime_started", tx);
    if (!isDownAt(row, now)) return { id: row.id, after: undefined };
    const asset = await tx.asset.findFirstOrThrow({ where: { id: v.assetId, workspaceId: actor.workspace.id }, select: { name: true } });
    const result = await dispatch(
      actor.workspace.id,
      {
        type: "asset.downtime_started",
        title: `${asset.name} is out of service`,
        body: v.reason,
        url: `/w/${actor.workspace.slug}/assets#${v.assetId}`,
        actorId: actor.user.id,
        recipients: await memberIdsAtLeast(tx, actor.workspace.id, "ADMIN"),
        resource: { type: "asset", id: v.assetId },
        dedupeKey: `downtime:${row.id}`,
        data: { assetId: v.assetId, downtimeId: row.id, reason: v.reason },
      },
      { tx, now },
    );
    return { id: row.id, after: () => result.afterCommit() };
  });
  await done.after?.();
  return done.id;
}

/** Close an open downtime ("back in service"). */
export async function endDowntime(actor: OpsActor, input: unknown, now = new Date()) {
  await guard(actor, true);
  const v = parse(z.object({ downtimeId: id }), input);
  await prisma.$transaction(async (tx) => {
    const row = await tx.assetDowntime.findFirst({ where: { id: v.downtimeId, workspaceId: actor.workspace.id, to: null }, select: { assetId: true, from: true } });
    if (!row) throw new OpsError("That downtime has already ended.");
    await lockAsset(tx, actor.workspace.id, row.assetId);
    const { count } = await tx.assetDowntime.updateMany({ where: { id: v.downtimeId, workspaceId: actor.workspace.id, to: null }, data: { to: row.from > now ? row.from : now } });
    if (count) await note(actor, "asset", row.assetId, "back_in_service", tx);
  });
}

/** Current downtime and the latest five records per asset, in one query. */
export async function downtimesFor(actor: OpsActor, assetIds: string[], now = new Date()) {
  await guard(actor);
  const rows = await prisma.assetDowntime.findMany({ where: { workspaceId: actor.workspace.id, assetId: { in: assetIds } }, orderBy: { from: "desc" }, take: 2000 });
  const out = new Map<string, { current: (typeof rows)[number] | null; history: typeof rows }>();
  for (const row of rows) {
    const entry = out.get(row.assetId) ?? { current: null, history: [] };
    if (!entry.current && isDownAt(row, now)) entry.current = row;
    if (entry.history.length < 5) entry.history.push(row);
    out.set(row.assetId, entry);
  }
  return out;
}

export type CostRow = { assetId: string; name: string; downtimeCount: number; downtimeHours: number; maintenanceCostMinor: number; maintenanceCount: number };

/** Per-asset downtime hours and maintenance spend inside [from, to). Admin only (it shows costs). */
export async function downtimeCostReport(actor: OpsActor, period: { from: Date; to: Date }, now = new Date()): Promise<CostRow[]> {
  await guard(actor, true);
  const ws = actor.workspace.id;
  const [downtimes, logs] = await Promise.all([
    prisma.assetDowntime.findMany({ where: { workspaceId: ws, from: { lt: period.to }, OR: [{ to: null }, { to: { gt: period.from } }] }, take: 5000 }),
    prisma.assetMaintenanceLog.findMany({ where: { asset: { workspaceId: ws }, at: { gte: period.from, lt: period.to } }, select: { assetId: true, costMinor: true }, take: 10000 }),
  ]);
  const rows = new Map<string, CostRow>();
  const row = (assetId: string) => rows.get(assetId) ?? rows.set(assetId, { assetId, name: "", downtimeCount: 0, downtimeHours: 0, maintenanceCostMinor: 0, maintenanceCount: 0 }).get(assetId)!;
  for (const d of downtimes) {
    const r = row(d.assetId);
    r.downtimeCount += 1;
    r.downtimeHours += overlapHours(d, period.from, period.to, now);
  }
  for (const log of logs) {
    const r = row(log.assetId);
    r.maintenanceCount += 1;
    r.maintenanceCostMinor += log.costMinor ?? 0;
  }
  const names = await prisma.asset.findMany({ where: { workspaceId: ws, id: { in: [...rows.keys()] } }, select: { id: true, name: true } });
  for (const n of names) row(n.id).name = n.name;
  return [...rows.values()].filter((r) => r.name).sort((a, b) => b.downtimeHours - a.downtimeHours || a.name.localeCompare(b.name));
}
