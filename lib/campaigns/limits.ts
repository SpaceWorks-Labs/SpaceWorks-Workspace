import "server-only";

import { getEffectiveLimits } from "@/lib/limits";
import { workspaceUsage } from "@/lib/limits/usage";
import { loadWorkspaceSmtp } from "@/lib/email/workspaceTransport";

/** Without workspace SMTP, one campaign may reach at most this many recipients (protects the shared instance relay). */
export const SHARED_SMTP_RECIPIENT_CAP = 500;

export type EmailCapSummary = { cap: number | null; used: number; remaining: number | null; reached: boolean };

/** Monthly email cap, usage and what is left. `cap` null means unlimited. */
export async function emailCapSummary(workspaceId: string): Promise<EmailCapSummary> {
  const [limits, usage] = await Promise.all([getEffectiveLimits(workspaceId), workspaceUsage(workspaceId)]);
  const cap = limits.monthlyEmailCap;
  const used = usage.emailsThisMonth;
  return { cap, used, remaining: cap === null ? null : Math.max(0, cap - used), reached: cap !== null && used >= cap };
}

/** True when the workspace sends through the shared instance relay (no enabled workspace SMTP). */
export async function usesSharedSmtp(workspaceId: string): Promise<boolean> {
  return (await loadWorkspaceSmtp(workspaceId)) === null;
}

export const SHARED_SMTP_WARNING = `This workspace has no email server of its own, so each campaign is limited to ${SHARED_SMTP_RECIPIENT_CAP} recipients. Add one under Settings, Email sending.`;
