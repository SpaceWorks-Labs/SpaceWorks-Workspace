import { confirmSubscription } from "@/lib/campaigns/subscriptions";
import { publicRedirect, resolvePublicWorkspace, publicNotFound } from "@/lib/campaigns/public/gate";
import { getClientIp, checkRateLimitById } from "@/lib/rateLimit";
import { verifyCampaignToken } from "@/lib/campaigns/tokens";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET never confirms (link scanners follow it): it only sends the reader to the button page. */
export async function GET(request: NextRequest, context: RouteContext<"/api/public/campaigns/confirm/[token]">) {
  const { token } = await context.params;
  return publicRedirect(request, `/m/confirm/${encodeURIComponent(token)}`);
}

export async function POST(request: NextRequest, context: RouteContext<"/api/public/campaigns/confirm/[token]">) {
  const { token } = await context.params;
  if (!(await checkRateLimitById("campaignPublic", `confirm:${getClientIp(request)}`))) return new Response("Too many requests", { status: 429 });
  const payload = verifyCampaignToken(token, "confirm");
  if (!payload || !(await resolvePublicWorkspace({ id: payload.workspaceId }))) return publicNotFound();
  return publicRedirect(request, (await confirmSubscription(token)) ? "/m/done/confirmed" : "/m/done/invalid");
}
