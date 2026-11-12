import "server-only";
import { maintenanceState } from "./maintenanceService";
import { prisma } from "@/lib/db";
import { dispatch } from "@/lib/notify";
import { claimOnce } from "./coord";
import { activeOccurrence, nextOccurrence, recentlyEndedOccurrence } from "./maintenance";
import { currentOnCall } from "./onCall";
import { EventBatch, incidentResponders } from "./notify";

export async function maintenanceEvents(now: Date) {
  const windows = await prisma.maintenanceWindow.findMany({ where: { workspace: { status: "ACTIVE", archivedAt: null } } });
  for (const window of windows) {
    const active = activeOccurrence(window, now), next = nextOccurrence(window, now), ended = recentlyEndedOccurrence(window, new Date(now.getTime() - 120000), now);
    const events = [active ? { type: "maintenance.started" as const, occurrence: active } : null, next && next.start.getTime() - now.getTime() <= 86400000 ? { type: "maintenance.scheduled" as const, occurrence: next } : null, ended ? { type: "maintenance.ended" as const, occurrence: ended } : null].filter(e => e !== null);
    for (const e of events) {
      const key = `${e.type}:${window.id}:${e.occurrence.start.toISOString()}`;
      if (!await claimOnce(key, 7 * 86400000)) continue;
      await dispatch(window.workspaceId, { type: e.type, title: `${window.title}: ${e.type.split(".")[1]}`, dedupeKey: key, recipients: await incidentResponders(window.workspaceId), data: { maintenanceWindowId: window.id, startsAt: e.occurrence.start.toISOString(), endsAt: e.occurrence.end.toISOString() } });
    }
  }
}
type Step = { delayMin: number; targets: Array<{ type: "USER" | "SCHEDULE" | "DESTINATION"; id: string }> };
export async function escalations(now: Date) {
  const due = await prisma.incident.findMany({ where: { status: { not: "RESOLVED" }, acknowledgedAt: null, nextEscalationAt: { lte: now }, escalationPolicy: { isNot: null } }, take: 50 });
  for (const incident of due) {
    const linked = await prisma.monitor.findMany({ where: { workspaceId: incident.workspaceId, incidents: { some: { incidentId: incident.id } } }, select: { id: true, flapping: true } });
    if (linked.some(m => m.flapping)) continue;
    const maintenance = await Promise.all(linked.map(m => maintenanceState(prisma, incident.workspaceId, m.id, now)));
    if (maintenance.some(state => state.suppress)) continue;
    const batches: EventBatch[] = [];
    const deferred: Array<() => Promise<void>> = [];
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Incident" WHERE "id" = ${incident.id} AND "workspaceId" = ${incident.workspaceId} FOR UPDATE`;
      const current = await tx.incident.findFirst({ where: { id: incident.id, workspaceId: incident.workspaceId, status: { not: "RESOLVED" }, acknowledgedAt: null, nextEscalationAt: incident.nextEscalationAt }, include: { monitors: true } });
      if (!current) return;
      const policy = await tx.escalationPolicy.findFirst({ where: { id: current.escalationPolicyId!, workspaceId: current.workspaceId } });
      const steps = Array.isArray(policy?.steps) ? policy.steps as unknown as Step[] : [];
      const step = steps[current.escalationStep % steps.length];
      if (!step || !policy) { await tx.incident.update({ where: { id: current.id, workspaceId: current.workspaceId }, data: { nextEscalationAt: null } }); return; }
      const recipients: string[] = [], destinationIds: string[] = [];
      for (const target of step.targets) {
        if (target.type === "USER") recipients.push(target.id);
        if (target.type === "DESTINATION") { if (await tx.notificationDestination.findFirst({ where: { id: target.id, workspaceId: current.workspaceId, enabled: true } })) destinationIds.push(target.id); }
        if (target.type === "SCHEDULE") {
          const schedule = await tx.onCallSchedule.findFirst({ where: { id: target.id, workspaceId: current.workspaceId } });
          const userId = schedule ? currentOnCall(schedule, now) : null;
          if (userId) recipients.push(userId);
        }
      }
      const batch = new EventBatch(tx); batches.push(batch);
      const fields = { title: `INC-${current.number}: ${current.title}`, scope: { incidentId: current.id }, threadKey: `incident:${current.id}`, dedupeKey: `escalate:${current.id}:${current.escalationStep}`, data: { incidentId: current.id, number: current.number, status: current.status, monitorIds: current.monitors.map(m => m.monitorId), step: current.escalationStep } };
      await batch.send(current.workspaceId, { ...fields, type: "incident.escalated", recipients });
      if (destinationIds.length) {
        const result = await dispatch(current.workspaceId, { ...fields, type: "incident.escalated" }, { tx, onlyDestinationIds: destinationIds }); deferred.push(result.afterCommit);
      }
      const index = current.escalationStep + 1;
      const next = index < steps.length * (policy.repeat + 1) ? new Date(now.getTime() + Math.max(1, steps[index % steps.length].delayMin) * 60000) : null;
      await tx.incident.update({ where: { id: current.id, workspaceId: current.workspaceId }, data: { escalationStep: index, nextEscalationAt: next } });
    });
    for (const batch of batches) await batch.afterCommit();
    for (const fn of deferred) await fn();
  }
}
