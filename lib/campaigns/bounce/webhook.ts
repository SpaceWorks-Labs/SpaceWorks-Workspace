import "server-only";

import { checkRateLimitById, getClientIpFromHeaders } from "@/lib/rateLimit";
import { bounceSecretMatches } from "../settings";
import { auditCampaignEvent } from "../audit";
import { publicJson, resolvePublicWorkspace } from "../public/gate";
import { recordBounce, type BounceEvent } from "./record";
import { parsePostmark } from "./postmark";
import { parseSesNotification, verifySnsSignature, type SnsMessage } from "./ses";

/** Secret from `x-webhook-secret` or the password of Basic auth. Never the URL, which ends up in access logs. */
export function readWebhookSecret(request: Request): string | null {
  const header = request.headers.get("x-webhook-secret");
  if (header) return header;
  const basic = request.headers.get("authorization");
  if (basic?.toLowerCase().startsWith("basic ")) {
    const decoded = Buffer.from(basic.slice(6), "base64").toString("utf8");
    return decoded.includes(":") ? decoded.slice(decoded.indexOf(":") + 1) : null;
  }
  return null;
}

async function gate(request: Request, workspaceId: string) {
  const ip = getClientIpFromHeaders(request.headers);
  if (!(await checkRateLimitById("webhook", `campaign-bounce:${ip}`))) return publicJson({ error: "Too many requests." }, 429);
  const workspace = await resolvePublicWorkspace({ id: workspaceId });
  // An unknown workspace and a wrong secret answer identically.
  if (!workspace || !(await bounceSecretMatches(workspace.id, readWebhookSecret(request)))) return publicJson({ error: "Unauthorized." }, 401);
  return workspace;
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > 512_000) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export async function handlePostmarkWebhook(request: Request, workspaceId: string): Promise<Response> {
  const workspace = await gate(request, workspaceId);
  if (workspace instanceof Response) return workspace;
  const event = parsePostmark(await readJson(request));
  const outcome = event ? await recordBounce(workspace.id, event) : "ignored";
  return publicJson({ ok: true, outcome });
}

export async function handleSesWebhook(request: Request, workspaceId: string, fetchCert?: (url: string) => Promise<string>): Promise<Response> {
  const workspace = await gate(request, workspaceId);
  if (workspace instanceof Response) return workspace;
  const message = (await readJson(request)) as SnsMessage | null;
  if (!message || typeof message.Type !== "string" || typeof message.MessageId !== "string") return publicJson({ error: "Invalid message." }, 400);
  if (!(await verifySnsSignature(message, fetchCert))) return publicJson({ error: "Invalid signature." }, 403);
  if (message.Type === "SubscriptionConfirmation") {
    // Never fetch SubscribeURL automatically: an admin must confirm the subscription themselves.
    await auditCampaignEvent({ workspaceId: workspace.id, action: "sns_confirmation_received", metadata: { source: "SES" } });
    return publicJson({ ok: true, outcome: "confirmation_requires_admin" });
  }
  if (message.Type !== "Notification" || typeof message.Message !== "string") return publicJson({ ok: true, outcome: "ignored" });
  let inner: unknown;
  try { inner = JSON.parse(message.Message); } catch { return publicJson({ ok: true, outcome: "ignored" }); }
  const events: BounceEvent[] = parseSesNotification(message.MessageId, inner);
  let recorded = 0;
  for (const event of events) if ((await recordBounce(workspace.id, event)) === "recorded") recorded++;
  return publicJson({ ok: true, recorded });
}
