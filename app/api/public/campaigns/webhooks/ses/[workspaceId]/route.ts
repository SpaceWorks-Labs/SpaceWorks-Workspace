import { handleSesWebhook } from "@/lib/campaigns/bounce/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: RouteContext<"/api/public/campaigns/webhooks/ses/[workspaceId]">) {
  return handleSesWebhook(request, (await context.params).workspaceId);
}
