import "server-only";

import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { createWorkspaceWithDefaults } from "@/lib/workspaces";

/** First-run setup is open only while the instance has no users at all. */
export async function isSetupOpen() {
  return (await prisma.user.count()) === 0;
}

export type SetupInput = {
  name: string;
  email: string;
  username?: string;
  password: string;
  workspaceName: string;
  workspaceSlug: string;
  timezone?: string;
};

/**
 * Create the instance owner and the first workspace. A transaction-scoped
 * advisory lock plus a re-check inside it makes setup succeed exactly once,
 * even with concurrent submissions.
 */
export async function performSetup(input: SetupInput): Promise<{ ok: true; userId: string; workspaceSlug: string } | { ok: false; error: string }> {
  const passwordHash = await bcrypt.hash(input.password, 12);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('sww:first-run-setup'))`;
    if ((await tx.user.count()) > 0) return { ok: false as const, error: "Setup is already complete. Sign in instead." };
    const user = await tx.user.create({
      data: { name: input.name.trim(), email: input.email.trim().toLowerCase(), username: input.username ?? null, passwordHash, emailVerified: new Date() },
      select: { id: true },
    });
    const workspace = await createWorkspaceWithDefaults(tx, {
      name: input.workspaceName.trim(),
      slug: input.workspaceSlug,
      ownerId: user.id,
      timezone: input.timezone,
    });
    await recordAuditEvent({ client: tx, action: "instance.setup_completed", workspaceId: workspace.id, actorId: user.id, targetType: "Workspace", targetId: workspace.id, ip: null });
    return { ok: true as const, userId: user.id, workspaceSlug: workspace.slug };
  });
}
