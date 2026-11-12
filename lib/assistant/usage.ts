import "server-only";

import { prisma } from "@/lib/db";
import { assertWithinLimit, type LimitResult } from "@/lib/limits/enforce";

/**
 * Assistant allowance for a workspace: refuses when the assistant is switched
 * off or the month's token budget is spent. Usage is the sum of
 * AssistantMessage tokens (see lib/limits/usage.ts), so model calls outside web
 * chat record theirs with `recordAssistantUsage`.
 */
export function assertAssistantAllowed(workspaceId: string): Promise<LimitResult> {
  return assertWithinLimit("assistantTokens", workspaceId, 1);
}

export const USAGE_TITLE_PREFIX = "Usage:";

/**
 * Record tokens spent by a model call that has no chat transcript of its own
 * (Boardroom, failed job runs). They go on one empty ASSISTANT message in a
 * per-user "Usage: <label>" conversation, which the chat list hides. With no
 * user (an orphaned Boardroom session) the first active owner is charged.
 */
export async function recordAssistantUsage(input: { workspaceId: string; userId: string | null; label: string; tokensIn: number; tokensOut: number }) {
  if (input.tokensIn + input.tokensOut <= 0) return;
  const userId = input.userId ?? (await prisma.membership.findFirst({ where: { workspaceId: input.workspaceId, role: "OWNER", status: "ACTIVE" }, orderBy: { joinedAt: "asc" }, select: { userId: true } }))?.userId;
  if (!userId) return;
  const title = `${USAGE_TITLE_PREFIX} ${input.label}`.slice(0, 120);
  const conversation =
    (await prisma.assistantConversation.findFirst({ where: { workspaceId: input.workspaceId, userId, title }, select: { id: true } })) ??
    (await prisma.assistantConversation.create({ data: { workspaceId: input.workspaceId, userId, title }, select: { id: true } }));
  await prisma.assistantMessage.create({ data: { conversationId: conversation.id, role: "ASSISTANT", content: [], tokensIn: input.tokensIn, tokensOut: input.tokensOut } });
}
