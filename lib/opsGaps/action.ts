import "server-only";
import { revalidatePath } from "@/lib/frontend/cache";
import { getWorkspaceForAction } from "@/lib/permissions";
import { moduleForArea } from "@/lib/modules";
import { canManageInternalOperations, canUseInternalOperations } from "@/lib/roles";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { type ActionResult, NOT_ALLOWED, RATE_LIMITED, SAVE_FAILED } from "@/lib/actionResult";
import { zonedInputToIso } from "@/lib/timeZone";
import { OperationsError, type OpsActor } from "./context";
export async function action(slug: string, area: string, manager: boolean, work: (actor: OpsActor) => Promise<string | void>): Promise<ActionResult<string>> {
  const actor = await getWorkspaceForAction(slug, manager ? "ADMIN" : "MEMBER", { module: moduleForArea(area) });
  if (!actor || !(manager ? canManageInternalOperations(actor.membership) : canUseInternalOperations(actor.membership))) return { ok: false, error: NOT_ALLOWED };
  if (await isActionRateLimited("apiWrite", actor.user.id)) return { ok: false, error: RATE_LIMITED };
  try {
    const data = await work(actor);
    revalidatePath(`/w/${actor.workspace.slug}/${area}`, "layout");
    if (area === "leave") revalidatePath(`/w/${actor.workspace.slug}/members`, "layout");
    return { ok: true, data: data ?? "Saved." };
  } catch (error) {
    return { ok: false, error: error instanceof OperationsError ? error.message : SAVE_FAILED, ...(error instanceof OperationsError && error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}) };
  }
}
export const values = (form: FormData) => Object.fromEntries([...form.entries()].filter(([, value]) => typeof value === "string"));
export function instant(form: FormData, key: string, actor: OpsActor, dateOnly = false) {
  const raw = String(form.get(key) ?? "");
  const value = zonedInputToIso(dateOnly ? `${raw}T23:59` : raw, actor.workspace.timezone);
  if (!value) throw new OperationsError("Choose a valid date and time in the workspace time zone.", { [key]: ["Choose a valid date and time."] });
  return value;
}
