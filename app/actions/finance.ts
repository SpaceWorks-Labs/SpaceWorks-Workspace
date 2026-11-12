"use server";

import { revalidatePath } from "@/lib/frontend/cache";
import { z } from "zod";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { actionError, NOT_ALLOWED, RATE_LIMITED, validationError, type ActionResult } from "@/lib/actionResult";
import { canManageFinance, getWorkspaceForAction, type WorkspaceContext } from "@/lib/permissions";
import { idSchema } from "@/lib/validation";
import { MAX_IMPORT_BYTES, parseCsv, validateLedgerImport, type ImportPreview } from "@/lib/finance/csv";
import { listCategories } from "@/lib/finance/queries";
import { categorySchema, invoiceSchema, isoDateSchema, ledgerEntrySchema } from "@/lib/finance/schemas";
import * as finance from "@/lib/finance/service";

/**
 * Finance Server Actions (the kitty: ledger, categories, CSV, invoices).
 * Pattern: workspace from the slug → canManageFinance → rate limit → zod →
 * lib/finance/service (which filters every query by workspaceId and audits).
 */

const slugSchema = z.string().min(1).max(64);

async function managerContext(slug: unknown): Promise<WorkspaceContext | null> {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return null;
  const ctx = await getWorkspaceForAction(parsed.data, "MEMBER", { module: "finance" });
  return ctx && canManageFinance(ctx.membership) ? ctx : null;
}

async function limited(ctx: WorkspaceContext, bucket: "apiWrite" | "upload" = "apiWrite") {
  return isActionRateLimited(bucket, `finance:${ctx.user.id}`);
}

function revalidateFinance(slug: string) {
  revalidatePath(`/w/${slug}/finance`, "layout");
  revalidatePath(`/w/${slug}`);
}

function text(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  return typeof value === "string" ? value : undefined;
}

function fileFrom(form: FormData, key: string): File | null {
  const value = form.get(key);
  return value instanceof File && value.size > 0 ? value : null;
}

function ledgerValues(form: FormData) {
  return ledgerEntrySchema.safeParse({
    kind: text(form, "kind"),
    amount: text(form, "amount") ?? "",
    occurredOn: text(form, "occurredOn") ?? "",
    description: text(form, "description") ?? "",
    counterparty: text(form, "counterparty"),
    categoryId: text(form, "categoryId"),
    budgetId: text(form, "budgetId"),
  });
}

// ───────────── Ledger ─────────────

export async function createLedgerEntryAction(slug: string, form: FormData): Promise<ActionResult<{ id: string }>> {
  const ctx = await managerContext(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  const receipt = fileFrom(form, "receipt");
  if (await limited(ctx, receipt ? "upload" : "apiWrite")) return actionError(RATE_LIMITED);
  const parsed = ledgerValues(form);
  if (!parsed.success) return validationError(parsed.error);
  const result = await finance.createLedgerEntry(ctx, parsed.data, receipt);
  if (result.ok) revalidateFinance(ctx.workspace.slug);
  return result;
}

export async function updateLedgerEntryAction(slug: string, entryId: string, form: FormData): Promise<ActionResult> {
  const ctx = await managerContext(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  const id = idSchema.safeParse(entryId);
  if (!id.success) return actionError("That entry isn't available any more. Refresh and try again.");
  const receipt = fileFrom(form, "receipt");
  if (await limited(ctx, receipt ? "upload" : "apiWrite")) return actionError(RATE_LIMITED);
  const parsed = ledgerValues(form);
  if (!parsed.success) return validationError(parsed.error);
  const result = await finance.updateLedgerEntry(ctx, id.data, parsed.data, { file: receipt, remove: text(form, "removeReceipt") === "1" });
  if (result.ok) revalidateFinance(ctx.workspace.slug);
  return result;
}

const voidSchema = z.object({ entryId: idSchema, voided: z.boolean() });

export async function setLedgerEntryVoidedAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await managerContext(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await limited(ctx)) return actionError(RATE_LIMITED);
  const parsed = voidSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await finance.setLedgerEntryVoided(ctx, parsed.data.entryId, parsed.data.voided);
  if (result.ok) revalidateFinance(ctx.workspace.slug);
  return result;
}

// ───────────── CSV import ─────────────

const csvSchema = z.string().min(1, "Choose a CSV file.").max(MAX_IMPORT_BYTES, "That file is too large. Import at most 1 MB at a time.").refine((csv) => Buffer.byteLength(csv, "utf8") <= MAX_IMPORT_BYTES, "That file is too large. Import at most 1 MB at a time.");

async function previewFor(ctx: WorkspaceContext, csv: string): Promise<ImportPreview> {
  const parsed = parseCsv(csv);
  if (!parsed.ok) return parsed;
  const categories = await listCategories(ctx.workspace.id, { includeArchived: true });
  return validateLedgerImport(parsed.rows, { currency: ctx.workspace.currency, categories });
}

export async function previewLedgerImportAction(slug: string, csv: unknown): Promise<ActionResult<ImportPreview>> {
  const ctx = await managerContext(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await limited(ctx)) return actionError(RATE_LIMITED);
  const parsed = csvSchema.safeParse(csv);
  if (!parsed.success) return validationError(parsed.error);
  return { ok: true, data: await previewFor(ctx, parsed.data) };
}

/** Re-validates the same file on the server and imports only when every row is valid. */
export async function commitLedgerImportAction(slug: string, csv: unknown): Promise<ActionResult<{ count: number }>> {
  const ctx = await managerContext(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await limited(ctx)) return actionError(RATE_LIMITED);
  const parsed = csvSchema.safeParse(csv);
  if (!parsed.success) return validationError(parsed.error);
  const preview = await previewFor(ctx, parsed.data);
  if (!preview.ok) return actionError(preview.error);
  if (preview.problems.length) return actionError(`Fix ${preview.problems.length === 1 ? "the problem" : `the ${preview.problems.length} problems`} in the file, then import again.`);
  const result = await finance.importLedgerRows(ctx, preview.rows);
  if (result.ok) revalidateFinance(ctx.workspace.slug);
  return result;
}

// ───────────── Categories ─────────────

export async function createCategoryAction(slug: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await managerContext(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await limited(ctx)) return actionError(RATE_LIMITED);
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await finance.createCategory(ctx, parsed.data);
  if (result.ok) revalidateFinance(ctx.workspace.slug);
  return result;
}

const renameSchema = z.object({ categoryId: idSchema, name: categorySchema.shape.name });

export async function renameCategoryAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await managerContext(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await limited(ctx)) return actionError(RATE_LIMITED);
  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await finance.renameCategory(ctx, parsed.data.categoryId, parsed.data.name);
  if (result.ok) revalidateFinance(ctx.workspace.slug);
  return result;
}

