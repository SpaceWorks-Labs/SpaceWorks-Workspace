"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getWorkspaceForAction } from "@/lib/permissions";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import {
  actionError,
  NOT_ALLOWED,
  RATE_LIMITED,
  SAVE_FAILED,
  validationError,
  type ActionResult,
} from "@/lib/actionResult";
import { FinanceError } from "@/lib/finance/tools/access";
import { moneyInput } from "@/lib/finance/tools-rules";
import {
  saveControl,
  transitionControl,
  markControlMovement,
} from "@/lib/moneyControls/service";
import {
  uploadControlFiles,
  removeControlFile,
} from "@/lib/moneyControls/files";
import { controlsAccess } from "@/lib/moneyControls/access";
function failure(e: unknown) {
  if (e instanceof z.ZodError) return validationError(e);
  if (e instanceof FinanceError) return actionError(e.message);
  if (
    e instanceof Error &&
    /denomination|positive amount|valid amount|cash denominations/.test(
      e.message,
    )
  )
    return actionError(e.message);
  if (e && typeof e === "object" && "code" in e && e.code === "P2002")
    return actionError(
      "This account, asset or fund already has a control record. Open it to update the details.",
    );
  return actionError(SAVE_FAILED);
}
function refresh(slug: string) {
  revalidatePath(`/w/${slug}/finance`, "layout");
  revalidatePath(`/w/${slug}/money-controls`);
  for (const section of ["cash", "assets", "tds", "funds"])
    revalidatePath(`/w/${slug}/money-controls/${section}`);
  revalidatePath(`/w/${slug}/assets`);
  revalidatePath(`/w/${slug}/onboarding`);
}
export async function saveMoneyControlAction(
  slug: string,
  form: FormData,
): Promise<ActionResult<{ id: string }>> {
  const actor = await getWorkspaceForAction(slug, "MEMBER", { module: "finance" });
  if (!actor) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("apiWrite", `money-controls:${actor.user.id}`))
    return actionError(RATE_LIMITED);
  try {
    const a = await controlsAccess(actor);
    if (!a.manage) return actionError(NOT_ALLOWED);
    const currency = String(form.get("currency") || actor.workspace.currency),
      values: Record<string, unknown> = {},
      detail: Record<string, unknown> = {};
    for (const [key, value] of form) {
      if (typeof value !== "string") continue;
      const target = key.startsWith("detail.") ? detail : values,
        name = key.replace(/^detail\./, "");
      target[name] = name.endsWith("Minor")
        ? moneyInput(value || "0", currency)
        : name === "payroll"
          ? value === "on"
          : value;
    }
    if (detail.ratePercent !== undefined) {
      const rate = z
        .string()
        .regex(/^\d+(?:\.\d{1,2})?$/)
        .parse(detail.ratePercent);
      detail.rateBps = Math.round(Number(rate) * 100);
      delete detail.ratePercent;
    }
    detail.allowedCategoryIds = form
      .getAll("detail.allowedCategoryIds")
      .filter((v) => typeof v === "string" && v);
    values.details = detail;
    values.currency = currency;
    values.payroll = values.payroll ?? false;
    const id = await saveControl(actor, values);
    refresh(slug);
    return { ok: true, data: { id } };
  } catch (e) {
    return failure(e);
  }
}
export async function transitionMoneyControlAction(
  slug: string,
  form: FormData,
): Promise<ActionResult<{ id: string }>> {
  const actor = await getWorkspaceForAction(slug, "MEMBER", { module: "finance" });
  if (!actor) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("apiWrite", `money-controls:${actor.user.id}`))
    return actionError(RATE_LIMITED);
  try {
    const { controlRecord } = await import("@/lib/moneyControls/access");
    const row = await controlRecord(
      actor,
      z.string().min(1).max(64).parse(form.get("id")),
    );
    const values: Record<string, unknown> = Object.fromEntries(form);
    values.amountMinor = moneyInput(
      String(form.get("amountMinor") || "0"),
      row.currency,
    );
    const id = await transitionControl(actor, values);
    refresh(slug);
    return { ok: true, data: { id } };
  } catch (e) {
    return failure(e);
  }
}
export async function uploadMoneyControlFilesAction(
  slug: string,
  form: FormData,
) {
  const actor = await getWorkspaceForAction(slug, "MEMBER", { module: "finance" });
  if (!actor) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("upload", `money-controls:${actor.user.id}`))
    return actionError(RATE_LIMITED);
  try {
    const id = z.string().min(1).max(64).parse(form.get("recordId"));
    const data = await uploadControlFiles(
      actor,
      id,
      form
        .getAll("files")
        .filter((v): v is File => v instanceof File && v.size > 0),
    );
    refresh(slug);
    return { ok: true as const, data };
  } catch (e) {
    return failure(e);
  }
}
export async function removeMoneyControlFileAction(
  slug: string,
  fileId: string,
) {
  const actor = await getWorkspaceForAction(slug, "MEMBER", { module: "finance" });
  if (!actor) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("apiWrite", `money-controls:${actor.user.id}`))
    return actionError(RATE_LIMITED);
  try {
    await removeControlFile(actor, z.string().min(1).max(64).parse(fileId));
    refresh(slug);
    return { ok: true as const };
  } catch (e) {
    return failure(e);
  }
}
export async function reconcileMoneyMovementAction(slug: string, id: string) {
  const actor = await getWorkspaceForAction(slug, "MEMBER", { module: "finance" });
  if (!actor) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("apiWrite", `money-controls:${actor.user.id}`))
    return actionError(RATE_LIMITED);
  try {
    await markControlMovement(actor, z.string().min(1).max(64).parse(id));
    refresh(slug);
    return { ok: true as const };
  } catch (e) {
    return failure(e);
  }
}
