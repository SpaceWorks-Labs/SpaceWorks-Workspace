import "server-only";
import { prisma, type DbClient } from "@/lib/db";
import { activeMemberOrSuperAdmin } from "@/lib/accessMember";
import type { OpsActor } from "@/lib/approvals/context";
import { canUseSecrets, canManageSecrets } from "@/lib/roles";
import { SecretsError, ROLES, type SecretRole } from "./values";
import { hasVaultMfa } from "@/lib/vault/mfa";
export type SecretsActor = OpsActor & {
  proof?: string;
  machine?: {
    id: string;
    environmentId: string;
    path: string;
    writable: boolean;
    identityPermissions?: { environmentId: string; path: string; role: string }[];
  };
  cliMfaAt?: Date | null;
};
export async function environmentAccess(
  actor: SecretsActor,
  environmentId: string,
  permission: SecretRole,
  client: DbClient = prisma,
) {
  const membership = await activeMemberOrSuperAdmin(client, actor);
  if (
    !membership ||
    !canUseSecrets(membership) ||
    membership.role !== actor.membership.role
  )
    throw new SecretsError("That environment is unavailable.");
  const env = await client.secretEnvironment.findFirst({
    where: { id: environmentId, workspaceId: actor.workspace.id },
  });
  if (!env) throw new SecretsError("That environment is unavailable.");
  let role: SecretRole = canManageSecrets(membership) ? "ADMIN" : "NONE";
  if (role !== "ADMIN") {
    const grants = await client.secretGrant.findMany({
      where: {
        workspaceId: actor.workspace.id,
        projectId: env.projectId,
        userId: actor.user.id,
        environmentId: { in: ["", env.id] },
      },
    });
    const explicit = grants.find((g) => g.environmentId === env.id);
    const inherited = grants.find((g) => g.environmentId === "");
    role = (explicit?.role ??
      (env.production ? "NONE" : inherited?.role) ??
      "NONE") as SecretRole;
  }
  if (actor.machine?.identityPermissions) {
    const grants = actor.machine.identityPermissions.filter(p => p.environmentId === env.id);
    role = grants.reduce((best, p) => ROLES.indexOf(p.role as SecretRole) > ROLES.indexOf(best) ? p.role as SecretRole : best, "NONE" as SecretRole);
  }
  if (
    actor.machine && !actor.machine.identityPermissions &&
    (actor.machine.environmentId !== env.id ||
      ROLES.indexOf(permission) >
        ROLES.indexOf(actor.machine.writable ? "WRITE" : "READ") ||
      permission === "ADMIN")
  )
    role = "NONE";
  if (
    !ROLES.includes(role) ||
    ROLES.indexOf(role) < ROLES.indexOf(permission) ||
    role === "NONE"
  )
    throw new SecretsError("You don't have access to this environment.");
  return { ...env, accessRole: role };
}
export function checkPath(actor: SecretsActor, path: string, environmentId?: string, writing = false, namesOnly = false) {
  if (actor.machine?.identityPermissions) {
    const p = actor.machine.identityPermissions.find(p => p.environmentId === environmentId && p.path === path);
    if (!p || ![...(writing ? ["WRITE"] : [...(namesOnly ? ["KEYS"] : []), "READ", "WRITE"])].includes(p.role)) throw new SecretsError("This identity cannot access that folder.");
    return;
  }
  if (actor.machine && actor.machine.path !== path)
    throw new SecretsError("This token cannot access that folder.");
}
export async function requireSecretsMfa(
  actor: SecretsActor,
  production: boolean,
  exporting = false,
  client: DbClient = prisma,
) {
  if (actor.machine || (!production && !exporting)) return;
  if (
    actor.cliMfaAt &&
    Date.now() - actor.cliMfaAt.getTime() < 300000 &&
    actor.cliMfaAt.getTime() <= Date.now()
  ) {
    const user = await client.user.findFirst({
      where: { id: actor.user.id, disabledAt: null },
      select: { mfaEnabledAt: true },
    });
    if (user?.mfaEnabledAt && user.mfaEnabledAt <= actor.cliMfaAt) return;
  }
  if (!(await hasVaultMfa(actor.user.id, actor.proof, new Date(), client)))
    throw new SecretsError(
      "Verify a fresh two-step code before revealing production values or exporting.",
    );
}
