import "server-only";

import { recordAuditEvent, type AuditMetadata } from "@/lib/audit";
import type { DbClient } from "@/lib/db";

/**
 * Campaign audit events. Metadata is limited to scalar counts and enums:
 * never an email address, a name, a token or a message body.
 */
export type CampaignAuditAction =
  | "list_created" | "list_updated" | "list_archived" | "list_restored" | "list_deleted"
  | "subscriber_added" | "subscriber_updated" | "subscriber_blocklisted" | "subscriber_unblocklisted"
  | "subscribers_imported" | "subscribers_exported" | "subscriber_erased"
  | "settings_changed" | "bounce_secret_rotated" | "bounce" | "sns_confirmation_received"
  | "campaign_created" | "campaign_deleted" | "campaign_scheduled" | "campaign_started" | "campaign_paused" | "campaign_cancelled" | "campaign_finished" | "campaign_test_sent" | "template_deleted";

const SAFE_KEYS = new Set(["count", "created", "existing", "skipped", "errors", "kind", "source", "reason", "visibility", "optIn", "from", "total", "sent", "failed"]);

export function auditCampaignEvent(input: { workspaceId: string; actorId?: string | null; action: CampaignAuditAction; targetType?: string; targetId?: string; metadata?: AuditMetadata; client?: DbClient }) {
  const metadata: AuditMetadata = {};
  for (const [key, value] of Object.entries(input.metadata ?? {})) if (SAFE_KEYS.has(key)) metadata[key] = value;
  return recordAuditEvent({ client: input.client, workspaceId: input.workspaceId, actorId: input.actorId ?? null, action: `campaigns.${input.action}`, targetType: input.targetType, targetId: input.targetId, metadata, ip: input.actorId ? undefined : null });
}
