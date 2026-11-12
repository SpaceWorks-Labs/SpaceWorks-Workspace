"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getWorkspaceForAction } from "@/lib/permissions";
import { canManageGovernance } from "@/lib/roles";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import {
  type ActionResult,
  NOT_ALLOWED,
  RATE_LIMITED,
  SAVE_FAILED,
  validationError,
} from "@/lib/actionResult";
import {
  saveRecord,
  operate,
  changeBank,
  revealBank,
  attachFile,
  detachFile,
  GovernanceError,
  type Actor,
} from "@/lib/governance/service";

async function run<T>(
  slug: string,
  fn: (actor: Actor) => Promise<T>,
  bucket: "action" | "upload" = "action",
): Promise<ActionResult<T>> {
  const actor = await getWorkspaceForAction(slug, "ADMIN", { module: "operations" });
  if (!actor || !canManageGovernance(actor.membership))
    return { ok: false, error: NOT_ALLOWED };
  if (await isActionRateLimited(bucket, actor.user.id))
    return { ok: false, error: RATE_LIMITED };
  try {
    const data = await fn(actor);
    revalidatePath(`/w/${slug}/governance`, "layout");
    return { ok: true, data };
  } catch (error) {
    if (error instanceof z.ZodError) return validationError(error);
    if (error instanceof GovernanceError)
      return { ok: false, error: error.message };
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2002"
    )
      return {
        ok: false,
        error:
          "This entity or vendor already has a record. Edit the existing record.",
      };
    return { ok: false, error: SAVE_FAILED };
  }
}
export async function saveGovernance(slug: string, input: unknown) {
  return run(slug, (actor) => saveRecord(actor, input));
}
export async function governanceOperation(slug: string, input: unknown) {
  return run(slug, (actor) => operate(actor, input));
}
export async function saveVendorBank(slug: string, input: unknown) {
  return run(slug, (actor) => changeBank(actor, input));
}
export async function revealVendorBank(slug: string, vendorId: string) {
  return run(slug, (actor) =>
    revealBank(actor, z.string().min(1).max(64).parse(vendorId)),
  );
}
export async function uploadGovernanceFile(slug: string, form: FormData) {
  return run(
    slug,
    (actor) => {
      const recordId = z.string().min(1).max(64).parse(form.get("recordId"));
      const file = form.get("file");
      if (!(file instanceof File))
        throw new GovernanceError("Choose a file to upload.");
      return attachFile(actor, recordId, file);
    },
    "upload",
  );
}
export async function removeGovernanceFile(
  slug: string,
  recordId: string,
  fileId: string,
) {
  return run(slug, (actor) =>
    detachFile(
      actor,
      z.string().min(1).max(64).parse(recordId),
      z.string().min(1).max(64).parse(fileId),
    ),
  );
}
