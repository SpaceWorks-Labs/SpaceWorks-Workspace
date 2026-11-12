"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getWorkspaceForAction } from "@/lib/permissions";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import {
  actionError,
  validationError,
  NOT_ALLOWED,
  RATE_LIMITED,
  SAVE_FAILED,
  type ActionResult,
} from "@/lib/actionResult";
import {
  documentsAccess,
  DocumentsError,
  lockDocuments,
} from "@/lib/documents/access";
import {
  saveDraft,
  getSettings,
  issueDocument,
  cancelDocument,
  saveSettings,
  saveReference,
  saveEvidence,
  allocatePayment,
  audit,
} from "@/lib/documents/service";
import { uploadDocumentFiles } from "@/lib/documents/files";
import { queueDocumentEmail } from "@/lib/documents/email";
import { addPreArn, saveFilingBatch } from "@/lib/documents/filings";
import { serialNumber, TYPES, GST_TYPES } from "@/lib/documents/rules";
export async function documentAction(
  slug: string,
  operation: string,
  form: FormData,
): Promise<ActionResult<{ id: string }>> {
  const actor = await getWorkspaceForAction(slug, "ADMIN", { module: "knowledge" });
  if (!actor) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("apiWrite", `documents:${actor.user.id}`))
    return actionError(RATE_LIMITED);
  try {
    await documentsAccess(actor);
    if (String(form.get("payload") ?? "").length > 150000)
      return actionError("Shorten the document before saving.");
    const raw = JSON.parse(String(form.get("payload") || "{}")) as Record<
      string,
      unknown
    >;
    let id = "";
    const recordId = z
      .string()
      .max(64)
      .regex(/^[A-Za-z0-9_-]*$/)
      .parse(String(raw.id ?? ""));
    switch (operation) {
      case "preArn":
        id = await addPreArn(actor, raw);
        break;
      case "filing":
        id = await saveFilingBatch(actor, raw);
        break;
      case "draft":
        id = await saveDraft(actor, raw);
        break;
      case "issue":
        id = await issueDocument(actor, recordId);
        break;
      case "cancel":
        id = await cancelDocument(actor, recordId, String(raw.reason ?? ""));
        break;
      case "profile":
        id = await saveSettings(actor, raw);
        break;
      case "reference":
        id = await saveReference(
          actor,
          String(
            raw.referenceKind ??
              (raw.kind === "GST" ||
              raw.kind === "DONATION_APPROVAL" ||
              raw.kind === "FCRA" ||
              raw.kind === "VAT"
                ? "REGISTRATION"
                : raw.kind),
          ),
          String(raw.name),
          raw,
          recordId || undefined,
        );
        break;
      case "evidence":
        id = await saveEvidence(actor, recordId, raw);
        break;
      case "allocation":
        id = await allocatePayment(actor, raw);
        break;
      case "email":
        id = await queueDocumentEmail(actor, recordId, String(raw.recipient));
        break;
      case "upload": {
        const ids = await uploadDocumentFiles(
          actor,
          recordId,
          String(raw.kind),
          form
            .getAll("files")
            .filter((f): f is File => f instanceof File && f.size > 0),
        );
        id = recordId || ids[0];
        break;
      }
      case "series": {
        const v = z
          .object({
            type: z.enum(TYPES),
            registrationId: z.string().max(64).default(""),
            financialYear: z.string().regex(/^\d{4}-\d{2}$/),
            prefix: z.string().regex(/^[A-Za-z0-9/-]{1,6}$/),
            padding: z.number().int().min(1).max(6),
            locked: z.boolean(),
          })
          .parse(raw);
        const settings = await getSettings(actor);
        serialNumber(
          v.prefix,
          v.financialYear,
          1,
          v.padding,
          settings.profile.country === "IN" && GST_TYPES.includes(v.type),
        );
        id = await prisma.$transaction(async (tx) => {
          await lockDocuments(tx, actor.workspace.id);
          await documentsAccess(actor, undefined, tx);
          const key = {
            workspaceId: actor.workspace.id,
            type: v.type,
            registrationId: v.registrationId,
            financialYear: v.financialYear,
          };
          const existing = await tx.documentSeries.findUnique({
            where: { workspaceId_type_registrationId_financialYear: key },
          });
          if (
            existing &&
            existing.nextNumber > 1 &&
            (existing.prefix !== v.prefix || existing.padding !== v.padding)
          )
            throw new DocumentsError(
              "An allocated series keeps its prefix and padding. Lock it or continue numbering.",
            );
          if (
            v.registrationId &&
            !(await tx.documentReference.findFirst({
              where: {
                id: v.registrationId,
                workspaceId: actor.workspace.id,
                kind: "REGISTRATION",
              },
            }))
          )
            throw new DocumentsError(
              "Choose an issuing registration in this workspace.",
            );
          const row = await tx.documentSeries.upsert({
            where: { workspaceId_type_registrationId_financialYear: key },
            create: {
              ...key,
              prefix: v.prefix,
              padding: v.padding,
              locked: v.locked,
            },
            update: { prefix: v.prefix, padding: v.padding, locked: v.locked },
          });
          await audit(actor, "series_saved", row.id, tx);
          return row.id;
        });
        break;
      }
      default:
        return actionError("Choose an available document action.");
    }
    revalidatePath(`/w/${slug}/documents`, "layout");
    return { ok: true, data: { id } };
  } catch (e) {
    if (e instanceof z.ZodError) return validationError(e);
    if (e instanceof DocumentsError) return actionError(e.message);
    if (e instanceof SyntaxError)
      return actionError("Check the document fields and try again.");
    if (
      e instanceof Error &&
      /supported document limit|Discount cannot|Quantity must|series prefix|Unknown merge field|Review the donor identification/.test(
        e.message,
      )
    )
      return actionError(e.message);
    if (e && typeof e === "object" && "code" in e && e.code === "P2002")
      return actionError(
        "That number or source is already in use. Open the existing document.",
      );
    return actionError(SAVE_FAILED);
  }
}
