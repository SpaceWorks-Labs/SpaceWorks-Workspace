/** Public (outside /w) campaign URLs. Pure; the origin comes from NEXT_PUBLIC_BASE_URL. */

export function publicBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_BASE_URL ?? "").trim().replace(/\/$/, "");
}

export const confirmUrl = (token: string) => `${publicBaseUrl()}/api/public/campaigns/confirm/${token}`;
export const unsubscribeUrl = (token: string) => `${publicBaseUrl()}/api/public/campaigns/unsubscribe/${token}`;
export const preferencesUrl = (token: string) => `${publicBaseUrl()}/m/preferences/${token}`;
export const hostedFormUrl = (workspaceSlug: string, listSlug: string) => `${publicBaseUrl()}/m/${workspaceSlug}/subscribe/${listSlug}`;
export const subscribeEndpointUrl = () => `${publicBaseUrl()}/api/public/campaigns/subscribe`;
export const sesWebhookUrl = (workspaceId: string) => `${publicBaseUrl()}/api/public/campaigns/webhooks/ses/${workspaceId}`;
export const postmarkWebhookUrl = (workspaceId: string) => `${publicBaseUrl()}/api/public/campaigns/webhooks/postmark/${workspaceId}`;
