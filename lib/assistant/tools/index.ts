import "server-only";
import { SOCIAL_TOOLS } from "@/lib/social/tools";

import { z } from "zod";
import { APP_REVIEW_TOOLS } from "@/lib/appReviews/tools";
import { checkRateLimitById } from "@/lib/rateLimit";
import type { Principal, ToolChannel } from "@/lib/assistant/principal";
import { CHAT_TOOLS } from "@/lib/assistant/tools/chat";
import { DOC_TOOLS } from "@/lib/assistant/tools/docs";
import { KNOWLEDGE_TOOLS } from "@/lib/assistant/tools/knowledge";
import { TOOL_MODULE } from "@/lib/assistant/tools/modules";
import { toolAccess } from "@/lib/assistant/tools/policy";
import { getWorkspaceModules } from "@/lib/limits/modules";
import { isModuleEnabled, type ModuleSettings } from "@/lib/modules";
import { TASK_TOOLS } from "@/lib/assistant/tools/tasks";
import { ToolError, type ToolDefinition, type ToolResult } from "@/lib/assistant/tools/types";
import { WORKSPACE_TOOLS } from "@/lib/assistant/tools/workspace";

export { ToolError } from "@/lib/assistant/tools/types";
export type { ToolResult } from "@/lib/assistant/tools/types";

/**
 * The one registry of `sw_*` tools, shared by the web chat, scheduled jobs,
 * the MCP server and the REST API. Order is fixed so the tool list (and with
 * it the prompt cache prefix) is deterministic.
 */
export const ALL_TOOLS: readonly ToolDefinition[] = ([...SOCIAL_TOOLS, ...APP_REVIEW_TOOLS, ...TASK_TOOLS, ...CHAT_TOOLS, ...DOC_TOOLS, ...WORKSPACE_TOOLS, ...KNOWLEDGE_TOOLS] as unknown as ToolDefinition[]).map((tool) => (tool.module || !TOOL_MODULE[tool.name] ? tool : { ...tool, module: TOOL_MODULE[tool.name] }));

const BY_NAME = new Map<string, ToolDefinition>(ALL_TOOLS.map((tool) => [tool.name, tool]));

export function getTool(name: string): ToolDefinition | undefined {
  return BY_NAME.get(name);
}

export function isWriteTool(name: string): boolean {
  return BY_NAME.get(name)?.write ?? false;
}

/** Tools this principal may call (writes optional; jobs never get them). Pass `modules` to hide tools of disabled modules (or use `toolsForWorkspace`). */
export function toolsFor(principal: Principal, options: { includeWrites?: boolean; requireMcp?: boolean; modules?: ModuleSettings } = {}): ToolDefinition[] {
  return ALL_TOOLS.filter((tool) => (options.includeWrites ?? true ? true : !tool.write) && toolAccess(tool, principal, options).ok && (!options.modules || !tool.module || isModuleEnabled(options.modules, tool.module)));
}

/** `toolsFor` with the workspace's module switches applied. */
export async function toolsForWorkspace(principal: Principal, options: { includeWrites?: boolean; requireMcp?: boolean } = {}): Promise<ToolDefinition[]> {
  return toolsFor(principal, { ...options, modules: await getWorkspaceModules(principal.workspace.id) });
}

/** JSON Schema of a tool's input (what Anthropic tool definitions and MCP tools/list publish). */
export function toolJsonSchema(tool: ToolDefinition): { type: "object"; properties?: Record<string, unknown>; required?: string[]; [key: string]: unknown } {
  const schema = z.toJSONSchema(tool.input, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete schema.$schema;
  return { ...schema, type: "object" };
}

export type ExecuteOutcome = { ok: true; tool: ToolDefinition; result: ToolResult } | { ok: false; tool?: ToolDefinition; error: string; code: string };

/**
 * Validate, authorise, rate-limit and run one tool call with the caller's
 * rights. Never throws for expected failures: unknown tool, bad input,
 * missing scope or role, rate limit or a ToolError all come back as
 * `{ ok: false, error }` with a UI-safe sentence.
 */
export async function executeTool(
  principal: Principal,
  name: string,
  rawInput: unknown,
  options: { via: ToolChannel; requireMcp?: boolean; now?: Date },
): Promise<ExecuteOutcome> {
  const tool = BY_NAME.get(name);
  if (!tool) return { ok: false, error: `There is no tool called ${name}.`, code: "not_found" };
  if (tool.module && !isModuleEnabled(await getWorkspaceModules(principal.workspace.id), tool.module)) return { ok: false, tool, error: "That isn't available in this workspace.", code: "not_found" };
  const access = toolAccess(tool, principal, { requireMcp: options.requireMcp });
  if (!access.ok) return { ok: false, tool, error: access.reason, code: "forbidden" };
  const parsed = tool.input.safeParse(rawInput ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, tool, error: `Invalid input${issue?.path.length ? ` for ${issue.path.join(".")}` : ""}: ${issue?.message ?? "check the fields."}`, code: "invalid" };
  }
  if (tool.write) {
    const subject = principal.tokenId ? `token:${principal.tokenId}` : `user:${principal.userId}`;
    if (!(await checkRateLimitById("apiWrite", subject))) return { ok: false, tool, error: "Too many changes in a short time. Wait a minute and try again.", code: "rate_limited" };
  }
  try {
    const result = await tool.run({ principal, via: options.via, now: options.now ?? new Date() }, parsed.data);
    return { ok: true, tool, result };
  } catch (error) {
    if (error instanceof ToolError) return { ok: false, tool, error: error.message, code: error.code };
    console.error(`[assistant] tool ${name} failed`);
    return { ok: false, tool, error: "That didn't work. Try again.", code: "internal" };
  }
}
