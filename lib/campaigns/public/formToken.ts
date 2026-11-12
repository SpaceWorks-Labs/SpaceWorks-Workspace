import "server-only";

import { decryptSecret, encryptSecret } from "@/lib/crypto";

/**
 * Signed timestamp embedded in the subscribe form. It is authenticated
 * encryption under the campaign.link subkey, so it cannot be forged or moved
 * to another workspace or list. A bot that posts faster than a person can
 * type, or replays an old token, is rejected.
 */
export const FORM_MIN_AGE_MS = 3_000;
export const FORM_MAX_AGE_MS = 60 * 60 * 1000;

export function issueFormToken(workspaceId: string, listId: string, now = Date.now()): string {
  return encryptSecret("campaign.link", `form:${workspaceId}:${listId}:${now}`);
}

export type FormTokenCheck = "ok" | "too_fast" | "expired" | "invalid";

export function checkFormToken(token: unknown, workspaceId: string, listId: string, now = Date.now()): FormTokenCheck {
  if (typeof token !== "string" || !token || token.length > 600) return "invalid";
  let plain: string;
  try {
    plain = decryptSecret("campaign.link", token);
  } catch {
    return "invalid";
  }
  const [kind, ws, list, issued] = plain.split(":");
  const at = Number(issued);
  if (kind !== "form" || ws !== workspaceId || list !== listId || !Number.isFinite(at)) return "invalid";
  const age = now - at;
  if (age < FORM_MIN_AGE_MS) return "too_fast";
  return age > FORM_MAX_AGE_MS ? "expired" : "ok";
}
