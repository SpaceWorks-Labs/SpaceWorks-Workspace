import type { WorkspaceRole } from "@prisma/client";
import type { z } from "zod";
import type { ApiScope } from "@/lib/apiTokens/scopes";
import type { Principal, ToolChannel } from "@/lib/assistant/principal";

/** What a tool hands back: a one-line card summary ("Looked up 4 tasks") and JSON-safe data for the model. */
export type ToolResult = { summary: string; data: unknown };

/** A refusal or validation problem the model (and the person) may read. Never carries internals. */
export class ToolError extends Error {
  constructor(message: string, readonly code: "not_found" | "forbidden" | "invalid" | "conflict" | "rate_limited" | "unavailable" = "invalid") {
    super(message);
    this.name = "ToolError";
  }
}

export type ToolContext = { principal: Principal; via: ToolChannel; now: Date };

export type ToolDefinition<S extends z.ZodType = z.ZodType> = {
  name: `sw_${string}`;
  /** Short human title for tool cards. */
  title: string;
  description: string;
  input: S;
  /** Writes need MEMBER+, a confirmation in chat, a write scope for tokens, and are audited. */
  write: boolean;
  /** Scope an API token needs (an array means any one of them); null keeps the tool away from tokens (MCP and /api/v1). */
  scope: ApiScope | readonly ApiScope[] | null;
  minRole: WorkspaceRole;
  /** Extra gate (finance visibility, services, web search configured). */
  available?: (principal: Principal) => boolean;
  run: (ctx: ToolContext, input: z.output<S>) => Promise<ToolResult>;
};

export function defineTool<S extends z.ZodType>(definition: ToolDefinition<S>): ToolDefinition<S> {
  return definition;
}

export function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}
