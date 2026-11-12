import "server-only";
import { workspacesWithoutModule } from "@/lib/modules-server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { dispatch } from "@/lib/notify/dispatch";
import { environmentAccess } from "@/lib/secrets/access";
import { resumeRotations } from "@/lib/secrets/rotation";
import { audit } from "@/lib/secrets/mutations";
export async function run(now = new Date()) {
  const off = await workspacesWithoutModule("secrets");
  await resumeRotations();
  await prisma.cliDeviceCode.deleteMany({ where: { expiresAt: { lte: now } } });
  const workspaces = await prisma.workspace.findMany({
    where: { id: { notIn: off } },
    select: {
      id: true,
      slug: true,
      name: true,
      timezone: true,
      archivedAt: true,
    },
    take: 10000,
  });
  for (const workspace of workspaces) {
    let cursor = "";
    do {
      const batch = await prisma.$transaction(
        async (tx) => {
          const lock = await tx.$queryRaw<
            {
              locked: boolean;
            }[]
          >`SELECT pg_try_advisory_xact_lock(hashtext(${`secrets:${workspace.id}`})) AS locked`;
          if (!lock[0]?.locked) return null;
          if (!cursor) {
            const leaseCutoff = new Date(now.getTime() - 30 * 86400000);
            await tx.secretIdentityToken.deleteMany({ where: { workspaceId: workspace.id, OR: [{ expiresAt: { lt: leaseCutoff } }, { revokedAt: { lt: leaseCutoff } }] } });
            const expired = await tx.secretShare.findMany({
              where: { workspaceId: workspace.id, expiresAt: { lte: now } },
              select: { id: true, projectId: true },
            });
            for (const row of expired) {
              await tx.secretShare.deleteMany({
                where: { workspaceId: workspace.id, id: row.id },
              });
              await audit(
                tx,
                workspace.id,
                row.projectId,
                null,
                "share_expired",
                undefined,
                row.id,
              );
            }
          }
          if (workspace.archivedAt) return null;
          // Compare each row's deadline in SQL, then traverse only overdue metadata.
          // No ciphertext is loaded, and each batch commits before the next begins.
          const rows = await tx.$queryRaw<{
            id: string; ownerId: string; environmentId: string; rotatedAt: Date;
          }[]>(Prisma.sql`
            SELECT "id", "ownerId", "environmentId", "rotatedAt"
            FROM "ApplicationSecret"
            WHERE "workspaceId" = ${workspace.id}
              AND "deletedAt" IS NULL
              AND "rotateEveryDays" > 0
              AND "rotatedAt" + "rotateEveryDays" * INTERVAL '1 day' <= ${now}
              AND "id" > ${cursor}
            ORDER BY "id" ASC
            LIMIT 200
          `);
          const callbacks = [];
          for (const row of rows) {
            const m = await tx.membership.findFirst({
              where: {
                workspaceId: workspace.id,
                userId: row.ownerId,
                status: "ACTIVE",
                user: { disabledAt: null },
              },
            });
            if (!m) continue;
            try {
              await environmentAccess(
                {
                  user: { id: row.ownerId, name: null },
                  workspace,
                  membership: m,
                },
                row.environmentId,
                "READ",
                tx,
              );
            } catch {
              continue;
            }
            const event = await dispatch(
              workspace.id,
              {
                type: "secrets.rotation_due",
                title: "An application secret is due for rotation",
                recipients: [row.ownerId],
                useWorkspaceRules: false,
                url: `/w/${workspace.slug}/secrets?environment=${row.environmentId}`,
                dedupeKey: `secrets-rotation:${row.id}:${row.rotatedAt.toISOString()}:${now.toISOString().slice(0, 10)}`,
                data: { secretId: row.id, environmentId: row.environmentId },
              },
              { tx },
            );
            callbacks.push(event.afterCommit);
          }
          return { callbacks, nextCursor: rows.length === 200 ? rows.at(-1)!.id : "" };
        },
        { timeout: 20000 },
      );
      if (!batch) break;
      for (const after of batch.callbacks) await after();
      cursor = batch.nextCursor;
    } while (cursor);
  }
}
