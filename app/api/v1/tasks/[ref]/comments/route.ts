import { writeEndpoint } from "@/lib/apiTokens/http";

export const dynamic = "force-dynamic";

/** POST /api/v1/tasks/{ref}/comments (write:tasks). Body: { body }. */
export async function POST(request: Request, ctx: RouteContext<"/api/v1/tasks/[ref]/comments">) {
  const { ref } = await ctx.params;
  return writeEndpoint(request, "sw_add_comment", { ref }, 201);
}
