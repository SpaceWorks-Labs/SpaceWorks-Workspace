import { receivePaymentWebhook } from "@/lib/payments/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: RouteContext<"/api/payments/[provider]/[token]">) {
  const { provider, token } = await context.params;
  return receivePaymentWebhook(request, provider, token);
}
