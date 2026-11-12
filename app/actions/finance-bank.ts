"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getWorkspaceForAction } from "@/lib/permissions";
import { actionError, NOT_ALLOWED, RATE_LIMITED, SAVE_FAILED, validationError, type ActionResult } from "@/lib/actionResult";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { FinanceError } from "@/lib/finance/tools/access";
import { commitBankImport, createEntryFromBankLine, matchBankLine, previewBankImport, setBankLineIgnored, unmatchBankLine, type BankPreview } from "@/lib/finance/bank";

function failure(e: unknown) {
  if (e instanceof z.ZodError) return validationError(e);
  if (e instanceof FinanceError) return actionError(e.message);
  return actionError(SAVE_FAILED);
}

async function run<T>(slug: string, key: string, work: (actor: NonNullable<Awaited<ReturnType<typeof getWorkspaceForAction>>>) => Promise<T>, refresh = true): Promise<ActionResult<T>> {
  const actor = await getWorkspaceForAction(slug, "MEMBER", { module: "finance" });
  if (!actor) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("apiWrite", `finance-bank:${key}:${actor.user.id}`)) return actionError(RATE_LIMITED);
  try {
    const data = await work(actor);
    if (refresh) revalidatePath(`/w/${actor.workspace.slug}/finance/bank`);
    return { ok: true, data };
  } catch (e) {
    return failure(e);
  }
}

/** Parse a statement and report what would be imported. Nothing is saved. */
export async function previewBankImportAction(slug: string, input: unknown): Promise<ActionResult<BankPreview>> {
  return run(slug, "preview", (actor) => previewBankImport(actor, input), false);
}

export async function commitBankImportAction(slug: string, input: unknown) {
  return run(slug, "import", (actor) => commitBankImport(actor, input));
}

export async function matchBankLineAction(slug: string, lineId: string, entryId: string) {
  return run(slug, "match", async (actor) => ({ id: await matchBankLine(actor, { lineId, entryId }) }));
}

export async function unmatchBankLineAction(slug: string, lineId: string) {
  return run(slug, "match", async (actor) => ({ id: await unmatchBankLine(actor, { lineId }) }));
}

export async function ignoreBankLineAction(slug: string, lineId: string, ignored: boolean) {
  return run(slug, "match", async (actor) => ({ id: await setBankLineIgnored(actor, { lineId, ignored }) }));
}

export async function createEntryFromBankLineAction(slug: string, input: unknown) {
  return run(slug, "create", async (actor) => {
    const result = await createEntryFromBankLine(actor, input);
    revalidatePath(`/w/${actor.workspace.slug}/finance/ledger`);
    return result;
  });
}
