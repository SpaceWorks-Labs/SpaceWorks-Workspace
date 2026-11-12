import { signCampaignToken } from "@/lib/campaigns/tokens";

export function campaignBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_BASE_URL ?? process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

/** Signed per-message links. Unsubscribe and preference tokens never expire. */
export function messageLinks(base: string, ids: { workspaceId: string; messageId: string; subscriberId: string }) {
  const sign = (purpose: "unsub" | "open" | "click" | "prefs") => signCampaignToken({ purpose, ...ids });
  const unsub = sign("unsub");
  return {
    unsubscribeUrl: `${base}/api/public/campaigns/unsubscribe/${unsub}`,
    preferencesUrl: `${base}/m/preferences/${sign("prefs")}`,
    openToken: sign("open"),
    clickToken: sign("click"),
  };
}
