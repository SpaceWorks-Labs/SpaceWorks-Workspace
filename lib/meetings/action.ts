import "server-only";
import { z } from "zod";
import { revalidatePath } from "@/lib/frontend/cache";
import { getWorkspaceForAction } from "@/lib/permissions";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { canContribute } from "@/lib/roles";
import { moduleForArea } from "@/lib/modules";
import {
  type ActionResult,
  actionError,
  NOT_ALLOWED,
  RATE_LIMITED,
  SAVE_FAILED,
  validationError,
} from "@/lib/actionResult";
import { type Actor, CollaborationError } from "./core";

export async function collaborationAction<T>(
  slug: unknown,
  area: string,
  run: (actor: Actor) => Promise<T>,
  guest = false,
): Promise<ActionResult<T>> {
  if (typeof slug !== "string" || !/^[a-z0-9-]{1,64}$/.test(slug))
    return actionError(NOT_ALLOWED);
  const actor = await getWorkspaceForAction(slug, guest ? "GUEST" : "MEMBER", { module: moduleForArea(area) });
  if (!actor || (!guest && !canContribute(actor.membership)))
    return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", actor.user.id))
    return actionError(RATE_LIMITED);
  try {
    const data = await run(actor);
    revalidatePath(`/w/${slug}/${area}`, "layout");
    revalidatePath(`/w/${slug}/meetings/decisions`);
    revalidatePath(`/w/${slug}/my-tasks`);
    return { ok: true, data };
  } catch (error) {
    if (error instanceof z.ZodError) return validationError(error);
    if (error instanceof CollaborationError) return actionError(error.message);
    if ((error as { code?: string }).code === "P2002")
      return actionError("That change was already recorded. Reload to see it.");
    console.error(`Collaboration ${area} action failed`, {
      name: error instanceof Error ? error.name : "Unknown",
      code: (error as { code?: string }).code,
    });
    return actionError(SAVE_FAILED);
  }
}
