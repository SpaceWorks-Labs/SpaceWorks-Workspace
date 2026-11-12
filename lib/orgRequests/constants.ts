import { TOGGLEABLE_MODULES } from "@/lib/modules";

export const MAX_PENDING_PER_USER = 3;
export const MAX_PENDING_PER_WORKSPACE = 5;

/** Limits an owner can ask to raise. `unit: "bytes"` limits are entered in MB in the UI. */
export const REQUESTABLE_LIMITS = {
  maxMembers: { label: "Members", unit: "count" },
  maxGuests: { label: "Guests", unit: "count" },
  maxProjects: { label: "Projects", unit: "count" },
  maxStorageBytes: { label: "Storage", unit: "bytes" },
  maxFileBytes: { label: "Largest file", unit: "bytes" },
  maxApiTokens: { label: "API tokens", unit: "count" },
  maxWebhooks: { label: "Webhooks", unit: "count" },
  assistantMonthlyTokens: { label: "Assistant tokens per month", unit: "count" },
  monthlyEmailCap: { label: "Emails per month", unit: "count" },
} as const;

export type RequestableLimit = keyof typeof REQUESTABLE_LIMITS;
export const REQUESTABLE_LIMIT_KEYS = Object.keys(REQUESTABLE_LIMITS) as [RequestableLimit, ...RequestableLimit[]];

/** Module keys a FEATURE request may name (payroll is a sub-area of finance). */
export const REQUESTABLE_MODULES: string[] = [...TOGGLEABLE_MODULES.map((module) => module.key), "finance.payroll"];

export function moduleLabel(key: string): string {
  if (key === "finance.payroll") return "Payroll";
  return TOGGLEABLE_MODULES.find((module) => module.key === key)?.label ?? key;
}
