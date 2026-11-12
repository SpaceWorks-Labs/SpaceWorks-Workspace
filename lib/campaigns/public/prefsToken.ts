import { signCampaignToken } from "../tokens";
import type { UnsubscribeTarget } from "./unsubscribe";

/** A preferences token for the subscriber an unsubscribe token already identified. */
export function preferencesTokenFor(target: Pick<UnsubscribeTarget, "workspaceId" | "subscriberId">): string {
  return signCampaignToken({ purpose: "prefs", workspaceId: target.workspaceId, subscriberId: target.subscriberId });
}
