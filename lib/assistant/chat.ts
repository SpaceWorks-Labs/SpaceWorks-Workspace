import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { AssistantRole, Prisma } from "@prisma/client";
import type { BetaMessageParam, BetaToolUseBlock } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { prisma } from "@/lib/db";
import { runAgentLoop, runToolCalls, systemBlocks, toApiContent, type StoredToolResult, type ToolEvent } from "@/lib/assistant/agent";
import { createAnthropicClient, getAssistantConfig, usageTotals } from "@/lib/assistant/client";
import type { Principal } from "@/lib/assistant/principal";
import { buildRequestContext, buildStableSystemPrompt, conversationTitle } from "@/lib/assistant/prompt";
import { assertAssistantAllowed } from "@/lib/assistant/usage";
import { getTool, isWriteTool, toolsForWorkspace } from "@/lib/assistant/tools";

/**
 * Web chat turns. Conversations are private to their owner. Every message is
 * stored as Anthropic content blocks (ASSISTANT rows keep thinking blocks
 * unchanged so later turns can replay them; TOOL rows are the user-role turns
 * with tool results). History is append-only.
 */

export type ChatStreamEvent =
  | { type: "text"; text: string }
  | { type: "tool"; tool: ToolEvent }
  | { type: "confirm"; calls: PendingCall[] }
  | { type: "title"; title: string }
  | { type: "done"; stop: string; usage: { tokensIn: number; tokensOut: number } }
  | { type: "error"; message: string };

export type PendingCall = { id: string; name: string; title: string; input: unknown };

const DECLINED = "The person declined this change, so it was not made.";
const MOVED_ON = "Not run: the person sent a new message instead of confirming.";

type StoredRow = { id: string; role: AssistantRole; content: Prisma.JsonValue };

function blocksOf(row: StoredRow): unknown[] {
  return Array.isArray(row.content) ? row.content : [];
}

/** The API message list for a stored conversation (consecutive user-role turns are merged by the API). */
export function toApiMessages(rows: readonly StoredRow[]): BetaMessageParam[] {
  return rows
    .map((row) => ({ role: row.role === "ASSISTANT" ? ("assistant" as const) : ("user" as const), content: toApiContent(blocksOf(row)) }))
    .filter((message) => message.content.length > 0);
}

/** Tool calls in the last assistant message that have no results yet. */
export function pendingCalls(rows: readonly StoredRow[]): BetaToolUseBlock[] {
  const last = rows.at(-1);
  if (!last || last.role !== "ASSISTANT") return [];
  return blocksOf(last).filter((block): block is BetaToolUseBlock => Boolean(block && typeof block === "object" && (block as { type?: string }).type === "tool_use"));
}

export function describePending(calls: readonly BetaToolUseBlock[]): PendingCall[] {
  return calls.filter((call) => isWriteTool(call.name)).map((call) => ({ id: call.id, name: call.name, title: getTool(call.name)?.title ?? call.name, input: call.input }));
}

async function storeMessage(conversationId: string, role: AssistantRole, content: unknown, usage?: { tokensIn: number; tokensOut: number }) {
  await prisma.$transaction([
    prisma.assistantMessage.create({
      data: { conversationId, role, content: content as Prisma.InputJsonValue, tokensIn: usage?.tokensIn ?? null, tokensOut: usage?.tokensOut ?? null },
    }),
    prisma.assistantConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } }),
  ]);
}

export async function loadOwnConversation(principal: Principal, conversationId: string) {
  return prisma.assistantConversation.findFirst({
    where: { id: conversationId, workspaceId: principal.workspace.id, userId: principal.userId },
    select: { id: true, title: true },
  });
}

/**
 * Run one chat request: an optional new user message and/or a decision on
 * pending changes, then the tool cycle until the model answers or asks for
 * another confirmation. Streams events through `emit`.
 */
