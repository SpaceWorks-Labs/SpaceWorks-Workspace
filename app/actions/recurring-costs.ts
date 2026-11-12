"use server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
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
import { canManageRecurringCosts } from "@/lib/roles";
import { controlsAccess } from "@/lib/moneyControls/access";
import { FinanceError } from "@/lib/finance/tools/access";
import { moneyInput } from "@/lib/finance/tools-rules";
import {
  saveSchedule,
  scheduleFromSource,
  confirmActual,
  changeRemittanceDue,
} from "@/lib/finance/recurring/service";
import {
  cancelAdvance,
  saveAdvance,
  requestAdvanceApproval,
  payAdvance,
  recoverAdvance,
} from "@/lib/finance/recurring/advances";
import { payBill } from "@/lib/finance/tools/service";
const key = z.string().trim().min(1).max(128);
export async function recurringCostAction(
  slug: string,
  operation: string,
  form: FormData,
): Promise<ActionResult<string>> {
  const actor = await getWorkspaceForAction(slug, "MEMBER", { module: "finance" });
  if (!actor) return actionError(NOT_ALLOWED);
  try {
    const access = await controlsAccess(actor);
    const manageRecurring = canManageRecurringCosts(access.member);
    const allowed = ["schedule", "source"].includes(operation)
      ? manageRecurring
      : ["actual", "pay"].includes(operation)
        ? manageRecurring || access.payrollManage
        : [
            "advance",
            "advanceCancel",
            "approval",
            "advancePay",
            "recover",
            "remittanceDue",
          ].includes(operation) && access.payrollManage;
    if (!allowed) return actionError(NOT_ALLOWED);
    if (await isActionRateLimited("apiWrite", `recurring:${actor.user.id}`))
      return actionError(RATE_LIMITED);
    const values: Record<string, unknown> = Object.fromEntries(
      [...form.entries()].filter(([, v]) => typeof v === "string"),
    );
    let currency =
      typeof values.currency === "string"
        ? values.currency
        : actor.workspace.currency;
    if (operation === "advance") {
      const profile = await prisma.financePayProfile.findFirst({
        where: {
          workspaceId: actor.workspace.id,
          id: String(values.profileId),
        },
        select: { currency: true },
      });
      if (!profile)
        throw new FinanceError("Choose a pay profile in this workspace.");
      currency = profile.currency;
    }
    if (operation === "actual" || operation === "pay") {
      const bill = await prisma.financeBill.findFirst({
        where: { workspaceId: actor.workspace.id, id: String(values.billId) },
        select: { currency: true, privatePayroll: true },
      });
      if (
        !bill ||
        (bill.privatePayroll ? !access.payrollManage : !manageRecurring)
      )
        throw new FinanceError("That bill is unavailable.");
      currency = bill.currency;
    }
    if (operation === "recover") {
      const recovery = await prisma.staffAdvanceRecovery.findFirst({
        where: { workspaceId: actor.workspace.id, id: String(values.id) },
        select: { advance: { select: { currency: true } } },
      });
      if (!recovery) throw new FinanceError("That recovery is unavailable.");
      currency = recovery.advance.currency;
    }
    for (const k of Object.keys(values))
      if (k.endsWith("Minor")) values[k] = moneyInput(values[k], currency);
    values.estimated = values.estimated === "on";
    let id: string;
    switch (operation) {
      case "schedule":
        id = await saveSchedule(actor, values);
        break;
      case "source":
        id = await scheduleFromSource(
          actor,
          z.enum(["LEASE", "INSURANCE", "SUBSCRIPTION"]).parse(values.source),
          key.parse(values.sourceId),
        );
        break;
      case "actual":
        id = await confirmActual(actor, values);
        break;
      case "remittanceDue":
        id = await changeRemittanceDue(
          actor,
          key.parse(values.billId),
          String(values.dueOn),
        );
        break;
      case "pay":
        id = await payBill(actor, { ...values, post: true });
        break;
      case "advance":
        id = await saveAdvance(actor, values);
        break;
      case "advanceCancel":
        id = await cancelAdvance(actor, key.parse(values.id));
        break;
      case "approval":
        id = await requestAdvanceApproval(
          actor,
          key.parse(values.id),
          key.parse(values.approverId),
        );
        break;
      case "advancePay":
        id = await payAdvance(
          actor,
          key.parse(values.id),
          String(values.paidOn),
          String(values.reference),
        );
        break;
      case "recover":
        id = await recoverAdvance(actor, values);
        break;
      default:
        return actionError("Choose an available recurring cost action.");
    }
    revalidatePath(`/w/${slug}/finance`, "layout");
    revalidatePath(`/w/${slug}/safety/facilities`);
    return {
      ok: true,
      data:
        operation === "source"
          ? `/w/${slug}/finance/recurring?edit=${id}`
          : "Saved.",
    };
  } catch (e) {
    if (e instanceof z.ZodError) return validationError(e);
    if (e instanceof FinanceError) return actionError(e.message);
    if (
      e instanceof Error &&
      /Enter a (positive|valid amount)|Check the amount/.test(e.message)
    )
      return actionError(e.message);
    if (e && typeof e === "object" && "code" in e && e.code === "P2002")
      return actionError(
        "That schedule already exists. Open Recurring costs to review it.",
      );
    return actionError(SAVE_FAILED);
  }
}
