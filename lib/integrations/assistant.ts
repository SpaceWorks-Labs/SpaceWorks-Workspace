import "server-only";
import { prisma } from "@/lib/db";
import { assertAssistantAllowed } from "@/lib/assistant/usage";
import { checkRateLimitById } from "@/lib/rateLimit";

export type MessagingAssistantInput = {
  workspaceId: string;
  userId: string;
  text: string;
  conversationId?: string;
};
export type MessagingAssistantRunner = (input: MessagingAssistantInput) => Promise<{ text: string; conversationId: string }>;
const RUNNER_KEY = Symbol.for("sww.messagingAssistantRunner");
type Registry = typeof globalThis & { [RUNNER_KEY]?: MessagingAssistantRunner };

/** The assistant area registers its permission-aware runner here at startup. */
export function registerMessagingAssistantRunner(runner: MessagingAssistantRunner) {
  (globalThis as Registry)[RUNNER_KEY] = runner;
}

export async function runMessagingAssistant(input: MessagingAssistantInput) {
  const member = await prisma.membership.findFirst({ where: { workspaceId: input.workspaceId, userId: input.userId, status: "ACTIVE", role: { in: ["OWNER", "ADMIN", "MEMBER"] }, workspace: { status: "ACTIVE", archivedAt: null }, user: { disabledAt: null } } });
  if (!member) throw new Error("Your workspace access has changed. Contact an admin.");
  if (input.conversationId && !await prisma.assistantConversation.findFirst({ where: { id: input.conversationId, workspaceId: input.workspaceId, userId: input.userId } })) throw new Error("Start a new assistant conversation.");
  if (!(await checkRateLimitById("assistant", `messaging:${input.userId}`))) throw new Error("Too many requests. Wait a minute and try again.");
  const allowed = await assertAssistantAllowed(input.workspaceId);
  if (!allowed.ok) throw new Error(allowed.error);
  // The assistant area's runner, unless something else registered one (tests do).
  const runner = (globalThis as Registry)[RUNNER_KEY] ?? (await import("@/lib/assistant/messaging")).runMessagingTurn;
  const result = await runner(input);
  if (!await prisma.assistantConversation.findFirst({ where: { id: result.conversationId, workspaceId: input.workspaceId, userId: input.userId } })) throw new Error("The assistant conversation could not be verified.");
  return result;
}
