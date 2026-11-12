import "server-only";
import { run as orgPeople } from "@/lib/scheduled/orgPeople";
import { prisma } from "@/lib/db";
import { dispatch } from "@/lib/notify/dispatch";
import type { AnyNotificationEvent } from "@/lib/notify/types";
import { adminIds, tryTransactionLock } from "@/lib/people/context";
import { coverage } from "@/lib/rota/coverage";

async function once(workspaceId: string, key: string, event: AnyNotificationEvent, now: Date) {
  const result = await prisma.$transaction(async tx => {
    if (!await tryTransactionLock(tx, `people:reminder:${workspaceId}:${key}`)) return null;
    if (await tx.notificationEventRecord.findFirst({ where: { workspaceId, dedupeKey: key }, select: { id: true } })) return null;
    return dispatch(workspaceId, { ...event, dedupeKey: key, useWorkspaceRules: false }, { tx, now });
  }, { timeout: 15000 });
  await result?.afterCommit();
}
async function* pages<T extends { id: string }>(fetch: (cursor?: string) => Promise<T[]>) {
  let cursor: string | undefined;
  for (;;) {
    const rows = await fetch(cursor);
    for (const row of rows) yield row;
    if (rows.length < 300) return;
    cursor = rows[rows.length - 1].id;
  }
}
/** Persistent event markers and advisory locks make repeated replica ticks safe. */
export async function run(now: Date): Promise<void> {
  await orgPeople(now);
  const horizon = new Date(now.getTime() + 86400000);
  for await (const shift of pages(cursor => prisma.shift.findMany({ where: { startsAt: { gt: now, lte: horizon }, workspace: { status: "ACTIVE", archivedAt: null } }, include: { workspace: { select: { slug: true } }, shiftType: { select: { name: true, teamId: true } }, assignments: { select: { userId: true, status: true } } }, take: 300, orderBy: { id: "asc" }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) }))) {
    const c = coverage(shift.capacity, shift.assignments);
    const dateKey = shift.startsAt.toISOString();
    for (const assignment of shift.assignments.filter(a => ["CONFIRMED", "SWAP_REQUESTED"].includes(a.status))) {
      await once(shift.workspaceId, `people:shift:${shift.id}:${dateKey}:${assignment.userId}`, { type: "shift.reminder", title: `${shift.shiftType.name} starts within 24 hours`.slice(0, 150), recipients: [assignment.userId], url: `/w/${shift.workspace.slug}/rota`, resource: { type: "shift", id: shift.id }, data: { shiftId: shift.id, startsAt: dateKey } }, now);
    }
    if (!c.covered) {
      const leads = shift.shiftType.teamId ? (await prisma.teamMember.findMany({ where: { role: "LEAD", teamId: shift.shiftType.teamId, team: { workspaceId: shift.workspaceId } }, select: { userId: true } })).map(t => t.userId) : [];
      await once(shift.workspaceId, `people:unfilled:${shift.id}:${dateKey}`, { type: "shift.unfilled", title: `${shift.shiftType.name} needs ${c.open} more volunteers`.slice(0, 150), recipients: [...new Set([...leads, ...await adminIds(shift.workspaceId)])], url: `/w/${shift.workspace.slug}/rota`, resource: { type: "shift", id: shift.id }, data: { shiftId: shift.id, startsAt: dateKey, openSpots: c.open } }, now);
    }
  }
  for await (const c of pages(cursor => prisma.certification.findMany({ where: { revokedAt: null, expiresAt: { gt: now, lte: new Date(now.getTime() + 30 * 86400000) }, certType: { workspace: { status: "ACTIVE", archivedAt: null } } }, include: { certType: { include: { workspace: { select: { slug: true } } } } }, take: 300, orderBy: { id: "asc" }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) }))) await once(c.certType.workspaceId, `people:cert:${c.id}:${c.expiresAt!.toISOString()}`, { type: "certification.expiring", title: `Your ${c.certType.name} sign-off expires within 30 days`.slice(0, 150), recipients: [c.userId], resource: { type: "certification", id: c.id }, url: `/w/${c.certType.workspace.slug}/rota/certifications`, data: { certificationId: c.id, certTypeId: c.certType.id, expiresAt: c.expiresAt!.toISOString() } }, now);
  for await (const item of pages(cursor => prisma.checklistRunItem.findMany({ where: { doneAt: null, dueAt: { lte: horizon }, assigneeId: { not: null }, OR: [{ sourceType: null }, { sourceType: { not: "availability_request" } }], run: { status: "OPEN", workspace: { status: "ACTIVE", archivedAt: null } } }, include: { run: { include: { workspace: { select: { slug: true } } } } }, take: 300, orderBy: { id: "asc" }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) }))) {
    if (item.run.kind === "OFFBOARDING" && !(await adminIds(item.run.workspaceId)).includes(item.assigneeId!)) continue;
    await once(item.run.workspaceId, `people:checklist:${item.id}:${item.dueAt!.toISOString()}`, { type: "onboarding.task_due", title: "A checklist item is due", recipients: [item.assigneeId!], resource: { type: "checklist", id: item.runId }, url: `/w/${item.run.workspace.slug}/onboarding`, data: { runId: item.runId, itemId: item.id, dueAt: item.dueAt!.toISOString() } }, now);
  }
  for await (const c of pages(cursor => prisma.contact.findMany({ where: { deletedAt: null, doNotContact: false, ownerId: { not: null }, nextFollowUpAt: { lte: horizon }, workspace: { status: "ACTIVE", archivedAt: null } }, select: { id: true, workspaceId: true, ownerId: true, nextFollowUpAt: true, workspace: { select: { slug: true } } }, take: 300, orderBy: { id: "asc" }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) }))) await once(c.workspaceId, `people:followup:${c.id}:${c.ownerId}:${c.nextFollowUpAt!.toISOString()}`, { type: "contact.follow_up_due", title: "A relationship follow-up is due", recipients: [c.ownerId!], resource: { type: "contact", id: c.id }, url: `/w/${c.workspace.slug}/contacts/${c.id}`, data: { contactId: c.id, dueAt: c.nextFollowUpAt!.toISOString() } }, now);
}
