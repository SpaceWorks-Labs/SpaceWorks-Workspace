import "server-only";
import { prisma } from "@/lib/db";
import { parseCsv, mapLinkRows, csvMappingSchema } from "@/lib/shell/csv";
import { getObject } from "@/lib/storage";
import { dispatch } from "@/lib/notify";
import { indexSearchDocument } from "@/lib/search/documents";
import { recordAuditEvent } from "@/lib/audit";
import { hasRoleAtLeast } from "@/lib/roles";

export async function processImport(now: Date): Promise<boolean> {
  let afterCommit: (() => Promise<void>) | undefined;
  const result = await prisma.$transaction(
    async (tx) => {
      const jobs = await tx.$queryRaw<
        Array<{
          id: string;
          workspaceId: string;
          requestedById: string | null;
          sourceFileId: string;
          mapping: unknown;
          dryRun: boolean;
          entityType: string;
        }>
      >`SELECT * FROM "ImportJob" WHERE status='QUEUED' ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED`;
      const job = jobs[0];
      if (!job) return false;
      await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${job.workspaceId} FOR NO KEY UPDATE`;
      const member = job.requestedById
        ? await tx.membership.findFirst({
            where: {
              workspaceId: job.workspaceId,
              userId: job.requestedById,
              status: "ACTIVE",
              user: { disabledAt: null },
              workspace: { status: "ACTIVE", archivedAt: null },
            },
          })
        : null;
      if (!member || !hasRoleAtLeast(member.role, "ADMIN")) {
        await tx.importJob.update({
          where: { id: job.id },
          data: { status: "CANCELLED", finishedAt: now },
        });
        return true;
      }
      const file = await tx.fileObject.findFirst({
        where: {
          id: job.sourceFileId,
          workspaceId: job.workspaceId,
          deletedAt: null,
          size: { lte: 1_000_000 },
        },
        select: { storageKey: true },
      });
      const object = file ? await getObject(file.storageKey) : null;
      const mapping = csvMappingSchema.safeParse(job.mapping);
      if (!object || !mapping.success || job.entityType !== "link") {
        await tx.importJob.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            finishedAt: now,
            stats: {
              errors: [
                {
                  row: 0,
                  error: "The source file or column mapping is unavailable.",
                },
              ],
            },
          },
        });
        return true;
      }
      let rows: ReturnType<typeof mapLinkRows>;
      try {
        rows = mapLinkRows(
          parseCsv(Buffer.from(object.body).toString("utf8")),
          mapping.data,
        );
      } catch {
        await tx.importJob.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            finishedAt: now,
            stats: {
              errors: [
                {
                  row: 0,
                  error:
                    "The CSV could not be read. Check the file and try again.",
                },
              ],
            },
          },
        });
        return true;
      }
      const workspace = await tx.workspace.findUniqueOrThrow({
        where: { id: job.workspaceId },
        select: { slug: true },
      });
      let created = 0,
        skipped = 0;
      const errors = rows
        .filter((r) => r.error)
        .map((r) => ({ row: r.row, error: r.error }));
      // Invalid files remain a dry run; a commit is all-or-nothing for valid rows.
      if (!job.dryRun && !errors.length) {
        for (const row of rows) {
          if (!row.data) continue;
          if (
            await tx.linkItem.findFirst({
              where: { workspaceId: job.workspaceId, url: row.data.url },
              select: { id: true },
            })
          ) {
            skipped++;
            continue;
          }
          const link = await tx.linkItem.create({
            data: {
              ...row.data,
              workspaceId: job.workspaceId,
              createdById: job.requestedById,
            },
          });
          await indexSearchDocument(
            {
              workspaceId: job.workspaceId,
              entityType: "link",
              entityId: link.id,
              title: link.title,
              body: link.description ?? "",
              url: `/w/${workspace.slug}/links#${link.id}`,
            },
            tx,
          );
          created++;
        }
      }
      await tx.importJob.update({
        where: { id: job.id },
        data: {
          status: errors.length ? "FAILED" : "SUCCEEDED",
          finishedAt: now,
          stats: {
            total: rows.length,
            valid: rows.length - errors.length,
            created,
            updated: 0,
            skipped,
            errors,
          },
        },
      });
      const dispatched = await dispatch(
        job.workspaceId,
        {
          type: "import.finished",
          title: job.dryRun ? "CSV preview is ready" : "CSV import finished",
          url: `/w/${workspace.slug}/settings/import`,
          recipients: [member.userId],
          data: {
            importJobId: job.id,
            created,
            updated: 0,
            skipped,
            errors: errors.length,
          },
        },
        { tx, now },
      );
      afterCommit = dispatched.afterCommit;
      await recordAuditEvent({
        workspaceId: job.workspaceId,
        action: "shell.import_completed",
        targetId: job.id,
        metadata: { created, dryRun: job.dryRun },
        client: tx,
      });
      return true;
    },
    { timeout: 60000 },
  );
  await afterCommit?.();
  return result;
}
