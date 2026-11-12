"use server";
import { z } from "zod";
import { revalidatePath } from "@/lib/frontend/cache";
import { getWorkspaceForAction } from "@/lib/permissions";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { actionError, type ActionResult } from "@/lib/actionResult";
import { AnalyticsError, type Actor } from "@/lib/analytics/access";
import {
  savePreset,
  removePreset,
  saveAdjustment,
  removeAdjustment,
  attachAdjustmentFiles,
} from "@/lib/analytics/service";
import { generatePack } from "@/lib/analytics/packs";
async function run<T>(
  slug: string,
  fn: (actor: Actor) => Promise<T>,
): Promise<ActionResult<T>> {
  if (!/^[a-z0-9-]{1,64}$/.test(slug))
    return actionError("That workspace is unavailable.");
  const actor = await getWorkspaceForAction(slug, "MEMBER", { module: "analytics" });
  if (!actor) return actionError("That report is unavailable.");
  if (await isActionRateLimited("action", actor.user.id))
    return actionError("Please wait a moment and try again.");
  try {
    const data = await fn(actor);
    revalidatePath(`/w/${slug}/analytics`, "layout");
    return { ok: true, data };
  } catch (e) {
    return actionError(
      e instanceof AnalyticsError
        ? e.message
        : e instanceof z.ZodError
          ? (e.issues[0]?.message ?? "Check the report fields.")
          : "Could not save the report. Refresh and try again.",
    );
  }
}
export async function saveAnalyticsPreset(
  slug: string,
  input: unknown,
): Promise<ActionResult<string>> {
  return run(slug, (a) => savePreset(a, input));
}
export async function removeAnalyticsPreset(
  slug: string,
  id: string,
): Promise<ActionResult<void>> {
  return run(slug, (a) => removePreset(a, z.string().min(1).max(64).parse(id)));
}
export async function saveAnalyticsAdjustment(
  slug: string,
  input: unknown,
): Promise<ActionResult<string>> {
  return run(slug, (a) => saveAdjustment(a, input));
}
export async function removeAnalyticsAdjustment(
  slug: string,
  id: string,
): Promise<ActionResult<void>> {
  return run(slug, (a) =>
    removeAdjustment(a, z.string().min(1).max(64).parse(id)),
  );
}
export async function uploadAnalyticsProof(
  slug: string,
  id: string,
  form: FormData,
): Promise<ActionResult<string[]>> {
  return run(slug, (a) =>
    attachAdjustmentFiles(
      a,
      z.string().min(1).max(64).parse(id),
      form.getAll("files").filter((f): f is File => f instanceof File),
    ),
  );
}
export async function generateAnalyticsPack(
  slug: string,
  id: string,
  kind: "management" | "board",
): Promise<ActionResult<{ fileId: string }>> {
  return run(slug, (a) =>
    generatePack(
      a,
      z.string().min(1).max(64).parse(id),
      z.enum(["management", "board"]).parse(kind),
    ),
  );
}
