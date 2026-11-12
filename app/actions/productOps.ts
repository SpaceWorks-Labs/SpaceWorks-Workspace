"use server";
import { z } from "zod";
import { revalidatePath } from "@/lib/frontend/cache";
import { getWorkspaceForAction } from "@/lib/permissions";
import { canManageProductOps } from "@/lib/roles";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { type ActionResult, NOT_ALLOWED, RATE_LIMITED, SAVE_FAILED, validationError } from "@/lib/actionResult";
import { saveRecord, ProductError, type Actor } from "@/lib/productOps/service";
import { operate } from "@/lib/productOps/operations";
import { attachFile, detachFile } from "@/lib/productOps/files";
import { id } from "@/lib/productOps/schema";
async function run<T>(slug: string, fn: (actor: Actor) => Promise<T>, bucket: "action" | "upload" = "action"): Promise<ActionResult<T>> {
 const actor = await getWorkspaceForAction(slug, "MEMBER", { module: "projects" });
 if (!actor || !canManageProductOps(actor.membership)) return { ok: false, error: NOT_ALLOWED };
 if (await isActionRateLimited(bucket, actor.user.id)) return { ok: false, error: RATE_LIMITED };
 try { const data = await fn(actor); revalidatePath(`/w/${actor.workspace.slug}/product-ops`, "layout"); return { ok: true, data }; }
 catch (error) { if (error instanceof z.ZodError) return validationError(error); if (error instanceof ProductError) return { ok: false, error: error.message }; return { ok: false, error: SAVE_FAILED }; }
}
export async function saveProductRecord(slug: string, raw: unknown) { return run(slug, actor => saveRecord(actor, raw)); }
export async function productOperation(slug: string, raw: unknown) { return run(slug, async actor => { const result = await operate(actor, raw); revalidatePath(`/w/${actor.workspace.slug}/changelog`); revalidatePath(`/w/${actor.workspace.slug}/requests/approvals`); return result; }); }
export async function uploadProductFile(slug: string, form: FormData) {
 return run(slug, actor => { const recordId = id.min(1).parse(form.get("recordId")), file = form.get("file"); if (!(file instanceof File)) throw new ProductError("Choose a file to upload."); return attachFile(actor, recordId, file); }, "upload");
}
export async function removeProductFile(slug: string, recordId: string, fileId: string) { return run(slug, actor => detachFile(actor, id.min(1).parse(recordId), id.min(1).parse(fileId))); }
export async function saveProductOwnership(slug: string, raw: unknown) {
 return run(slug, async actor => { const { saveOwnership } = await import("@/lib/productOps/ownership"); const result = await saveOwnership(actor, raw); revalidatePath(`/w/${actor.workspace.slug}/catalogue`); return result; });
}
