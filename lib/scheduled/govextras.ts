import "server-only";
import { prisma } from "@/lib/db";
import { dispatch } from "@/lib/notify";
import { activeHandlers } from "@/lib/govextras/cases";
import { dayInZone } from "@/lib/governance/schemas";

/** Durable per-deadline phase claims; every replica uses the same advisory key. */
export async function run(now: Date) {
  let cursor: string | undefined;
  for (;;) {
    const workspaces = await prisma.workspace.findMany({
      where: { archivedAt: null },
      select: { id: true, slug: true, timezone: true },
      orderBy: { id: "asc" },
      take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!workspaces.length) break;
    for (const workspace of workspaces) {
      let docCursor: string | undefined;
      for (;;) {
        const docs = await prisma.doc.findMany({
          where: {
            workspaceId: workspace.id,
            archivedAt: null,
            verifiedUntil: { lte: new Date(now.getTime() + 7 * 86400000) },
          },
          select: {
            id: true,
            verifiedUntil: true,
            verifiedById: true,
            createdById: true,
            visibility: true,
            updatedAt: true,
          },
          orderBy: { id: "asc" },
          take: 100,
          ...(docCursor ? { cursor: { id: docCursor }, skip: 1 } : {}),
        });
        if (!docs.length) break;
        for (const doc of docs) {
          const phase =
            dayInZone(doc.verifiedUntil!, workspace.timezone) <
            dayInZone(now, workspace.timezone)
              ? "overdue"
              : "due";
          const key = `govextras:doc:${doc.id}:${doc.verifiedUntil!.toISOString()}:${phase}`;
          const result = await prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
            if (
              await tx.notificationEventRecord.findFirst({
                where: { workspaceId: workspace.id, dedupeKey: key },
              })
            )
              return null;
            const current = await tx.doc.findFirst({
              where: {
                workspaceId: workspace.id,
                id: doc.id,
                archivedAt: null,
                verifiedUntil: doc.verifiedUntil,
                updatedAt: doc.updatedAt,
                workspace: { status: "ACTIVE", archivedAt: null },
              },
            });
            if (!current) return null;
            const member = await tx.membership.findFirst({
              where: {
                workspaceId: workspace.id,
                userId: doc.verifiedById ?? doc.createdById ?? "",
                status: "ACTIVE",
                user: { disabledAt: null },
                role: {
                  in:
                    doc.visibility === "ADMINS"
                      ? ["ADMIN", "OWNER"]
                      : ["MEMBER", "ADMIN", "OWNER"],
                },
              },
            });
            if (!member) return null;
            return dispatch(
              workspace.id,
              {
                type: "doc.review_due",
                title: `Document review ${phase}`,
                body: "Open your document and confirm its review date.",
                url: `/w/${workspace.slug}/docs/${doc.id}`,
                recipients: [member.userId],
                resource: { type: "doc", id: doc.id },
                dedupeKey: key,
                useWorkspaceRules: false,
                data: {
                  docId: doc.id,
                  dueOn: doc.verifiedUntil!.toISOString(),
                },
              },
              { tx, now },
            );
          });
          await result?.afterCommit();
        }
        docCursor = docs.at(-1)!.id;
      }
      let caseCursor: string | undefined;
      for (;;) {
        const cases = await prisma.safeguardingCase.findMany({
          where: {
            workspaceId: workspace.id,
            closedAt: null,
            OR: [
              { dueOn: { lte: new Date(dayInZone(now, workspace.timezone)) } },
              {
                events: {
                  some: {
                    kind: "ACTION",
                    completedAt: null,
                    dueOn: {
                      lte: new Date(dayInZone(now, workspace.timezone)),
                    },
                  },
                },
              },
            ],
          },
          orderBy: { id: "asc" },
          take: 100,
          ...(caseCursor ? { cursor: { id: caseCursor }, skip: 1 } : {}),
        });
        if (!cases.length) break;
        for (const row of cases) {
          const key = `govextras:case:${row.id}:${row.dueOn.toISOString()}:${dayInZone(now, workspace.timezone)}`;
          const result = await prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
            if (
              await tx.notificationEventRecord.findFirst({
                where: { workspaceId: workspace.id, dedupeKey: key },
              })
            )
              return null;
            const current = await tx.safeguardingCase.findFirst({
              where: {
                workspaceId: workspace.id,
                id: row.id,
                closedAt: null,
                dueOn: row.dueOn,
                workspace: { status: "ACTIVE", archivedAt: null },
              },
            });
            if (!current) return null;
            const grants = await activeHandlers(
              {
                workspace,
                user: { id: "scheduler" },
                membership: { role: "MEMBER" },
              },
              tx,
              now,
            );
            const dueActions = await tx.safeguardingEvent.findMany({
              where: {
                workspaceId: workspace.id,
                caseId: row.id,
                kind: "ACTION",
                completedAt: null,
                dueOn: { lte: new Date(dayInZone(now, workspace.timezone)) },
              },
              select: { ownerId: true },
            });
            const reviewDue =
              current.dueOn.toISOString().slice(0, 10) <=
              dayInZone(now, workspace.timezone);
            const recipients = current.handlerIds.filter(
              (id) =>
                grants.some((g) => g.userId === id) &&
                (reviewDue || dueActions.some((a) => a.ownerId === id)),
            );
            if (!recipients.length) return null;
            return dispatch(
              workspace.id,
              {
                type: "safeguarding.review_due",
                title: "Confidential review due",
                body: "Open your assigned case to review its next action.",
                url: `/w/${workspace.slug}/safeguarding?edit=${row.id}`,
                recipients,
                resource: { type: "safeguarding", id: row.id },
                dedupeKey: key,
                useWorkspaceRules: false,
                data: { caseId: row.id, dueOn: row.dueOn.toISOString() },
              },
              { tx, now },
            );
          });
          await result?.afterCommit();
        }
        caseCursor = cases.at(-1)!.id;
      }
    }
    cursor = workspaces.at(-1)!.id;
  }
}
