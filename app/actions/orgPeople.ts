"use server";
import { z } from "zod";
import { getWorkspaceForAction } from "@/lib/permissions";
import { canManageOrgPeople, canViewOrgPeople } from "@/lib/roles";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { actionError, type ActionResult } from "@/lib/actionResult";
import { OperationsError } from "@/lib/opsGaps/context";
import { saveAttendance, saveDepartment, saveReporting, saveResponsibility, saveEscalation, type OrgActor } from "@/lib/orgPeople/service";
import { attachOrgFiles, fileKind } from "@/lib/orgPeople/files";
import { revalidatePath } from "@/lib/frontend/cache";
async function action(slug: string, admin: boolean, work: (actor: OrgActor) => Promise<unknown>): Promise<ActionResult<string>> {
  if (!z.string().min(1).max(64).safeParse(slug).success) return actionError("This workspace is unavailable.");
  const actor = await getWorkspaceForAction(slug, "MEMBER", { module: "people" });
  if (!actor || !(admin ? canManageOrgPeople(actor.membership) : canViewOrgPeople(actor.membership))) return actionError("You do not have access to this action.");
  if (await isActionRateLimited("action", actor.user.id)) return actionError("Too many changes. Try again shortly.");
  try {
    await work(actor);
    for (const path of ["organisation", "responsibilities", "attendance", "escalation", "members"]) revalidatePath(`/w/${slug}/${path}`, "layout");
    return { ok: true, data: "Saved." };
  } catch (error) {
    if (error instanceof OperationsError) return { ok: false, error: error.message, fieldErrors: error.fieldErrors };
    return actionError("Couldn’t save. Refresh and try again.");
  }
}
export async function saveDepartmentAction(slug: string, form: FormData) { return action(slug, true, a => saveDepartment(a, Object.fromEntries(form))); }
export async function saveReportingAction(slug: string, form: FormData) { return action(slug, true, a => saveReporting(a, Object.fromEntries(form))); }
export async function saveResponsibilityAction(slug: string, form: FormData) { return action(slug, true, a => saveResponsibility(a, { ...Object.fromEntries(form), responsibleIds: form.getAll("responsibleIds"), consultedIds: form.getAll("consultedIds"), informedIds: form.getAll("informedIds") })); }
export async function saveAttendanceAction(slug: string, form: FormData) { return action(slug, false, a => saveAttendance(a, Object.fromEntries(form))); }
export async function saveEscalationAction(slug: string, form: FormData) {
  return action(slug, true, a => {
    const users = form.getAll("stepUserId"), hours = form.getAll("stepHours"), instructions = form.getAll("stepInstruction");
    return saveEscalation(a, { ...Object.fromEntries(form), active: form.get("active") !== "false", steps: users.map((userId, i) => ({ userId, hours: hours[i], instruction: instructions[i] })) });
  });
}
export async function uploadOrgFiles(slug: string, form: FormData) {
  return action(slug, false, a => {
    const kind = fileKind.safeParse(form.get("kind")); const id = z.string().min(1).max(100).safeParse(form.get("recordId"));
    if (!kind.success || !id.success) throw new OperationsError("Choose a record before uploading files.");
    return attachOrgFiles(a, kind.data, id.data, form.getAll("files").filter((v): v is File => v instanceof File && v.size > 0));
  });
}
