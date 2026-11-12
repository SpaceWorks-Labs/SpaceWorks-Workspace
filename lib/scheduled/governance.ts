import "server-only";
import { prisma } from "@/lib/db";
import { dispatch } from "@/lib/notify";
import {
  dayInZone,
  sectionFor,
  sectionPath,
  detailSchemas,
} from "@/lib/governance/schemas";

/** Transaction advisory claims and persisted event keys make replica ticks idempotent. */
export async function run(now: Date) {
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.governanceRecord.findMany({
      where: {
        archivedAt: null,
        workspace: { status: "ACTIVE", archivedAt: null },
        OR: [
          { kind: {in:["INSURANCE","LICENCE","REGISTRATION"]}, status:"ACTIVE", endsOn:{not:null} },
          { kind: {in:["RISK","EMERGENCY_PLAN","SOP_REVIEW","STATUTORY_REGISTER","DRILL"]}, status:{in:["OPEN","CONTROLLED","ACTIVE","NEEDS_REVIEW","DUE","CURRENT","PLANNED"]}, dueOn:{not:null} },
          { kind: "OBLIGATION", status: "TODO", dueOn: { not: null } },
          { kind: "CONTRACT", status: "ACTIVE", endsOn: { not: null } },
          { kind: "TERM", status: "ACTIVE", endsOn: { not: null } },
          { kind: "AGM_ITEM", status: "TODO", dueOn: { not: null } },
        ],
      },
      include: { workspace: { select: { slug: true, timezone: true } } },
      orderBy: { id: "asc" },
      take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!rows.length) break;
    for (const row of rows) {
      const due = new Date(
        (["CONTRACT","TERM","INSURANCE","LICENCE","REGISTRATION"].includes(row.kind)
          ? row.endsOn
          : row.dueOn)!,
      );
      if (row.kind === "CONTRACT") {
        const details = detailSchemas.CONTRACT.safeParse(row.details);
        if (!details.success) continue;
        due.setUTCDate(due.getUTCDate() - details.data.noticeDays);
      }
      const today = new Date(dayInZone(now, row.workspace.timezone));
      const daysLeft = Math.round((due.getTime() - today.getTime()) / 86400000);
      if (daysLeft > row.reminderDays) continue;
      const phase = daysLeft < 0 ? "overdue" : "due";
      const key = `governance:${row.id}:${due.toISOString().slice(0, 10)}:${phase}`;
      const result = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
        if (
          await tx.notificationEventRecord.findFirst({
            where: { workspaceId: row.workspaceId, dedupeKey: key },
          })
        )
          return null;
        const current = await tx.governanceRecord.findFirst({
          where: {
            workspaceId: row.workspaceId,
            id: row.id,
            archivedAt: null,
            updatedAt: row.updatedAt,
            workspace: { status: "ACTIVE", archivedAt: null },
          },
        });
        if (!current) return null;
        const admins = await tx.membership.findMany({
          where: {
            workspaceId: row.workspaceId,
            status: "ACTIVE",
            role: { in: ["ADMIN", "OWNER"] },
            user: { disabledAt: null },
          },
          select: { userId: true },
        });
        const recipients =
          row.ownerId && admins.some((m) => m.userId === row.ownerId)
            ? [row.ownerId]
            : admins.map((m) => m.userId);
        return dispatch(
          row.workspaceId,
          {
            type: ["RISK","EMERGENCY_PLAN","SOP_REVIEW","STATUTORY_REGISTER"].includes(row.kind) ? "governance.review_due" : "governance.reminder",
            title:
              row.kind === "CONTRACT"
                ? `Contract notice ${phase}`
                : `Governance item ${phase}`,
            body: "Review the record and its due date.",
            url: `/w/${row.workspace.slug}/governance${sectionPath(sectionFor(row.kind))}?edit=${row.id}`,
            recipients,
            resource: { type: "governance", id: row.id },
            useWorkspaceRules: false,
            dedupeKey: key,
            data: {
              recordId: row.id,
              dueOn: due.toISOString(),
              kind: row.kind,
            },
          },
          { tx, now },
        );
      });
      await result?.afterCommit();
    }
    cursor = rows.at(-1)!.id;
  }
}
