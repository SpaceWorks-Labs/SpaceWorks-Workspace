import { writeEndpoint } from "@/lib/apiTokens/http";

export const dynamic = "force-dynamic";

/** POST /api/v1/tasks/{ref}/transfer (write:tasks). Body: { project } (target project key, required). Moves the task and its subtasks to that project. */
export async function POST(request: Request, ctx: RouteContext<"/api/v1/tasks/[ref]/transfer">) {
  const { ref } = await ctx.params;
  return writeEndpoint(request, "sw_move_task", { ref }, 200, { requiredStrings: ["project"] });
}
