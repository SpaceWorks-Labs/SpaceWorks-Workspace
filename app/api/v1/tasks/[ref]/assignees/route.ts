import { writeEndpoint } from "@/lib/apiTokens/http";

export const dynamic = "force-dynamic";

/** POST /api/v1/tasks/{ref}/assignees (write:tasks). Body: { userIds, mode?: "add" | "remove" | "set" }. */
export async function POST(request: Request, ctx: RouteContext<"/api/v1/tasks/[ref]/assignees">) {
  const { ref } = await ctx.params;
  return writeEndpoint(request, "sw_assign_task", { ref });
}
