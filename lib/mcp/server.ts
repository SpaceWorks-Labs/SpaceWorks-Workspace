import "server-only";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Principal } from "@/lib/assistant/principal";
import { executeTool, toolJsonSchema, toolsForWorkspace } from "@/lib/assistant/tools";

/**
 * The Space Works MCP server: the same `sw_*` tools as the web assistant,
 * for an API token with the `mcp` scope. Each tool also needs its own scope
 * (tools/list only shows the ones the token may call). Stateless Streamable
 * HTTP with JSON responses: one server and transport per request.
 */
export function createMcpServer(principal: Principal): Server {
  const server = new Server(
    { name: "space-works", title: "Space Works", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions: `Tools for the "${principal.workspace.name}" Space Works workspace. Read tools are safe to call; write tools change shared data and are audited.`,
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: (await toolsForWorkspace(principal, { requireMcp: true })).map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: toolJsonSchema(tool),
      annotations: { title: tool.title, readOnlyHint: !tool.write, destructiveHint: tool.name === "sw_forget", openWorldHint: tool.name === "sw_web_search" },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const outcome = await executeTool(principal, request.params.name, request.params.arguments ?? {}, { via: "mcp", requireMcp: true });
    if (!outcome.ok) return { isError: true, content: [{ type: "text" as const, text: outcome.error }] };
    return { content: [{ type: "text" as const, text: JSON.stringify(outcome.result.data) }] };
  });

  return server;
}

/** Handle one MCP HTTP request for an authenticated principal. */
export async function handleMcpRequest(principal: Principal, request: Request): Promise<Response> {
  const server = createMcpServer(principal);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: 1024 * 1024 });
  await server.connect(transport);
  // Stateless: nothing outlives this request, so the pair is simply dropped afterwards.
  return transport.handleRequest(request);
}
