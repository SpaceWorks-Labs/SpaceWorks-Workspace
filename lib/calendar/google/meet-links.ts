import "server-only";

import { setTimeout as wait } from "node:timers/promises";
import { getQueues } from "@/lib/queue/client";
import { jobId } from "@/lib/queue/definitions";
import { canContribute } from "@/lib/roles";
import { prisma } from "@/lib/db";
import { getGoogleAccessToken } from "@/lib/integrations/google/tokens";
import { requestJson } from "@/lib/integrations/http";
import { assertActor, serial } from "@/lib/meetings/core";
import { managesMeeting } from "@/lib/meetings/service";
import { notifyMeeting } from "../service";
import { API, memberGoogle, type GoogleEvent } from "./connection";

/** Accept only Google Meet HTTPS URLs; provider response fields never become arbitrary links. */
export function meetUrl(event: GoogleEvent): string | null {
  const candidates = [event.hangoutLink, ...event.conferenceData?.entryPoints?.filter(p => p.entryPointType === "video").map(p => p.uri) ?? []];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try { const url = new URL(candidate); if (url.protocol === "https:" && url.hostname === "meet.google.com" && !url.username && !url.password && !url.port) return url.href; } catch {}
  }
  return null;
}
export async function pollMeetEvent(read: () => Promise<GoogleEvent | null>, initial?: GoogleEvent, pause: (ms: number) => Promise<unknown> = wait): Promise<GoogleEvent | null> {
  let event = initial ?? null;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (event && (meetUrl(event) || event.conferenceData?.createRequest?.status?.statusCode === "failure")) return event;
    await pause(Math.min(100 * 2 ** attempt, 800));
    event = await read();
  }
  return event;
}
export async function enqueueMeetLink(bindingId: string) {
  await getQueues().sync.add("google-meet", { kind: "google-meet", bindingId }, { jobId: jobId("meet", bindingId + ":" + Math.floor(Date.now() / 60000)) });
}
export async function failMeetLink(bindingId: string) {
  const row = await prisma.calendarMeetingSync.findUnique({ where: { id: bindingId } });
  if (!row) return;
  await prisma.$transaction([
    prisma.calendarMeetingSync.update({ where: { id: row.id, workspaceId: row.workspaceId }, data: { meetPending: false, lastError: "Google Meet could not be created. Try creating the link again." } }),
    prisma.meeting.updateMany({ where: { id: row.meetingId, workspaceId: row.workspaceId }, data: { meetPending: false } }),
  ]);
}
async function meetActor(bindingId: string) {
  const binding = await prisma.calendarMeetingSync.findUnique({ where: { id: bindingId }, include: { workspace: true, meeting: true } });
  if (!binding || binding.workspace.archivedAt || binding.workspace.status !== "ACTIVE" || binding.meeting.status === "CANCELLED") return null;
  const membership = await prisma.membership.findFirst({ where: { workspaceId: binding.workspaceId, userId: binding.userId, status: "ACTIVE", user: { disabledAt: null } }, include: { user: true } });
  if (!membership || !canContribute(membership)) return null;
  const actor = { workspace: binding.workspace, membership, user: { id: membership.userId, name: membership.user.name } };
  if (!managesMeeting(actor, binding.meeting)) return null;
  return { binding, actor };
}
export async function storeMeetLink(bindingId: string, event: GoogleEvent) {
  const url = meetUrl(event), context = await meetActor(bindingId);
  if (!url || !context) return;
  const { binding, actor } = context;
  const n = await serial(async tx => {
    await assertActor(actor, tx);
    const meeting = await tx.meeting.findFirst({ where: { id: binding.meetingId, workspaceId: binding.workspaceId } });
    if (!meeting || !managesMeeting(actor, meeting) || meeting.status === "CANCELLED") return null;
    const matchingRevision = meeting.sequence === binding.sequence;
    if (!matchingRevision && (meeting.videoUrl || !meeting.meetPending)) {
      // A local link wins over an older conference request.
      await tx.calendarMeetingSync.update({ where: { id: bindingId, workspaceId: binding.workspaceId }, data: { meetPending: false } });
      await tx.meeting.updateMany({ where: { id: meeting.id, workspaceId: binding.workspaceId, sequence: meeting.sequence }, data: { meetPending: false } });
      return null;
    }
    const changed = meeting.videoUrl !== url;
    const claim = await tx.meeting.updateMany({ where: { id: meeting.id, workspaceId: binding.workspaceId, sequence: meeting.sequence }, data: { videoUrl: url, meetPending: false, ...(changed ? { sequence: { increment: 1 } } : {}) } });
    if (!claim.count) return null;
    // Only the link was imported. Keep the prior etag so normal sync still
    // imports remote title/time edits; align only our own link revision.
    await tx.calendarMeetingSync.update({ where: { id: bindingId, workspaceId: binding.workspaceId }, data: { sequence: matchingRevision ? meeting.sequence + (changed ? 1 : 0) : binding.sequence, meetPending: false, lastError: null, lastSyncedAt: new Date() } });
    return changed ? notifyMeeting(tx, actor, meeting.id, "meeting.updated") : null;
  });
  await n?.afterCommit();
}
export async function finishMeetLink(bindingId: string) {
  const context = await meetActor(bindingId);
  if (!context) { await failMeetLink(bindingId); return; }
  const { binding, actor } = context;
  if (!binding.meetPending) return;
  if (!binding.meetRequestedAt || Date.now() - binding.meetRequestedAt.getTime() > 3600000) { await failMeetLink(bindingId); return; }
  const connection = await memberGoogle(actor.workspace.id, actor.user.id);
  if (!connection || connection.id !== binding.connectionId) { await failMeetLink(bindingId); return; }
  const token = await getGoogleAccessToken(connection);
  if (!token.ok) { await failMeetLink(bindingId); return; }
  const ready = await pollMeetEvent(async () => {
    const result = await requestJson<GoogleEvent>(`${API}/calendars/primary/events/${binding.externalId}`, { headers: { Authorization: `Bearer ${token.token}` }, label: "Google Calendar", timeoutMs: 1200 });
    return result.ok ? result.data : null;
  });
  if (ready?.conferenceData?.createRequest?.status?.statusCode === "failure") { await failMeetLink(bindingId); return; }
  if (!ready || !meetUrl(ready)) throw new Error("Google Meet is still pending.");
  await storeMeetLink(bindingId, ready);
}
export async function resumeMeetLinks() {
  const bindings = await prisma.calendarMeetingSync.findMany({ where: { meetPending: true }, select: { id: true }, take: 100 });
  for (const binding of bindings) { if (process.env.REDIS_URL) await enqueueMeetLink(binding.id); else await finishMeetLink(binding.id).catch(() => undefined); }
}
