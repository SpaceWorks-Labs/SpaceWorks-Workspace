import crypto from "node:crypto";
import type { BounceKind } from "@prisma/client";
import type { BounceEvent } from "./record";

/** An SNS envelope as delivered over HTTPS (Content-Type text/plain, JSON body). */
export type SnsMessage = Record<string, string | undefined> & { Type: string; MessageId: string };

const CERT_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;

/** The signing certificate must be fetched from an SNS host over https, and be a .pem file. */
export function isTrustedCertUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.port && !url.username && CERT_HOST.test(url.hostname) && url.pathname.endsWith(".pem");
  } catch {
    return false;
  }
}

const NOTIFICATION_FIELDS = ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"];
const CONFIRM_FIELDS = ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"];

export function stringToSign(message: SnsMessage): string {
  const fields = message.Type === "Notification" ? NOTIFICATION_FIELDS : CONFIRM_FIELDS;
  return fields.filter((f) => message[f] !== undefined).map((f) => `${f}\n${message[f]}\n`).join("");
}

const certCache = new Map<string, string>();

async function fetchCertPem(url: string): Promise<string> {
  const hit = certCache.get(url);
  if (hit) return hit;
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("certificate fetch failed");
  const pem = (await response.text()).slice(0, 20_000);
  if (certCache.size > 20) certCache.clear();
  certCache.set(url, pem);
  return pem;
}

/** Verify the SNS signature. `fetchCert` is injectable so tests can use a fixture key. */
export async function verifySnsSignature(message: SnsMessage, fetchCert: (url: string) => Promise<string> = fetchCertPem): Promise<boolean> {
  if (!isTrustedCertUrl(message.SigningCertURL) || !message.Signature) return false;
  const algorithm = message.SignatureVersion === "2" ? "RSA-SHA256" : message.SignatureVersion === "1" ? "RSA-SHA1" : null;
  if (!algorithm) return false;
  try {
    const verifier = crypto.createVerify(algorithm);
    verifier.update(stringToSign(message), "utf8");
    return verifier.verify(await fetchCert(message.SigningCertURL!), message.Signature, "base64");
  } catch {
    return false;
  }
}

function kindFor(bounceType: unknown): BounceKind {
  return bounceType === "Permanent" ? "HARD" : "SOFT";
}

/** Bounce or complaint events carried by an SES notification (one per recipient). */
export function parseSesNotification(snsMessageId: string, body: unknown): BounceEvent[] {
  if (!body || typeof body !== "object") return [];
  const b = body as { notificationType?: string; eventType?: string; bounce?: { bounceType?: string; bouncedRecipients?: { emailAddress?: string; diagnosticCode?: string }[] }; complaint?: { complainedRecipients?: { emailAddress?: string }[] } };
  const type = b.notificationType ?? b.eventType;
  const events: BounceEvent[] = [];
  if (type === "Bounce" && b.bounce) {
    for (const r of b.bounce.bouncedRecipients ?? []) if (r.emailAddress) events.push({ email: r.emailAddress, kind: kindFor(b.bounce.bounceType), source: "SES", diagnostic: r.diagnosticCode ?? null, providerEventId: `ses:${snsMessageId}:${r.emailAddress.toLowerCase()}` });
  } else if (type === "Complaint" && b.complaint) {
    for (const r of b.complaint.complainedRecipients ?? []) if (r.emailAddress) events.push({ email: r.emailAddress, kind: "COMPLAINT", source: "SES", providerEventId: `ses:${snsMessageId}:${r.emailAddress.toLowerCase()}` });
  }
  return events;
}
