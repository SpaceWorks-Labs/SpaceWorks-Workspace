import "server-only";
import { workspacesWithoutModule } from "@/lib/modules-server";
import { prisma } from "@/lib/db";
import { dispatch } from "@/lib/notify";
import { dayInZone, sectionFor } from "@/lib/funding/schema";
import { donationSummary, object, pledgeDue } from "@/lib/funding/analytics";
/** Every replica can tick: workspace locks and durable event keys claim each deadline once per phase. */
export async function run(now: Date) {
  const off = await workspacesWithoutModule("finance");
  let cursor: string | undefined;
  for (;;) {
    const workspaces = await prisma.workspace.findMany({ where: { status: "ACTIVE", archivedAt: null, id: { notIn: off }, fundingRecords: { some: { archivedAt: null } } }, select: { id: true, slug: true, timezone: true }, orderBy: { id: "asc" }, take: 25, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    if (!workspaces.length) break;
    for (const workspace of workspaces) {
      const results = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${workspace.id} AND "archivedAt" IS NULL FOR NO KEY UPDATE`;
        if (!await tx.workspace.findFirst({ where: { id: workspace.id, status: "ACTIVE", archivedAt: null }, select: { id: true } })) return [];
        const rows = await tx.fundingRecord.findMany({ where: { workspaceId: workspace.id, archivedAt: null } });
        const gifts = rows.filter(r => r.kind === "DONATION");
        const admins = await tx.membership.findMany({ where: { workspaceId: workspace.id, status: "ACTIVE", role: { in: ["ADMIN", "OWNER"] }, user: { disabledAt: null } }, select: { userId: true } });
        const today = dayInZone(now, workspace.timezone); const events = [];
        for (const row of rows) {
          const d = object(row.details); const dates: Array<{ date: string; reason: string; lead: number }> = [];
          if (row.kind === "DONATION") {
            if (row.status !== "RECEIVED" || row.thankedAt || !row.dateOn) continue;
            const due = new Date(row.dateOn); due.setUTCDate(due.getUTCDate() + row.reminderDays);
            dates.push({ date: due.toISOString().slice(0, 10), reason: "thank_you", lead: 0 });
          } else {
            if (["DONE", "CLOSED", "VOID", "REMOVED", "INACTIVE", "SIGNED", "CANCELLED", "COMPLETED", "PAUSED", "DECLINED", "RECEIVED"].includes(row.status)) continue;
            if (row.kind === "PLEDGE") { const due = pledgeDue(row, gifts); if (due) dates.push({ date: due, reason: "pledge", lead: row.reminderDays }); }
            if (row.dueOn) dates.push({ date: row.dueOn.toISOString().slice(0, 10), reason: "deadline", lead: row.reminderDays });
            if (row.kind === "OPPORTUNITY") for (const [field, reason] of [["applicationOn", "application"], ["reportOn", "report"], ["utilisationOn", "utilisation"]] as const) if (d[field]) {
              if (reason === "application" && !["IDEA", "APPLYING"].includes(row.status)) continue;
              dates.push({ date: String(d[field]), reason, lead: row.reminderDays });
            }
          }
          for (const due of dates) {
            const days = Math.round((new Date(due.date).getTime() - new Date(today).getTime()) / 86400000);
            if (days > due.lead) continue;
            const phase = days < 0 ? "overdue" : "due"; const key = `funding:${row.id}:${due.reason}:${due.date}:${phase}`;
            if (await tx.notificationEventRecord.findFirst({ where: { workspaceId: workspace.id, dedupeKey: key }, select: { id: true } })) continue;
            const recipients = row.ownerId && admins.some(a => a.userId === row.ownerId) ? [row.ownerId] : admins.map(a => a.userId);
            if (!recipients.length) continue;
            events.push(await dispatch(workspace.id, { type: due.reason === "thank_you" ? "funding.thank_you_due" : due.reason === "pledge" ? "funding.pledge_due" : "funding.reminder", title: due.reason === "thank_you" ? "A donation needs a thank-you" : due.reason === "pledge" ? `Pledge instalment ${phase}` : `Funding item ${phase}`, body: "Review the saved record and its next action.", url: `/w/${workspace.slug}/funding/${sectionFor(row.kind)}?edit=${row.id}`, recipients, resource: { type: "funding", id: row.id }, useWorkspaceRules: false, dedupeKey: key, data: { recordId: row.id, dueOn: due.date, reason: due.reason } }, { tx, now }));
          }
        }
        const snapshot = await tx.fundingAnalyticsSnapshot.findUnique({ where: { workspaceId_dateOn: { workspaceId: workspace.id, dateOn: new Date(today) } } });
        if (!snapshot || now.getTime() - snapshot.updatedAt.getTime() > 3600000) {
          const summary = donationSummary(gifts, now);
          const aggregate = { year: summary.year, cash: summary.cash, inKind: summary.inKind, donors: summary.donors.length, retention: summary.retention, campaigns: summary.campaigns };
          await tx.fundingAnalyticsSnapshot.upsert({ where: { workspaceId_dateOn: { workspaceId: workspace.id, dateOn: new Date(today) } }, create: { workspaceId: workspace.id, dateOn: new Date(today), summary: aggregate }, update: { summary: aggregate } });
        }
        return events;
      }, { timeout: 30000 });
      for (const event of results) await event.afterCommit();
    }
    cursor = workspaces.at(-1)!.id;
  }
}
