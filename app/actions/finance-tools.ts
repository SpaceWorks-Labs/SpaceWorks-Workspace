"use server";
import { revalidatePath } from "next/cache";
import { fundWarningsForRecord } from "@/lib/moneyControls/funds";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getWorkspaceForAction } from "@/lib/permissions";
import {
  actionError,
  NOT_ALLOWED,
  RATE_LIMITED,
  SAVE_FAILED,
  validationError,
  type ActionResult,
} from "@/lib/actionResult";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import {
  attachmentTypeSchema,
  moneyInput,
  toolSchemas,
  type ToolOperation,
} from "@/lib/finance/tools-rules";
import { FinanceError, financeAccess } from "@/lib/finance/tools/access";
import {
  removeFinanceFile,
  uploadFinanceFiles,
} from "@/lib/finance/tools/files";
import { extractReceipt } from "@/lib/finance/tools/extract";
import { generatePayslip } from "@/lib/finance/tools/pdf";
import { handlers } from "@/lib/finance/tools/action-handlers";
import { revealPayDetails } from "@/lib/finance/tools/payroll";
import { PAYROLL_OPERATIONS, payrollDisabled } from "@/lib/finance/tools/payrollGate";

const bools = new Set([
  "restricted",
  "archived",
  "post",
  "done",
  "remove",
  "reconciled",
  "signOff",
  "reopen",
  "pfApplicable",
  "esiApplicable",
  "ptApplicable",
  "clearPan",
  "clearBank",
]);
function failure(e: unknown) {
  if (e instanceof z.ZodError) return validationError(e);
  if (e instanceof FinanceError) return actionError(e.message);
  if (
    e instanceof Error &&
    /Deductions must|Enter a positive|Enter a valid amount/.test(e.message)
  )
    return actionError(e.message);
  if (e && typeof e === "object" && "code" in e && e.code === "P2002")
    return actionError(
      "That record already exists. Open it to update the details.",
    );
  return actionError(SAVE_FAILED);
}
export async function financeToolAction(
  slug: string,
  operation: string,
  form: FormData,
): Promise<ActionResult<{ id: string; warnings?: string[] }>> {
  const actor = await getWorkspaceForAction(slug, "MEMBER", { module: "finance" });
  if (!actor) return actionError(NOT_ALLOWED);
  if (PAYROLL_OPERATIONS.has(operation) && (await payrollDisabled(actor.workspace.id))) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("apiWrite", `finance-tools:${actor.user.id}`))
    return actionError(RATE_LIMITED);
  if (!Object.hasOwn(toolSchemas, operation))
    return actionError("Choose an available finance action.");
  const op = operation as ToolOperation;
  try {
    await financeAccess(
      actor,
      op === "grant" ? "OWNER" : op.startsWith("pay") ? "PAY_MANAGE" : "MANAGE",
    );
    let currency =
      typeof form.get("currency") === "string"
        ? String(form.get("currency"))
        : actor.workspace.currency;
    if (op === "payRun") {
      const profile = await prisma.financePayProfile.findFirst({
        where: {
          id: String(form.get("profileId")),
          workspaceId: actor.workspace.id,
        },
        select: { currency: true },
      });
      if (!profile)
        throw new FinanceError("Choose a pay profile in this workspace.");
      currency = profile.currency;
    }
    if (op === "billPayment")
      currency =
        (
          await prisma.financeBill.findFirst({
            where: {
              id: String(form.get("billId")),
              workspaceId: actor.workspace.id,
            },
            select: { currency: true },
          })
        )?.currency ?? currency;
    if (op === "disbursementTransition")
      currency =
        (
          await prisma.financeDisbursement.findFirst({
            where: {
              id: String(form.get("id")),
              workspaceId: actor.workspace.id,
            },
            select: { currency: true },
          })
        )?.currency ?? currency;
    const values: Record<string, unknown> = {};
    for (const [key, v] of form.entries()) {
      if (typeof v !== "string") continue;
      if (key.endsWith("Minor"))
        values[key] = moneyInput(
          v,
          currency,
          key === "openingMinor" || key === "statementMinor",
        );
      else if (bools.has(key))
        values[key] = v === "1" || v === "true" || v === "on";
      else values[key] = v;
    }
    values.fileIds = form
      .getAll("fileIds")
      .filter((v): v is string => typeof v === "string");
    if (
      [
        "fund",
        "budget",
        "entry",
        "bill",
        "account",
        "threshold",
        "payProfile",
        "disbursement",
      ].includes(op)
    )
      values.currency = currency;
    const id = await handlers[op](actor, values);
    revalidatePath(`/w/${actor.workspace.slug}/finance`, "layout");
    revalidatePath(`/w/${actor.workspace.slug}/requests`);
    const source = (
      {
        entry: "entry",
        tags: "entry",
        bill: "bill",
        billPayment: "bill",
        payRun: "pay_run",
        payBookkeeping: "pay_run",
        payTransition: "pay_run",
        disbursement: "disbursement",
        disbursementTransition: "disbursement",
      } as Record<string, string>
    )[op];
    const warnings = source
      ? await fundWarningsForRecord(
          actor.workspace.id,
          source,
          op === "billPayment" ? String(form.get("billId")) : id,
        ).catch(() => [])
      : [];
    return { ok: true, data: { id, warnings } };
  } catch (e) {
    return failure(e);
  }
}
export async function uploadFinanceFilesAction(slug: string, form: FormData) {
  const actor = await getWorkspaceForAction(slug, "MEMBER", { module: "finance" });
  if (!actor) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("upload", `finance-tools:${actor.user.id}`))
    return actionError(RATE_LIMITED);
  try {
    const type = attachmentTypeSchema.parse(form.get("recordType"));
    const recordId =
      type === "STAGED"
        ? z.uuid().parse(form.get("recordId"))
        : z.string().min(1).max(128).parse(form.get("recordId"));
    const files = form
      .getAll("files")
      .filter((v): v is File => v instanceof File && v.size > 0);
    const data = await uploadFinanceFiles(actor, type, recordId, files);
    revalidatePath(`/w/${actor.workspace.slug}/finance`, "layout");
    return { ok: true as const, data };
  } catch (e) {
    return failure(e);
  }
}
export async function removeFinanceFileAction(slug: string, id: string) {
  const actor = await getWorkspaceForAction(slug, "MEMBER", { module: "finance" });
  if (!actor) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("apiWrite", `finance-tools:${actor.user.id}`))
    return actionError(RATE_LIMITED);
  try {
    await removeFinanceFile(actor, z.string().min(1).max(128).parse(id));
    revalidatePath(`/w/${actor.workspace.slug}/finance`, "layout");
    return { ok: true as const };
  } catch (e) {
    return failure(e);
  }
}
export async function extractReceiptAction(slug: string, fileId: string) {
  const actor = await getWorkspaceForAction(slug, "MEMBER", { module: "finance" });
  if (!actor) return actionError(NOT_ALLOWED);
  if (
    await isActionRateLimited("assistant", `finance-receipt:${actor.user.id}`)
  )
    return actionError(RATE_LIMITED);
  try {
    return {
      ok: true as const,
      data: await extractReceipt(
        actor,
        z.string().min(1).max(128).parse(fileId),
      ),
    };
  } catch (e) {
    return failure(e);
  }
}
export async function generatePayslipAction(slug: string, runId: string) {
  const actor = await getWorkspaceForAction(slug, "MEMBER", { module: "finance" });
  if (!actor) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("apiRead", `finance-payslip:${actor.user.id}`))
    return actionError(RATE_LIMITED);
  try {
    const id = await generatePayslip(
      actor,
      z.string().min(1).max(128).parse(runId),
    );
    revalidatePath(`/w/${actor.workspace.slug}/finance`, "layout");
    return { ok: true as const, data: { id } };
  } catch (e) {
    return failure(e);
  }
}
export async function revealPayDetailsAction(slug: string, profileId: string) {
  const actor = await getWorkspaceForAction(slug, "MEMBER", { module: "finance" });
  if (!actor || (await payrollDisabled(actor.workspace.id))) return actionError(NOT_ALLOWED);
  if (
    await isActionRateLimited("apiRead", `finance-pay-details:${actor.user.id}`)
  )
    return actionError(RATE_LIMITED);
  try {
    return {
      ok: true as const,
      data: await revealPayDetails(
        actor,
        z.string().min(1).max(128).parse(profileId),
      ),
    };
  } catch (e) {
    return failure(e);
  }
}

export async function generateReportPdfAction(slug: string, input: unknown) {
  const actor = await getWorkspaceForAction(slug, "MEMBER", { module: "finance" });
  if (!actor) return actionError(NOT_ALLOWED);
  if (
    await isActionRateLimited("apiRead", `finance-report-pdf:${actor.user.id}`)
  )
    return actionError(RATE_LIMITED);
  try {
    const query = z
      .object({
        month: z.string().optional(),
        from: z.string().max(10).optional(),
        to: z.string().max(10).optional(),
        currency: z.string().max(3).optional(),
        centre: z.string().max(128).optional(),
      })
      .parse(input);
    const { generateReportPdf } = await import(
      "@/lib/finance/tools/report-pdf"
    );
    return {
      ok: true as const,
      data: { id: await generateReportPdf(actor, query) },
    };
  } catch (e) {
    return failure(e);
  }
}
