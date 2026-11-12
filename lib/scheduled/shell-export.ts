import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { buildWorkspaceExport } from "@/lib/shell/export";
import { jsonZip } from "@/lib/shell/zip";
import { putObject } from "@/lib/storage";
import { dispatch } from "@/lib/notify";
import { recordAuditEvent } from "@/lib/audit";
import { hasRoleAtLeast } from "@/lib/roles";

export async function processExport(now: Date): Promise<boolean> {
  let afterCommit: (() => Promise<void>) | undefined;
  const processed = await prisma.$transaction(
    async (tx) => {
      const jobs = await tx.$queryRaw<
        Array<{
          id: string;
          workspaceId: string;
          requestedById: string | null;
          scope: unknown;
          format: string;
        }>
      >`SELECT * FROM "ExportJob" WHERE status='QUEUED' ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED`;
      const job = jobs[0];
      if (!job) return false;
      const membership = job.requestedById
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
      if (!membership || !hasRoleAtLeast(membership.role, "ADMIN")) {
        await tx.exportJob.update({
          where: { id: job.id },
          data: {
            status: "CANCELLED",
            finishedAt: now,
            error: "The requester no longer has access.",
          },
        });
        return true;
      }
      try {
        await tx.exportJob.update({
          where: { id: job.id },
          data: { status: "RUNNING" },
        });
        const bundle = await buildWorkspaceExport(
          job.workspaceId,
          !!(
            job.scope &&
            typeof job.scope === "object" &&
            "includeMessages" in job.scope &&
            job.scope.includeMessages
          ),
          tx,
        );
        const json = JSON.stringify(bundle);
        if (Buffer.byteLength(json) > 50_000_000) throw new Error("too large");
        const key = `workspaces/${job.workspaceId}/exports/${job.id}/${randomUUID()}.${job.format === "JSON" ? "json" : "zip"}`;
        await putObject(
          key,
          job.format === "JSON" ? Buffer.from(json) : jsonZip(json),
          job.format === "JSON" ? "application/json" : "application/zip",
        );
        await tx.exportJob.update({
          where: { id: job.id },
          data: {
            status: "SUCCEEDED",
            finishedAt: now,
            expiresAt: new Date(now.getTime() + 7 * 86400000),
            storageKey: key,
          },
        });
        const workspace = await tx.workspace.findUniqueOrThrow({
          where: { id: job.workspaceId },
          select: { slug: true },
        });
        const result = await dispatch(
          job.workspaceId,
          {
            type: "export.ready",
            title: "Your workspace export is ready",
            url: `/w/${workspace.slug}/settings/export`,
            recipients: [membership.userId],
            data: { exportJobId: job.id },
          },
          { tx, now },
        );
        afterCommit = result.afterCommit;
        await recordAuditEvent({
          workspaceId: job.workspaceId,
          action: "shell.export_completed",
          targetId: job.id,
          client: tx,
        });
      } catch {
        await tx.exportJob.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            finishedAt: now,
            error:
              "Couldn't create the export. Request a new export or contact the operator.",
          },
        });
      }
      return true;
    },
    { timeout: 120000, isolationLevel: "RepeatableRead", maxWait: 5000 },
  );
  await afterCommit?.();
  return processed;
}
