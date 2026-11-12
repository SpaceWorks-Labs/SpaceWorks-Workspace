"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getWorkspaceForAction, requireAuth } from "@/lib/permissions";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { verifyVaultMfa, VAULT_MFA_COOKIE } from "@/lib/vault/mfa";
import { OpsError } from "@/lib/approvals/ops";
import {
  createProject,
  saveEnvironment,
  saveGrant,
  saveFolder,
  changeSecrets,
  previewImport,
  importSecrets,
  takeSnapshot,
  snapshotDiff,
  rollbackSnapshot,
  secretHistory,
  restoreVersion,
} from "@/lib/secrets/service";
import { createServiceToken, revokeServiceToken } from "@/lib/secrets/tokens";
import { requestKeyRotation } from "@/lib/secrets/rotation";
import { createIdentity, manageIdentity } from "@/lib/secrets/identities";
import { createShare } from "@/lib/secrets/shares";
import { approveDeviceCode, revokeCliSession } from "@/lib/secrets/device";
import { SecretsError } from "@/lib/secrets/values";
export async function secretsAction(
  slug: string,
  operation: string,
  input: Record<string, unknown>,
) {
  const actor = await getWorkspaceForAction(slug, "MEMBER", { module: "secrets" });
  if (!actor)
    return {
      ok: false as const,
      error: "You don't have access to this workspace.",
    };
  if (await isActionRateLimited("action", `secrets:${actor.user.id}`))
    return {
      ok: false as const,
      error: "Too many requests. Try again shortly.",
    };
  const context = {
    ...actor,
    proof: (await cookies()).get(VAULT_MFA_COOKIE)?.value,
  };
  try {
    let data: unknown;
    const environment = String(input.environmentId ?? "");
    switch (operation) {
      case "project":
        data = await createProject(context, input);
        break;
      case "environment":
        data = await saveEnvironment(context, input);
        break;
      case "grant":
        data = await saveGrant(context, input);
        break;
      case "folder":
        data = await saveFolder(context, environment, String(input.path));
        break;
      case "change":
        data = await changeSecrets(context, environment, input.changes);
        break;
      case "preview":
        data = await previewImport(
          context,
          environment,
          String(input.path),
          String(input.source),
        );
        break;
      case "import":
        data = await importSecrets(
          context,
          environment,
          String(input.path),
          String(input.source),
          Number(input.revision),
        );
        break;
      case "snapshot":
        data = await takeSnapshot(context, environment, String(input.label));
        break;
      case "diff":
        data = await snapshotDiff(
          context,
          environment,
          String(input.snapshotId),
        );
        break;
      case "rollback":
        data = await rollbackSnapshot(
          context,
          environment,
          String(input.snapshotId),
        );
        break;
      case "history":
        data = await secretHistory(
          context,
          environment,
          String(input.secretId),
          input.cursor ? String(input.cursor) : undefined,
        );
        break;
      case "restore":
        data = await restoreVersion(
          context,
          environment,
          String(input.secretId),
          String(input.versionId),
        );
        break;
      case "rotate-key":
        data = await requestKeyRotation(context, String(input.projectId), String(input.kind));
        break;
      case "identity":
        data = await createIdentity(context, environment, input);
        break;
      case "identity-credential":
      case "identity-reset":
      case "identity-revoke":
      case "identity-revoke-credential":
      case "identity-revoke-access":
      case "identity-permission":
      case "identity-settings":
        data = await manageIdentity(context, environment, String(input.id), operation.slice(9) as "credential" | "reset" | "revoke" | "revoke-credential" | "revoke-access" | "permission" | "settings", input);
        break;
      case "token":
        data = {
          issuedCredential: await createServiceToken(
            context,
            environment,
            input,
          ),
        };
        break;
      case "revoke-token":
        data = await revokeServiceToken(context, environment, String(input.id));
        break;
      case "share":
        data = {
          shareCapability: await createShare(context, environment, input),
        };
        break;
      case "mfa": {
        if (await isActionRateLimited("auth", `secrets-mfa:${actor.user.id}`))
          throw new SecretsError("Too many attempts. Try again shortly.");
        const code = String(input.code);
        if (!/^\d{6}$/.test(code))
          throw new SecretsError("Enter a six-digit authenticator code.");
        const proof = await verifyVaultMfa(actor.user.id, code);
        (await cookies()).set(VAULT_MFA_COOKIE, proof, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "strict",
          path: "/",
          maxAge: 300,
        });
        break;
      }
      default:
        throw new SecretsError("That action is unavailable.");
    }
    revalidatePath(`/w/${slug}/secrets`);
    return { ok: true as const, data };
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof SecretsError || error instanceof OpsError
          ? error.message
          : "Couldn't save. Check the fields and try again.",
    };
  }
}
export async function approveSecretsDevice(
  userCode: string,
  approve: boolean,
  code?: string,
) {
  const user = await requireAuth();
  if (await isActionRateLimited("auth", `device:${user.id}`))
    return { ok: false, error: "Too many attempts. Try again shortly." };
  try {
    let proof = (await cookies()).get(VAULT_MFA_COOKIE)?.value;
    if (code) {
      if (!/^\d{6}$/.test(code))
        throw new SecretsError("Enter a six-digit authenticator code.");
      proof = await verifyVaultMfa(user.id, code);
    }
    await approveDeviceCode(user.id, userCode, approve, proof);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof SecretsError || error instanceof OpsError
          ? error.message
          : "Couldn't authorise this device. Try again.",
    };
  }
}
export async function revokeSecretsCliSession(id: string) {
  const user = await requireAuth();
  if (await isActionRateLimited("action", user.id))
    return { ok: false, error: "Too many requests. Try again shortly." };
  await revokeCliSession(user.id, id);
  revalidatePath("/account");
  return { ok: true };
}
