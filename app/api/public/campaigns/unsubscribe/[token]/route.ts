import { getClientIp, checkRateLimitById } from "@/lib/rateLimit";
import { PUBLIC_HEADERS, publicNotFound, publicRedirect } from "@/lib/campaigns/public/gate";
import { resolveUnsubscribeTarget, unsubscribeEverywhere, unsubscribeFromLists } from "@/lib/campaigns/public/unsubscribe";
import { preferencesTokenFor } from "@/lib/campaigns/public/prefsToken";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: RouteContext<"/api/public/campaigns/unsubscribe/[token]">) {
  const { token } = await context.params;
  return publicRedirect(request, `/m/unsubscribe/${encodeURIComponent(token)}`);
}

/**
 * POST with `List-Unsubscribe=One-Click` (RFC 8058): unsubscribe from the
 * message's lists, 200 and no body, no CSRF check (the token is the capability).
 * The page's buttons post a `choice` field instead and are redirected.
 */
export async function POST(request: NextRequest, context: RouteContext<"/api/public/campaigns/unsubscribe/[token]">) {
  const { token } = await context.params;
  if (!(await checkRateLimitById("campaignPublic", `unsub:${getClientIp(request)}`))) return new Response(null, { status: 429, headers: PUBLIC_HEADERS });
  const target = await resolveUnsubscribeTarget(token);
  if (!target) return publicNotFound();
  const form = await request.formData().catch(() => null);
  const choice = typeof form?.get("choice") === "string" ? String(form?.get("choice")) : "";
  if (choice === "prefs") return publicRedirect(request, `/m/preferences/${encodeURIComponent(preferencesTokenFor(target))}`);
  if (choice === "all") {
    await unsubscribeEverywhere(target.workspaceId, target.subscriberId, "unsubscribe_all");
    return publicRedirect(request, "/m/done/unsubscribed");
  }
  await unsubscribeFromLists(target, "one_click");
  return choice ? publicRedirect(request, "/m/done/unsubscribed") : new Response(null, { status: 200, headers: PUBLIC_HEADERS });
}
