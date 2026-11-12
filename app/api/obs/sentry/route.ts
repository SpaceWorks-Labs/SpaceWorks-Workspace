import { handleSentryTunnel } from "@/lib/observability/sentry/tunnel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Same-origin tunnel for browser Sentry events. 404 when Sentry is off. */
export async function POST(request: Request) {
  return handleSentryTunnel(request);
}
