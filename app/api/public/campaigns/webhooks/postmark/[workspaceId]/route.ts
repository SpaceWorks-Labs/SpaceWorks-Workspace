import { handlePostmarkWebhook } from "@/lib/campaigns/bounce/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: RouteContext<"/api/public/campaigns/webhooks/postmark/[workspaceId]">) {
  return handlePostmarkWebhook(request, (await context.params).workspaceId);
}
