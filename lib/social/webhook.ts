import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { array, object, string } from "./types";
/** Verify the exact request bytes before parsing: https://developers.facebook.com/docs/graph-api/webhooks/getting-started/ */
export function verifyMetaSignature(body: Buffer, signature: string | null, secret: string) {
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  return timingSafeEqual(Buffer.from(signature.slice(7), "hex"), createHmac("sha256", secret).update(body).digest());
}
export async function receiveMetaWebhook(raw: unknown, now = new Date()) {
  const ids = [...new Set(array(object(raw).entry).map(v => string(object(v).id)).filter(Boolean))].slice(0, 100);
  if (!ids.length) return;
  // Only wake the existing polling job; never trust comment bodies from an unsolicited event.
  await prisma.socialAccount.updateMany({ where: { platform: { in: ["FACEBOOK", "INSTAGRAM"] }, status: { in: ["ACTIVE", "DEGRADED"] }, failures: 0, leaseToken: null, workspace: { status: "ACTIVE", archivedAt: null }, OR: [{ externalId: { in: ids } }, { parentExternalId: { in: ids } }] }, data: { nextSyncAt: now } });
}
