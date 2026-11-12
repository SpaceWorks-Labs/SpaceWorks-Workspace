import { writeEndpoint } from "@/lib/apiTokens/http";

export const dynamic = "force-dynamic";

/** POST /api/v1/tasks/{ref}/move (write:tasks). Body: { column? | status?, position?: "top" | "bottom" }. */
export async function POST(request: Request, ctx: RouteContext<"/api/v1/tasks/[ref]/move">) {
  const { ref } = await ctx.params;
  return writeEndpoint(request, "sw_move_task", { ref });
}
