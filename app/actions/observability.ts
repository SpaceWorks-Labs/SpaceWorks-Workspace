"use server";

import crypto from "crypto";
import { z } from "zod";
import { revalidatePath } from "@/lib/frontend/cache";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { actionError, RATE_LIMITED, type ActionResult } from "@/lib/actionResult";
import { recordAuditEvent } from "@/lib/audit";
import { getInstanceSettings, setInstanceSettings, type InstanceSettingKey } from "@/lib/instanceSettings";
import { testProvider } from "@/lib/observability";
import { probeHealth } from "@/lib/observability/admin/probe";
import { PROVIDER_IDS } from "@/lib/observability/admin/providers";
import { getObservabilityValues } from "@/lib/observability/admin/settings";
import { validateObservability } from "@/lib/observability/admin/validate";
import { signDashboardToken } from "@/lib/observability/metabase/sign";
import { requireSuperAdminMfa } from "@/lib/permissions";

const saveSchema = z.record(z.string(), z.union([z.string().max(4000), z.null()]));
const providerSchema = z.enum(PROVIDER_IDS);

/**
 * Save observability settings. Secrets are write-only (blank keeps the stored
 * value). Refuses to enable a provider that lacks its required settings.
 */
export async function saveObservability(input: unknown): Promise<ActionResult> {
  const session = await requireSuperAdminMfa();
  if (await isActionRateLimited("action", session.user.id)) return actionError(RATE_LIMITED);
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return actionError("Check the settings and try again.");
  const current = await getObservabilityValues();
  const problem = validateObservability(parsed.data, current);
  if (problem) return actionError(problem);
  const changed = await setInstanceSettings(parsed.data as Partial<Record<InstanceSettingKey, string | null>>, session.user.id);
  // Keys only: values, and especially secrets, never reach the audit log.
  await recordAuditEvent({ action: "admin.observability_updated", actorId: session.user.id, metadata: { keys: Object.keys(parsed.data).join(",").slice(0, 500), changed } });
  revalidatePath("/admin/observability");
  return { ok: true };
}

/** Check one provider's configuration. The result is a short sentence and never echoes a secret. */
export async function testObservability(provider: unknown): Promise<ActionResult<{ message: string }>> {
  const session = await requireSuperAdminMfa();
  if (await isActionRateLimited("action", session.user.id, 5)) return actionError(RATE_LIMITED);
  const id = providerSchema.safeParse(provider);
  if (!id.success) return actionError("Unknown provider.");
  const s = await getInstanceSettings(["obs.metrics.enabled", "obs.metrics.token", "obs.grafana.url", "obs.metabase.siteUrl", "obs.metabase.secretKey"]);
  let result: { ok: boolean; message: string };
  if (id.data === "metrics") {
    result = s["obs.metrics.token"] ? { ok: s["obs.metrics.enabled"] === "true", message: s["obs.metrics.enabled"] === "true" ? "Metrics are on and a token is set. Scrape /api/metrics with it." : "A token is set, but metrics are turned off." } : { ok: false, message: "Rotate the token to create one first." };
  } else if (id.data === "grafana") {
    result = s["obs.grafana.url"] ? await probeHealth(s["obs.grafana.url"], "/api/health") : { ok: false, message: "Add the Grafana URL first." };
  } else if (id.data === "metabase") {
    if (!s["obs.metabase.siteUrl"] || !s["obs.metabase.secretKey"]) result = { ok: false, message: "Add the site URL and embedding secret first." };
    else {
      await signDashboardToken({ secret: s["obs.metabase.secretKey"], dashboardId: 1, allowed: [1] });
      result = await probeHealth(s["obs.metabase.siteUrl"], "/api/health");
    }
  } else {
    result = await testProvider(id.data);
  }
  await recordAuditEvent({ action: "admin.observability_tested", actorId: session.user.id, metadata: { provider: id.data, ok: result.ok } });
  return result.ok ? { ok: true, data: { message: result.message } } : actionError(result.message);
}

/** Create a new scrape token and show it once. The previous token stops working immediately. */
export async function rotateMetricsToken(): Promise<ActionResult<{ token: string }>> {
  const session = await requireSuperAdminMfa();
  if (await isActionRateLimited("action", session.user.id, 5)) return actionError(RATE_LIMITED);
  const token = crypto.randomBytes(36).toString("base64url");
  await setInstanceSettings({ "obs.metrics.token": token }, session.user.id);
  await recordAuditEvent({ action: "admin.metrics_token_rotated", actorId: session.user.id });
  revalidatePath("/admin/observability");
  return { ok: true, data: { token } };
}
