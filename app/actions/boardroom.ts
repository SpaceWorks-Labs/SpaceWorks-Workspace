"use server";

import { after } from "next/server";
import { revalidatePath } from "@/lib/frontend/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { recordAuditEvent } from "@/lib/audit";
import { getWorkspaceForAction } from "@/lib/permissions";
import { canContribute, hasRoleAtLeast } from "@/lib/roles";
import { actionError, NOT_ALLOWED, RATE_LIMITED, validationError, type ActionResult } from "@/lib/actionResult";
import { idSchema } from "@/lib/validation";
import { getAssistantConfig } from "@/lib/assistant/client";
import { assertAssistantAllowed } from "@/lib/assistant/usage";
import { runBoardroomSession } from "@/lib/assistant/boardroom";

/**
 * Boardroom sessions belong to the workspace (members read them all); the
 * creator or an admin deletes them. A new session runs in the background
 * right after the response (`after`), seat by seat.
 */

const slugSchema = z.string().min(1).max(64);

async function context(slug: unknown) {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return null;
  const ctx = await getWorkspaceForAction(parsed.data, "MEMBER", { module: "assistant" });
  return ctx && canContribute(ctx.membership) ? ctx : null;
}

const sessionSchema = z.object({
  title: z.string().trim().max(120).optional(),
  question: z.string().trim().min(10, "Ask a question of at least a few words.").max(2000),
  rounds: z.number().int().min(1).max(3),
  seats: z
    .array(z.object({ name: z.string().trim().min(1, "Name every seat.").max(40), persona: z.string().trim().min(10, "Describe each seat's perspective.").max(600) }))
    .min(2, "Add at least two seats.")
    .max(5, "Use at most five seats."),
});

export async function createBoardroomSessionAction(slug: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("assistant", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = sessionSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  if (!(await getAssistantConfig())) return actionError("The assistant isn't set up yet, so the Boardroom can't meet.");
  const allowed = await assertAssistantAllowed(ctx.workspace.id);
  if (!allowed.ok) return actionError(allowed.error);
  const names = parsed.data.seats.map((s) => s.name.toLowerCase());
  if (new Set(names).size !== names.length) return actionError("Give every seat a different name.");
  const title = parsed.data.title || (parsed.data.question.length > 80 ? `${parsed.data.question.slice(0, 79).trimEnd()}…` : parsed.data.question);
  const session = await prisma.$transaction(async (tx) => {
    const row = await tx.boardroomSession.create({
      data: {
        workspaceId: ctx.workspace.id,
        title,
        question: parsed.data.question,
        rounds: parsed.data.rounds,
        createdById: ctx.user.id,
        seats: { create: parsed.data.seats.map((seat, position) => ({ ...seat, position })) },
      },
      select: { id: true },
    });
    await recordAuditEvent({ action: "boardroom.session_created", workspaceId: ctx.workspace.id, actorId: ctx.user.id, targetType: "BoardroomSession", targetId: row.id, metadata: { seats: parsed.data.seats.length, rounds: parsed.data.rounds }, client: tx });
    return row;
  });
  after(() => runBoardroomSession(session.id).then(() => undefined));
  revalidatePath(`/w/${ctx.workspace.slug}/boardroom`);
  return { ok: true, data: { id: session.id } };
}

export async function deleteBoardroomSessionAction(slug: string, input: unknown): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return actionError(NOT_ALLOWED);
  if (await isActionRateLimited("action", ctx.user.id)) return actionError(RATE_LIMITED);
  const parsed = z.object({ sessionId: idSchema }).safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const session = await prisma.boardroomSession.findFirst({ where: { id: parsed.data.sessionId, workspaceId: ctx.workspace.id }, select: { id: true, createdById: true, status: true } });
  if (!session) return actionError("That session was already removed.");
  if (session.createdById !== ctx.user.id && !hasRoleAtLeast(ctx.membership.role, "ADMIN")) return actionError(NOT_ALLOWED);
  if (session.status === "RUNNING") return actionError("Wait until the panel finishes, then delete it.");
  await prisma.boardroomSession.delete({ where: { id: session.id } });
  await recordAuditEvent({ action: "boardroom.session_deleted", workspaceId: ctx.workspace.id, actorId: ctx.user.id, targetType: "BoardroomSession", targetId: session.id });
  revalidatePath(`/w/${ctx.workspace.slug}/boardroom`);
  return { ok: true };
}