export async function runChatTurn(input: {
  principal: Principal;
  conversationId: string;
  text?: string;
  decision?: "approve" | "decline";
  signal?: AbortSignal;
  emit: (event: ChatStreamEvent) => void;
}): Promise<void> {
  const { principal, emit } = input;
  const config = await getAssistantConfig();
  if (!config) {
    emit({ type: "error", message: "The assistant isn't set up yet. Ask your instance admin to add an AI key." });
    return;
  }
  const allowed = await assertAssistantAllowed(principal.workspace.id);
  if (!allowed.ok) {
    emit({ type: "error", message: allowed.error });
    return;
  }
  const conversation = await loadOwnConversation(principal, input.conversationId);
  if (!conversation) {
    emit({ type: "error", message: "That conversation isn't available." });
    return;
  }

  const rows = await prisma.assistantMessage.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: "asc" }, select: { id: true, role: true, content: true } });
  const tools = await toolsForWorkspace(principal);
  const pending = pendingCalls(rows);

  if (pending.length > 0) {
    let results: StoredToolResult[];
    if (input.decision === "approve") {
      results = await runToolCalls(principal, pending, { via: "chat", allowWrites: true, onTool: (tool) => emit({ type: "tool", tool }) });
    } else {
      const reason = input.decision === "decline" ? DECLINED : MOVED_ON;
      results = pending.map((call) => ({ type: "tool_result", tool_use_id: call.id, is_error: true, content: reason, _sw: { name: call.name, title: getTool(call.name)?.title ?? call.name, summary: input.decision === "decline" ? "Declined" : "Not run" } }));
      for (const call of pending) emit({ type: "tool", tool: { id: call.id, name: call.name, title: getTool(call.name)?.title ?? call.name, status: "error", summary: input.decision === "decline" ? "Declined" : "Not run" } });
    }
    await storeMessage(conversation.id, "TOOL", results);
  } else if (input.decision && !input.text) {
    emit({ type: "error", message: "There is nothing waiting for your confirmation." });
    return;
  }

  if (input.text) {
    await storeMessage(conversation.id, "USER", [{ type: "text", text: input.text }]);
    if (conversation.title === "New conversation") {
      const title = conversationTitle(input.text);
      await prisma.assistantConversation.update({ where: { id: conversation.id }, data: { title } });
      emit({ type: "title", title });
    }
  }

  const history = await prisma.assistantMessage.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: "asc" }, select: { id: true, role: true, content: true } });
  const skills = await prisma.assistantSkill.findMany({ where: { workspaceId: principal.workspace.id, enabled: true }, orderBy: { name: "asc" }, select: { name: true, description: true, body: true } });
  const now = new Date();
  const system = systemBlocks(
    buildStableSystemPrompt({ workspaceName: principal.workspace.name, mode: "chat", skills }),
    buildRequestContext({ userName: principal.userName, role: principal.role, now, timeZone: principal.workspace.timezone }),
  );

  let partial = "";
  const usage = { tokensIn: 0, tokensOut: 0 };
  try {
    const outcome = await runAgentLoop({
      client: createAnthropicClient(config.apiKey),
      model: config.model,
      effort: "medium",
      maxTokens: 32_000,
      system,
      tools,
      messages: toApiMessages(history),
      principal,
      via: "chat",
      confirmWrites: true,
      signal: input.signal,
      onText: (delta) => {
        partial += delta;
        emit({ type: "text", text: delta });
      },
      onTool: (tool) => emit({ type: "tool", tool }),
      onAssistant: async (message) => {
        partial = "";
        const totals = usageTotals(message);
        usage.tokensIn += totals.tokensIn;
        usage.tokensOut += totals.tokensOut;
        await storeMessage(conversation.id, "ASSISTANT", message.content, totals);
      },
      onToolResults: (results) => storeMessage(conversation.id, "TOOL", results),
    });
    if (outcome.stop === "confirm") emit({ type: "confirm", calls: describePending(outcome.pending) });
    if (outcome.stop === "refusal") emit({ type: "error", message: "I can't help with that request." });
    if (outcome.stop === "truncated") emit({ type: "error", message: "That answer ran too long. Ask for a smaller piece." });
    emit({ type: "done", stop: outcome.stop, usage });
  } catch (error) {
    if (error instanceof Anthropic.APIUserAbortError || input.signal?.aborted) {
      // Keep what was already said, so the transcript matches what the person saw.
      if (partial.trim()) await storeMessage(conversation.id, "ASSISTANT", [{ type: "text", text: partial }]);
      return;
    }
    if (error instanceof Anthropic.AuthenticationError) emit({ type: "error", message: "The AI key was rejected. Ask your instance admin to check it." });
    else if (error instanceof Anthropic.RateLimitError) emit({ type: "error", message: "The assistant is busy right now. Try again in a minute." });
    else {
      console.error("[assistant] chat turn failed");
      emit({ type: "error", message: "The assistant couldn't answer. Try again." });
    }
  }
}

/** Chat history as UI items: text bubbles and tool cards (thinking blocks are never shown). */
export type ChatItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string }
  | { kind: "tool"; id: string; title: string; summary: string; error: boolean };

export function toChatItems(rows: readonly StoredRow[]): ChatItem[] {
  const items: ChatItem[] = [];
  for (const row of rows) {
    for (const [index, block] of blocksOf(row).entries()) {
      const b = block as { type?: string; text?: string; is_error?: boolean; _sw?: { title: string; summary: string } };
      if (row.role === "USER" && b.type === "text" && b.text) items.push({ kind: "user", id: `${row.id}:${index}`, text: b.text });
      if (row.role === "ASSISTANT" && b.type === "text" && b.text?.trim()) items.push({ kind: "assistant", id: `${row.id}:${index}`, text: b.text });
      if (row.role === "TOOL" && b.type === "tool_result") items.push({ kind: "tool", id: `${row.id}:${index}`, title: b._sw?.title ?? "Tool", summary: b._sw?.summary ?? "", error: Boolean(b.is_error) });
    }
  }
  return items;
}

