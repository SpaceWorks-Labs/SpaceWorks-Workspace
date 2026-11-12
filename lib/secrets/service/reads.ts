import "server-only";
import { openValue } from "@/lib/secrets/encryption";
import { prisma } from "@/lib/db";
import {
  environmentAccess,
  checkPath,
  requireSecretsMfa,
  type SecretsActor,
} from "@/lib/secrets/access";
import { normalisePath, createValueResolver, SecretsError } from "@/lib/secrets/values";
import { audit } from "@/lib/secrets/mutations";

export async function readSecrets(
  actor: SecretsActor,
  environmentId: string,
  path: string,
  options: {
    key?: string;
    keys?: string[];
    exporting?: boolean;
    raw?: boolean;
    copying?: boolean;
  } = {},
) {
  normalisePath(path);
  checkPath(actor, path, environmentId);
  try {
    return await prisma.$transaction(
      async (tx) => {
        const env = await environmentAccess(actor, environmentId, "READ", tx);
        await requireSecretsMfa(actor, env.production, !!options.exporting, tx);
        const rows = await tx.applicationSecret.findMany({
          where: {
            workspaceId: actor.workspace.id,
            environmentId,
            path,
            deletedAt: null,
            ...(options.key ? { key: options.key } : options.keys ? { key: { in: options.keys } } : {}),
          },
        });
        if (options.key && !rows.length)
          throw new SecretsError("That key is unavailable.");
        const values: Record<string, string> = Object.create(null);
        const resolve = createValueResolver(async (loc) => {
          const target = await tx.secretEnvironment.findFirst({
            where: {
              workspaceId: actor.workspace.id,
              projectId: env.projectId,
              slug: loc.environment,
            },
          });
          if (!target)
            throw new SecretsError(
              "A referenced key is unavailable or inaccessible.",
            );
          await environmentAccess(actor, target.id, "READ", tx);
          checkPath(actor, loc.path, target.id);
          await requireSecretsMfa(
            actor,
            target.production,
            !!options.exporting,
            tx,
          );
          const secret = await tx.applicationSecret.findFirst({
            where: {
              workspaceId: actor.workspace.id,
              environmentId: target.id,
              path: loc.path,
              key: loc.key,
              deletedAt: null,
            },
          });
          if (!secret)
            throw new SecretsError(
              "A referenced key is unavailable or inaccessible.",
            );
          return openValue(secret, tx);
        });
        for (const row of rows)
          values[row.key] = options.raw
            ? await openValue(row, tx)
            : await resolve({ environment: env.slug, path, key: row.key });
        if (options.keys) for (const row of rows) await audit(tx, actor.workspace.id, env.projectId, actor.user.id, "revealed", environmentId, row.id, row.key, actor.machine?.id);
        else await audit(
          tx,
          actor.workspace.id,
          env.projectId,
          actor.user.id,
          options.exporting ? "exported" : options.copying ? "copied" : "revealed",
          environmentId,
          options.key ? rows[0]?.id : undefined,
          options.key ? rows[0]?.key : undefined,
          actor.machine?.id,
        );
        return values;
      },
      { timeout: 20000 },
    );
  } catch (error) {
    if (error instanceof SecretsError) {
      const env = await prisma.secretEnvironment.findFirst({
        where: { workspaceId: actor.workspace.id, id: environmentId },
        select: { id: true, projectId: true },
      });
      const membership = await prisma.membership.findFirst({
        where: {
          workspaceId: actor.workspace.id,
          userId: actor.user.id,
          status: "ACTIVE",
          user: { disabledAt: null },
          workspace: { status: "ACTIVE", archivedAt: null },
        },
      });
      if (env && membership)
        await prisma.$transaction((tx) =>
          audit(
            tx,
            actor.workspace.id,
            env.projectId,
            actor.user.id,
            options.exporting ? "export_denied" : "reveal_denied",
            env.id,
          ),
        );
    }
    throw error;
  }
}
