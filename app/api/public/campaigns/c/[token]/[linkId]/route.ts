import { PUBLIC_HEADERS, publicNotFound } from "@/lib/campaigns/public/gate";
import { resolveClick } from "@/lib/campaigns/public/tracking";
import { checkRateLimitById, getClientIp } from "@/lib/rateLimit";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 302 to the stored URL of a link in the token's own campaign. The destination never comes from the request. */
export async function GET(request: NextRequest, context: RouteContext<"/api/public/campaigns/c/[token]/[linkId]">) {
  const { token, linkId } = await context.params;
  // Over the limit the redirect still works; the click is just not counted.
  const count = await checkRateLimitById("campaignPublic", `click:${getClientIp(request)}`);
  const url = await resolveClick(token, linkId, count);
  return url ? new Response(null, { status: 302, headers: { ...PUBLIC_HEADERS, Location: url } }) : publicNotFound();
}
