import { withMetrics } from "@/lib/observability/metrics/http";
import { apiJson, queryParams, requireApiToken, runApiTool, writeEndpoint } from "@/lib/apiTokens/http";

export const dynamic = "force-dynamic";

/** GET /api/v1/channels/{channel}/messages (read:chat). Query: limit, before (ISO time). Newest first; page with `nextBefore`. */
export const GET = withMetrics(async (request: Request, ctx: RouteContext<"/api/v1/channels/[channel]/messages">) => {
  const { channel } = await ctx.params;
  const token = await requireApiToken(request, "read");
  if (token instanceof Response) return token;
  const result = await runApiTool(token, "sw_read_channel_messages", { ...queryParams(request), channel });
  if (!result.ok) return result.response;
  const body = result.data as { messages: unknown[]; oldestAt: string | null };
  return apiJson({ data: body.messages, nextBefore: body.oldestAt });
});

/** POST /api/v1/channels/{channel}/messages (write:chat). Body: { text }. Posts as the token's creator. */
export async function POST(request: Request, ctx: RouteContext<"/api/v1/channels/[channel]/messages">) {
  const { channel } = await ctx.params;
  return writeEndpoint(request, "sw_send_channel_message", { channel }, 201);
}
