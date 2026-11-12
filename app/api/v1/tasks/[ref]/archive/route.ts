import { writeEndpoint } from "@/lib/apiTokens/http";

export const dynamic = "force-dynamic";

/** POST /api/v1/tasks/{ref}/archive (write:tasks). Body: { archived?: boolean } (default true; false restores). */
export async function POST(request: Request, ctx: RouteContext<"/api/v1/tasks/[ref]/archive">) {
  const { ref } = await ctx.params;
  return writeEndpoint(request, "sw_archive_task", { ref }, 200, { bodyOptional: true });
}
