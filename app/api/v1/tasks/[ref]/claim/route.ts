import { writeEndpoint } from "@/lib/apiTokens/http";

export const dynamic = "force-dynamic";

/** POST /api/v1/tasks/{ref}/claim (write:tasks): assign the token's creator to the task. */
export async function POST(request: Request, ctx: RouteContext<"/api/v1/tasks/[ref]/claim">) {
  const { ref } = await ctx.params;
  return writeEndpoint(request, "sw_claim_task", { ref, release: false }, 200, { bodyOptional: true });
}

/** DELETE /api/v1/tasks/{ref}/claim (write:tasks): take the token's creator off the task. */
export async function DELETE(request: Request, ctx: RouteContext<"/api/v1/tasks/[ref]/claim">) {
  const { ref } = await ctx.params;
  return writeEndpoint(request, "sw_claim_task", { ref, release: true }, 200, { bodyOptional: true });
}
