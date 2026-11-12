import { PUBLIC_HEADERS, publicNotFound } from "@/lib/campaigns/public/gate";
import { PIXEL_GIF, recordOpen } from "@/lib/campaigns/public/tracking";
import { checkRateLimitById, getClientIp } from "@/lib/rateLimit";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: RouteContext<"/api/public/campaigns/o/[token]">) {
  const { token } = await context.params;
  // Image proxies share IPs, so over the limit the pixel is still served and the open is just not counted.
  const count = await checkRateLimitById("campaignPublic", `open:${getClientIp(request)}`);
  if (!(await recordOpen(token, count))) return publicNotFound();
  return new Response(new Uint8Array(PIXEL_GIF), { headers: { ...PUBLIC_HEADERS, "Content-Type": "image/gif", "Content-Length": String(PIXEL_GIF.length), "Cache-Control": "no-store, max-age=0" } });
}
