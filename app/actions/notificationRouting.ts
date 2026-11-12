"use server";
import { z } from "zod";
import { revalidatePath } from "@/lib/frontend/cache";
import { prisma } from "@/lib/db";
import { integrationAccess } from "@/lib/integrations/access";
import { saveDestination, saveRule } from "@/lib/integrations/routing/service";
import { sendTest } from "@/lib/notify";
import { recordAuditEvent } from "@/lib/audit";
import type { ActionResult } from "@/lib/actionResult";
import { canManageNotificationRouting } from "@/lib/roles";
import { assertWithinLimit } from "@/lib/limits/enforce";
export async function updateRouting(slug: string, raw: unknown): Promise<ActionResult> {
  try {
    const { workspace, user, membership } = await integrationAccess(slug, "ADMIN", "core");
    if (!canManageNotificationRouting(membership)) return { ok: false, error: "You don't have access to do that." };
    const input = z.object({ operation: z.enum(["destination", "rule", "deleteDestination", "deleteRule", "test", "retry"]), id: z.string().min(1).max(64).optional(), data: z.unknown().optional() }).parse(raw);
    if (input.operation === "destination") {
      const draft = (input.data ?? {}) as { id?: unknown; kind?: unknown };
      if (draft.kind === "WEBHOOK" && !draft.id) {
        const limit = await assertWithinLimit("webhooks", workspace.id);
        if (!limit.ok) return { ok: false, error: limit.error };
      }
      await saveDestination(workspace.id, user.id, input.data);
    } else if (input.operation === "rule") await saveRule(workspace.id, user.id, input.data);
    else {
      const id = z.string().min(1).max(64).parse(input.id);
      if (input.operation === "deleteDestination") await prisma.notificationDestination.deleteMany({ where: { workspaceId: workspace.id, id } });
      if (input.operation === "deleteRule") await prisma.notificationRule.deleteMany({ where: { workspaceId: workspace.id, id, scopeType: "WORKSPACE" } });
      if (input.operation === "test") {
        if (!await prisma.notificationDestination.findFirst({ where: { id, workspaceId: workspace.id } })) throw new Error("Destination not found.");
        await sendTest(workspace.id, id, user.id);
      }
      if (input.operation === "retry") await prisma.$transaction(async tx => {
        const claimed = await tx.notificationDelivery.updateMany({ where: { id, workspaceId: workspace.id, status: "FAILED" }, data: { status: "PENDING", attempts: 0, lastError: null, nextAttemptAt: new Date() } });
        if (claimed.count) await tx.outboxMessage.create({ data: { kind: "notify.deliver", payload: { deliveryId: id } } });
      });
      await recordAuditEvent({ workspaceId: workspace.id, actorId: user.id, action: `integrations.routing_${input.operation}`, targetId: id });
    }
    revalidatePath(`/w/${slug}/settings/notifications`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof z.ZodError ? error.issues[0]?.message ?? "Check the fields." : error instanceof Error && error.name === "Error" && !error.message.toLowerCase().includes("prisma") ? error.message.slice(0, 200) : "Couldn't save. Check the name and try again." };
  }
}
