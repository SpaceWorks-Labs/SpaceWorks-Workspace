"use server";
import { z } from "zod";
import { getWorkspaceForAction } from "@/lib/permissions";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { revalidatePath } from "next/cache";
import {
  type ActionResult,
  NOT_ALLOWED,
  RATE_LIMITED,
  SAVE_FAILED,
  validationError,
} from "@/lib/actionResult";
import { GovernanceError, type Actor } from "@/lib/governance/service";
import {
  appointHandler,
  createCase,
  addCaseEvent,
  updateCase,
  completeCaseAction,
  uploadCaseFile,
} from "@/lib/govextras/cases";
import { linkConflict } from "@/lib/govextras/conflicts";
import { freezePack } from "@/lib/govextras/packs";
const id = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9_-]+$/);
async function run<T>(
  slug: string,
  fn: (actor: Actor) => Promise<T>,
  upload = false,
): Promise<ActionResult<T>> {
  const actor = await getWorkspaceForAction(slug, "MEMBER", { module: "operations" });
  if (!actor) return { ok: false, error: NOT_ALLOWED };
  if (await isActionRateLimited(upload ? "upload" : "action", actor.user.id))
    return { ok: false, error: RATE_LIMITED };
  try {
    const data = await fn(actor);
    revalidatePath(`/w/${slug}/governance`, "layout");
    revalidatePath(`/w/${slug}/safeguarding`);
    return { ok: true, data };
  } catch (e) {
    if (e instanceof z.ZodError) return validationError(e);
    if (e instanceof GovernanceError) return { ok: false, error: e.message };
    return { ok: false, error: SAVE_FAILED };
  }
}
export async function saveHandlerAppointment(slug: string, input: unknown) {
  return run(slug, (a) => appointHandler(a, input));
}
export async function saveSafeguardingCase(slug: string, input: unknown) {
  return run(slug, (a) => createCase(a, input));
}
export async function saveSafeguardingEvent(slug: string, input: unknown) {
  return run(slug, (a) => addCaseEvent(a, input));
}
export async function changeSafeguardingCase(slug: string, input: unknown) {
  return run(slug, (a) => updateCase(a, input));
}
export async function finishSafeguardingAction(
  slug: string,
  caseId: string,
  eventId: string,
) {
  return run(slug, (a) =>
    completeCaseAction(a, id.parse(caseId), id.parse(eventId)),
  );
}
export async function uploadSafeguardingFile(slug: string, form: FormData) {
  return run(
    slug,
    (a) => {
      const file = form.get("file");
      if (!(file instanceof File))
        throw new GovernanceError("Choose an image or PDF.");
      return uploadCaseFile(a, id.parse(form.get("recordId")), file);
    },
    true,
  );
}
export async function saveConflictLink(slug: string, input: unknown) {
  return run(slug, (a) => linkConflict(a, input));
}
export async function freezeGovernancePack(slug: string, recordId: string) {
  return run(slug, (a) => freezePack(a, id.parse(recordId)));
}
