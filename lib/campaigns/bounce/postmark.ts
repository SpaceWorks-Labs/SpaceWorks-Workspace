import type { BounceKind } from "@prisma/client";
import type { BounceEvent } from "./record";

/** Postmark bounce `TypeCode` values that matter. Everything else (autoresponders, subscribe changes) is ignored. */
const HARD = new Set([1, 100000, 100002]);
const SOFT = new Set([2, 256, 2048, 4096, 100006]);
const COMPLAINT = new Set([512, 100001]);

export function postmarkKind(typeCode: number): BounceKind | null {
  if (HARD.has(typeCode)) return "HARD";
  if (COMPLAINT.has(typeCode)) return "COMPLAINT";
  return SOFT.has(typeCode) ? "SOFT" : null;
}

/** Turn a Postmark Bounce or SpamComplaint webhook body into a bounce event, or null when it is not one we act on. */
export function parsePostmark(body: unknown): BounceEvent | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const email = typeof b.Email === "string" ? b.Email : typeof b.Recipient === "string" ? b.Recipient : null;
  if (!email) return null;
  const kind = b.RecordType === "SpamComplaint" ? "COMPLAINT" : b.RecordType === "Bounce" && typeof b.TypeCode === "number" ? postmarkKind(b.TypeCode) : null;
  if (!kind) return null;
  const id = b.ID ?? b.MessageID;
  return {
    email, kind, source: "POSTMARK",
    diagnostic: typeof b.Description === "string" ? b.Description : typeof b.Details === "string" ? b.Details : null,
    providerEventId: id !== undefined && id !== null ? `postmark:${String(id)}` : null,
  };
}
