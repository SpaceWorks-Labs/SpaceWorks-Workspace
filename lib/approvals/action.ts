import "server-only";
import { revalidatePath } from "@/lib/frontend/cache";
import { getWorkspaceForAction } from "@/lib/permissions";
import { moduleForArea } from "@/lib/modules";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { type ActionResult, NOT_ALLOWED, RATE_LIMITED, SAVE_FAILED } from "@/lib/actionResult";
import type { OpsActor } from "./context";
import { OpsError } from "./ops";
import { zonedInputToIso } from "@/lib/timeZone";
import { parseMoneyToMinor } from "@/lib/format/money";
export async function runAction(slug: string, area: string, work: (actor: OpsActor) => Promise<string | void>, admin = false): Promise<ActionResult<string>> {
 const actor = await getWorkspaceForAction(slug, admin ? "ADMIN" : "MEMBER", { module: moduleForArea(area) });
 if (!actor) return { ok: false, error: NOT_ALLOWED };
 if (await isActionRateLimited("apiWrite", actor.user.id)) return { ok: false, error: RATE_LIMITED };
 try { const data = await work(actor); revalidatePath(`/w/${actor.workspace.slug}/${area}`, "layout"); revalidatePath(`/w/${actor.workspace.slug}/requests`, "layout"); return { ok: true, data: data ?? "Saved." }; }
 catch (error) { return { ok: false, error: error instanceof OpsError ? error.message : SAVE_FAILED }; }
}
export function values(form: FormData): Record<string, string> { return Object.fromEntries(Array.from(form.entries()).filter((e): e is [string, string] => typeof e[1] === "string")); }
export function list(form: FormData, key: string) { return form.getAll(key).map(String).flatMap(v => v.split(",")).map(v => v.trim()).filter(Boolean); }
export function money(form: FormData, key = "amount") {
 const v = parseMoneyToMinor(String(form.get(key) ?? ""), String(form.get("currency") ?? "INR"));
 if (v === null) throw new OpsError("Enter a valid amount for this currency."); return v;
}
export function json(form: FormData, key: string) {
 const raw = String(form.get(key));
 if (raw.length > 210000) throw new OpsError("This response is too long. Shorten it and try again.");
 try { return JSON.parse(raw); } catch { throw new OpsError("Check the form fields and try again."); }
}

export function dateInstant(form: FormData, key: string, timeZone: string, endOfDay = false) {
 const value = String(form.get(key) ?? "");
 if (!value) return null;
 const instant = zonedInputToIso(`${value}T${endOfDay ? "23:59" : "00:00"}`, timeZone);
 if (!instant) throw new OpsError("Choose a valid date in the workspace time zone.");
 return instant;
}
