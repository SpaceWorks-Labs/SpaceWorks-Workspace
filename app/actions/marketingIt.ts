"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getWorkspaceForAction } from "@/lib/permissions";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { type ActionResult, NOT_ALLOWED, RATE_LIMITED, SAVE_FAILED, validationError } from "@/lib/actionResult";
import { saveRecord, archiveRecord, MarketingItError, type Actor } from "@/lib/marketingIt/service";
import { attachFile, detachFile } from "@/lib/marketingIt/files";
import { decideAccess, completeReview } from "@/lib/marketingIt/reviews";
import { id } from "@/lib/marketingIt/schema";
// Marketing records live in Outreach and IT records in Services; each action is gated by its record's module.
const MARKETING_KINDS = new Set(["CONTENT", "BRAND", "PROPOSAL"]);
const kindModule = (kind: unknown) => (MARKETING_KINDS.has(String(kind)) ? "outreach" : "services") as "outreach" | "services";
type RecordRef = { kind: unknown } | { recordId: unknown };
async function moduleOf(slug: string, record: RecordRef) {
 if ("kind" in record) return kindModule(record.kind);
 if (typeof record.recordId !== "string") return null;
 const row = await prisma.marketingItRecord.findFirst({ where: { id: record.recordId, workspace: { slug } }, select: { kind: true } });
 return row ? kindModule(row.kind) : null;
}
async function run<T>(slug: string, record: RecordRef, fn: (actor: Actor) => Promise<T>, bucket: "action" | "upload" = "action"): Promise<ActionResult<T>> {
 const target = await moduleOf(slug, record);
 const actor = target ? await getWorkspaceForAction(slug, "MEMBER", { module: target }) : null; if (!actor) return { ok: false, error: NOT_ALLOWED };
 if (await isActionRateLimited(bucket, actor.user.id)) return { ok: false, error: RATE_LIMITED };
 try { const data = await fn(actor); revalidatePath(`/w/${slug}/marketing`); revalidatePath(`/w/${slug}/it`); revalidatePath(`/w/${slug}/assets`); return { ok: true, data }; }
 catch (e) { if (e instanceof z.ZodError) return validationError(e); if (e instanceof MarketingItError) return { ok: false, error: e.message }; if (e && typeof e === "object" && "code" in e && e.code === "P2002") return { ok: false, error: "This asset, licence or file is already linked. Open its existing record." }; return { ok: false, error: SAVE_FAILED }; }
}
export async function saveMarketingIt(slug: string, raw: unknown) { return run(slug, { kind: (raw as { kind?: unknown } | null)?.kind }, actor => saveRecord(actor, raw)); }
export async function archiveMarketingIt(slug: string, recordId: string, archived: boolean) { return run(slug, { recordId }, actor => archiveRecord(actor, id.min(1).parse(recordId), z.boolean().parse(archived))); }
export async function decideMarketingItAccess(slug: string, raw: unknown) { return run(slug, { recordId: (raw as { recordId?: unknown } | null)?.recordId }, actor => decideAccess(actor, raw)); }
export async function completeMarketingItReview(slug: string, recordId: string) { return run(slug, { recordId }, actor => completeReview(actor, id.min(1).parse(recordId))); }
export async function uploadMarketingItFile(slug: string, form: FormData) { return run(slug, { recordId: form.get("recordId") }, actor => { const file = form.get("file"); if (!(file instanceof File)) throw new MarketingItError("Choose a file to upload."); return attachFile(actor, id.min(1).parse(form.get("recordId")), file); }, "upload"); }
export async function linkMarketingItFile(slug: string, recordId: string, fileId: string) { return run(slug, { recordId }, actor => attachFile(actor, id.min(1).parse(recordId), id.min(1).parse(fileId))); }
export async function removeMarketingItFile(slug: string, recordId: string, fileId: string) { return run(slug, { recordId }, actor => detachFile(actor, id.min(1).parse(recordId), id.min(1).parse(fileId))); }
