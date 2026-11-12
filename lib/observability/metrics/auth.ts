import "server-only";
import { bearerSecretMatches } from "@/lib/bearerSecret";
import { getInstanceSettings } from "@/lib/instanceSettings";

/** True only when metrics are enabled and the bearer token matches. Callers answer 404 otherwise. */
export async function metricsAuthorized(authorization: string | null): Promise<boolean> {
  const settings = await getInstanceSettings(["obs.metrics.enabled", "obs.metrics.token"]);
  if (settings["obs.metrics.enabled"] !== "true") return false;
  return bearerSecretMatches(authorization, settings["obs.metrics.token"]);
}
