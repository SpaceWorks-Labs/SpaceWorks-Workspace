import "server-only";

import { prisma } from "@/lib/db";
import { formatRelativeTime } from "@/lib/format/datetime";
import { isSuperAdminEmail } from "@/lib/permissions";
import { getAssistantSettings } from "@/lib/instanceSettings";
import { USAGE_TITLE_PREFIX } from "@/lib/assistant/usage";
import { describePending, pendingCalls, toChatItems } from "@/lib/assistant/chat";

/** Data for the assistant chat pages (server components). */
export async function loadChatPage(input: { workspaceId: string; timeZone: string; userId: string; userEmail: string; conversationId?: string }) {
  const [settings, conversations] = await Promise.all([
    getAssistantSettings(),
    prisma.assistantConversation.findMany({
      where: { workspaceId: input.workspaceId, userId: input.userId, NOT: { title: { startsWith: USAGE_TITLE_PREFIX } } },
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: { id: true, title: true, updatedAt: true },
    }),
  ]);
  let active: { id: string; title: string; items: ReturnType<typeof toChatItems>; pending: ReturnType<typeof describePending>; tokens: number } | null = null;
  if (input.conversationId) {
    const conversation = await prisma.assistantConversation.findFirst({
      where: { id: input.conversationId, workspaceId: input.workspaceId, userId: input.userId },
      select: { id: true, title: true, messages: { orderBy: { createdAt: "asc" }, select: { id: true, role: true, content: true, tokensIn: true, tokensOut: true } } },
    });
    if (!conversation) return null;
    active = {
      id: conversation.id,
      title: conversation.title,
      items: toChatItems(conversation.messages),
      pending: describePending(pendingCalls(conversation.messages)),
      tokens: conversation.messages.reduce((sum, m) => sum + (m.tokensIn ?? 0) + (m.tokensOut ?? 0), 0),
    };
  }
  const now = new Date();
  return {
    configured: Boolean(settings.apiKey),
    setupHref: isSuperAdminEmail(input.userEmail) ? "/admin/settings" : null,
    conversations: conversations.map((c) => ({ id: c.id, title: c.title, updatedLabel: formatRelativeTime(c.updatedAt, input.timeZone, now) })),
    active,
  };
}
