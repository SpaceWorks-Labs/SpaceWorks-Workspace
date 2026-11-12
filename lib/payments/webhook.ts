import "server-only";
import { prisma } from "@/lib/db";
import { readInboundBody } from "@/lib/messaging/inbound";
import { checkRateLimitById, getClientIpFromHeaders } from "@/lib/rateLimit";
import { openCredentials, providerFromSegment, type RazorpayCredentials, type StripeCredentials } from "./credentials";
import { parseRazorpayEvent, parseStripeEvent, type PaymentEvent } from "./events";
import { applyPaymentEvent } from "./settle";
import { verifyRazorpaySignature, verifyStripeSignature } from "./signatures";

/**
 * POST /api/payments/[provider]/[token]. Order matters: rate limit, token
 * (404), raw body, signature (400), then one transaction that records the
 * event id (dedupe) and applies it. Replays and events we don't act on get
 * 2xx so providers stop retrying; only an unexpected failure returns 500 so
 * the provider retries. Bodies, signatures and keys are never logged.
 */

const MAX_BODY_BYTES = 512 * 1024;
const empty = (status: number) => new Response(null, { status });

export async function receivePaymentWebhook(request: Request, providerSegment: string, token: string): Promise<Response> {
  const provider = providerFromSegment(providerSegment);
  if (!provider || !/^[A-Za-z0-9_-]{16,64}$/.test(token)) return empty(404);
  if (!(await checkRateLimitById("paymentWebhook", getClientIpFromHeaders(request.headers)))) return empty(429);
  const account = await prisma.paymentProviderAccount.findFirst({ where: { webhookToken: token, provider, status: "ACTIVE", workspace: { status: "ACTIVE", archivedAt: null } } });
  if (!account) return empty(404);
  let body: string;
  try { body = await readInboundBody(request, MAX_BODY_BYTES); } catch { return empty(413); }
  const credentials = openCredentials(provider, account.credentialsEnc);
  if (!credentials?.webhookSecret) return empty(400);
  const valid = provider === "STRIPE"
    ? verifyStripeSignature((credentials as StripeCredentials).webhookSecret, body, request.headers.get("stripe-signature"))
    : verifyRazorpaySignature((credentials as RazorpayCredentials).webhookSecret, body, request.headers.get("x-razorpay-signature"));
  if (!valid) return empty(400);
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return empty(400); }
  const event: PaymentEvent | null = provider === "STRIPE" ? parseStripeEvent(parsed) : parseRazorpayEvent(parsed, request.headers.get("x-razorpay-event-id"), body);
  if (!event) return Response.json({ ok: true, ignored: true });
  try {
    const afterCommit = await prisma.$transaction(async (tx) => {
      const recorded = await tx.paymentWebhookEvent.createMany({ data: [{ provider, eventId: event.eventId, workspaceId: account.workspaceId, status: "RECEIVED" }], skipDuplicates: true });
      if (recorded.count === 0) return null;
      const applied = await applyPaymentEvent(tx, account, event);
      await tx.paymentWebhookEvent.updateMany({ where: { workspaceId: account.workspaceId, provider, eventId: event.eventId }, data: { status: applied.status } });
      return applied.afterCommit;
    }, { timeout: 20_000 });
    for (const run of afterCommit ?? []) await run().catch(() => undefined);
    return Response.json({ ok: true, duplicate: afterCommit === null });
  } catch {
    console.error("[payments] webhook processing failed");
    return empty(500);
  }
}
