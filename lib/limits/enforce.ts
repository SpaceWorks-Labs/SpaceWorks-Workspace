import "server-only";

import { getEffectiveLimits, type Limits } from "@/lib/limits";
import { workspaceUsage, type WorkspaceUsage } from "@/lib/limits/usage";
import type { DbClient } from "@/lib/db";
import { formatBytes } from "@/lib/limits/format";

export type LimitKind = "members" | "guests" | "projects" | "storageBytes" | "fileBytes" | "apiTokens" | "webhooks" | "assistantTokens" | "emails";

export type LimitResult = { ok: true } | { ok: false; error: string };

const ASK = "Ask the instance admin to raise it.";

type Rule = { cap: (limits: Limits) => number | null; used: (usage: WorkspaceUsage) => number; message: (cap: number) => string };

const RULES: Record<Exclude<LimitKind, "fileBytes">, Rule> = {
  members: { cap: (l) => l.maxMembers, used: (u) => u.members, message: (cap) => `This organisation has reached its member limit (${cap}). ${ASK}` },
  guests: { cap: (l) => l.maxGuests, used: (u) => u.guests, message: (cap) => `This organisation has reached its guest limit (${cap}). ${ASK}` },
  projects: { cap: (l) => l.maxProjects, used: (u) => u.projects, message: (cap) => `This organisation has reached its project limit (${cap}). Archive a project or ask the instance admin to raise it.` },
  storageBytes: { cap: (l) => l.maxStorageBytes, used: (u) => u.storageBytes, message: (cap) => `This organisation has used its storage allowance (${formatBytes(cap)}). Delete files or ask the instance admin to raise it.` },
  apiTokens: { cap: (l) => l.maxApiTokens, used: (u) => u.apiTokens, message: (cap) => `This organisation has reached its API token limit (${cap}). Revoke a token or ask the instance admin to raise it.` },
  webhooks: { cap: (l) => l.maxWebhooks, used: (u) => u.webhooks, message: (cap) => `This organisation has reached its webhook limit (${cap}). Remove one or ask the instance admin to raise it.` },
  assistantTokens: { cap: (l) => l.assistantMonthlyTokens, used: (u) => u.assistantTokensThisMonth, message: (cap) => `This organisation has used its monthly assistant allowance (${cap.toLocaleString("en-US")} tokens). It resets next month, or ask the instance admin to raise it.` },
  emails: { cap: (l) => l.monthlyEmailCap, used: (u) => u.emailsThisMonth, message: (cap) => `This organisation has reached its monthly email cap (${cap.toLocaleString("en-US")}). It resets next month, or ask the instance admin to raise it.` },
};

export { formatBytes };

/**
 * Pure check for tests and callers that already hold limits and usage.
 * For `fileBytes`, `delta` is the size of the single file being added.
 */
export function evaluateLimit(kind: LimitKind, limits: Limits, usage: WorkspaceUsage, delta = 1): LimitResult {
  if (kind === "fileBytes") {
    return delta > limits.maxFileBytes ? { ok: false, error: `This file is larger than the ${formatBytes(limits.maxFileBytes)} limit for one file. Choose a smaller file.` } : { ok: true };
  }
  if (kind === "assistantTokens" && !limits.assistantEnabled) return { ok: false, error: "The assistant is switched off for this organisation. Ask the instance admin to enable it." };
  const rule = RULES[kind];
  const cap = rule.cap(limits);
  if (cap === null || delta <= 0) return { ok: true };
  return rule.used(usage) + delta > cap ? { ok: false, error: rule.message(cap) } : { ok: true };
}

/**
 * Would adding `delta` more of `kind` stay inside the workspace's limits?
 * Pass a transaction client to count inside the same transaction (callers
 * racing on the last slot should still lock a row first). Unlimited kinds never touch the usage queries.
 */
export async function assertWithinLimit(kind: LimitKind, workspaceId: string, delta = 1, tx?: DbClient): Promise<LimitResult> {
  const limits = await getEffectiveLimits(workspaceId);
  if (kind === "fileBytes") return evaluateLimit(kind, limits, EMPTY, delta);
  if (kind === "assistantTokens" && !limits.assistantEnabled) return evaluateLimit(kind, limits, EMPTY, delta);
  if (RULES[kind].cap(limits) === null) return { ok: true };
  return evaluateLimit(kind, limits, await workspaceUsage(workspaceId, new Date(), tx ?? undefined), delta);
}

const EMPTY: WorkspaceUsage = { members: 0, guests: 0, projects: 0, storageBytes: 0, apiTokens: 0, webhooks: 0, assistantTokensThisMonth: 0, emailsThisMonth: 0 };