const archiveSchema = z.object({ categoryId: idSchema, archived: z.boolean() });

export async function setCategoryArchivedAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await managerContext(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await limited(ctx)) return actionError(RATE_LIMITED);
  const parsed = archiveSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await finance.setCategoryArchived(ctx, parsed.data.categoryId, parsed.data.archived);
  if (result.ok) revalidateFinance(ctx.workspace.slug);
  return result;
}

// ───────────── Invoices ─────────────

export async function createInvoiceAction(slug: string, input: unknown): Promise<ActionResult<{ id: string; number: string }>> {
  const ctx = await managerContext(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await limited(ctx)) return actionError(RATE_LIMITED);
  const parsed = invoiceSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await finance.createInvoice(ctx, parsed.data);
  if (result.ok) revalidateFinance(ctx.workspace.slug);
  return result;
}

export async function updateInvoiceAction(slug: string, invoiceId: string, input: unknown): Promise<ActionResult> {
  const ctx = await managerContext(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await limited(ctx)) return actionError(RATE_LIMITED);
  const id = idSchema.safeParse(invoiceId);
  if (!id.success) return actionError("That invoice isn't available any more. Refresh and try again.");
  const parsed = invoiceSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await finance.updateInvoice(ctx, id.data, parsed.data);
  if (result.ok) revalidateFinance(ctx.workspace.slug);
  return result;
}

const sendSchema = z.object({ invoiceId: idSchema, email: z.boolean() });

export async function sendInvoiceAction(slug: string, input: unknown): Promise<ActionResult<{ emailed: boolean }>> {
  const ctx = await managerContext(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await limited(ctx)) return actionError(RATE_LIMITED);
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await finance.sendInvoice(ctx, parsed.data.invoiceId, { email: parsed.data.email });
  if (result.ok) revalidateFinance(ctx.workspace.slug);
  return result;
}

const paidSchema = z.object({
  invoiceId: idSchema,
  paidOn: isoDateSchema.optional(),
  categoryId: z
    .string()
    .optional()
    .transform((value) => value || null)
    .pipe(idSchema.nullable()),
});

export async function markInvoicePaidAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await managerContext(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await limited(ctx)) return actionError(RATE_LIMITED);
  const parsed = paidSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await finance.markInvoicePaid(ctx, parsed.data.invoiceId, { paidOn: parsed.data.paidOn ?? null, categoryId: parsed.data.categoryId });
  if (result.ok) revalidateFinance(ctx.workspace.slug);
  return result;
}

const invoiceOnly = z.object({ invoiceId: idSchema });

export async function voidInvoiceAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await managerContext(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await limited(ctx)) return actionError(RATE_LIMITED);
  const parsed = invoiceOnly.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await finance.voidInvoice(ctx, parsed.data.invoiceId);
  if (result.ok) revalidateFinance(ctx.workspace.slug);
  return result;
}

export async function deleteInvoiceAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await managerContext(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await limited(ctx)) return actionError(RATE_LIMITED);
  const parsed = invoiceOnly.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const result = await finance.deleteDraftInvoice(ctx, parsed.data.invoiceId);
  if (result.ok) revalidateFinance(ctx.workspace.slug);
  return result;
}
