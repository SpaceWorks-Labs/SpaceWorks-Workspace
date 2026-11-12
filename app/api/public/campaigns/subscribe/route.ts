import { getClientIp } from "@/lib/rateLimit";
import { handleSubscribe, NEUTRAL_MESSAGE } from "@/lib/campaigns/public/subscribe";
import { publicJson, publicNotFound, publicRedirect } from "@/lib/campaigns/public/gate";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const type = request.headers.get("content-type") ?? "";
  const isForm = type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data");
  let body: unknown = null;
  try {
    if (isForm) body = Object.fromEntries([...(await request.formData()).entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""]));
    else body = await request.json();
  } catch {
    body = null;
  }
  const result = await handleSubscribe(body, { ip: getClientIp(request), userAgent: request.headers.get("user-agent") });
  if (result.status === "not_found") return publicNotFound();
  if (result.status === "rate_limited") return publicJson({ error: "Too many attempts. Wait a while and try again." }, 429);
  if (result.status === "invalid") return isForm ? publicRedirect(request, "/m/done/invalid") : publicJson({ error: result.message }, 400);
  return isForm ? publicRedirect(request, "/m/done/subscribe") : publicJson({ ok: true, message: NEUTRAL_MESSAGE });
}
