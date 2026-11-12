"use server";
import { z } from "zod";
import { revalidatePath } from "@/lib/frontend/cache";
import { integrationAccess } from "@/lib/integrations/access";
import { recordAuditEvent } from "@/lib/audit";
import { saveWorkspaceEmailSettings, sendWorkspaceTestEmail, verifyWorkspaceEmailSettings, WorkspaceEmailError } from "@/lib/email/workspaceSettings";
import type { ActionResult } from "@/lib/actionResult";

export async function updateEmailSettings(slug: string, raw: unknown): Promise<ActionResult> {
  try {
    const { operation, data } = z.object({ operation: z.enum(["save", "verify", "test"]), data: z.unknown().optional() }).parse(raw);
    const { workspace, user } = await integrationAccess(slug, "ADMIN", "core");
    if (operation === "save") await saveWorkspaceEmailSettings(workspace.id, user.id, data);
    else if (operation === "verify") await verifyWorkspaceEmailSettings(workspace.id);
    else await sendWorkspaceTestEmail(workspace.id, user.email, workspace.name);
    await recordAuditEvent({ workspaceId: workspace.id, actorId: user.id, action: `email_settings.${operation === "save" ? "updated" : operation === "verify" ? "verified" : "test_sent"}`, targetType: "workspace_email_settings", targetId: workspace.id });
    revalidatePath(`/w/${slug}/settings/email`);
    return { ok: true };
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, error: error.issues[0]?.message ?? "Check the fields and try again." };
    if (error instanceof WorkspaceEmailError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error && error.message.startsWith("You don't") || error instanceof Error && error.message.startsWith("Too many") ? error.message : "Couldn't save. Check the settings and try again." };
  }
}
