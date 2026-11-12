"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getWorkspaceForAction } from "@/lib/permissions";
import { canManageFunding } from "@/lib/roles";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { type ActionResult, NOT_ALLOWED, RATE_LIMITED, SAVE_FAILED, validationError } from "@/lib/actionResult";
import { saveRecord, operate, attachFile, detachFile, FundingError, type Actor } from "@/lib/funding/service";
import { id } from "@/lib/funding/schema";
async function run<T>(slug: string, fn: (actor: Actor) => Promise<T>, bucket: "action" | "upload" = "action"): Promise<ActionResult<T>> {
  const actor = await getWorkspaceForAction(slug, "ADMIN", { module: "finance" });
  if (!actor || !canManageFunding(actor.membership)) return { ok: false, error: NOT_ALLOWED };
  if (await isActionRateLimited(bucket, actor.user.id)) return { ok: false, error: RATE_LIMITED };
  try { const data = await fn(actor); revalidatePath(`/w/${actor.workspace.slug}/funding`, "layout"); revalidatePath(`/w/${actor.workspace.slug}/documents`,"layout"); return { ok: true, data }; }
  catch (e) {
    if (e instanceof z.ZodError) return validationError(e);
    if (e instanceof FundingError) return { ok: false, error: e.message };
    if (e && typeof e === "object" && "code" in e && e.code === "P2002") return { ok: false, error: "This profile, receipt number, month or review already exists. Edit its saved record." };
    return { ok: false, error: SAVE_FAILED };
  }
}
export async function saveFunding(slug: string, raw: unknown) { return run(slug, actor => saveRecord(actor, raw)); }
export async function fundingOperation(slug: string, raw: unknown) { return run(slug, actor => operate(actor, raw)); }
export async function uploadFundingFile(slug: string, form: FormData) {
  return run(slug, actor => { const recordId = id.min(1).parse(form.get("recordId")); const file = form.get("file"); if (!(file instanceof File)) throw new FundingError("Choose a file to upload."); return attachFile(actor, recordId, file); }, "upload");
}
export async function removeFundingFile(slug: string, recordId: string, fileId: string) { return run(slug, actor => detachFile(actor, id.min(1).parse(recordId), id.min(1).parse(fileId))); }
