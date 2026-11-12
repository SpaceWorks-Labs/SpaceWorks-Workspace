import { prisma } from "@/lib/db";
import { sha256Hex } from "@/lib/crypto";

/** Click tracking helpers. Only http(s) links are tracked; placeholder links are never rewritten. */

const ANCHOR_HREF = /(<a\b[^>]*?\shref=")([^"]*)(")/gi;
const decodeAmp = (value: string) => value.replace(/&amp;/g, "&");
const isTrackable = (url: string) => /^https?:\/\/[^\s]+$/i.test(url);

export function collectLinks(html: string): string[] {
  const urls = new Set<string>();
  for (const match of html.matchAll(ANCHOR_HREF)) {
    const url = decodeAmp(match[2] ?? "");
    if (isTrackable(url)) urls.add(url);
  }
  return [...urls];
}

/** Point tracked links at the redirect route. `{{click_token}}` is filled per message. */
export function rewriteLinks(html: string, idByUrl: ReadonlyMap<string, string>, baseUrl: string): string {
  return html.replace(ANCHOR_HREF, (whole, open: string, href: string, close: string) => {
    const id = idByUrl.get(decodeAmp(href));
    return id ? `${open}${baseUrl}/api/public/campaigns/c/{{click_token}}/${id}${close}` : whole;
  });
}

/** Create the campaign's link rows (idempotent) and return url to link id. */
export async function ensureCampaignLinks(workspaceId: string, campaignId: string, urls: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const url of urls) {
    const urlHash = sha256Hex(url);
    const row = await prisma.campaignLink.upsert({
      where: { campaignId_urlHash: { campaignId, urlHash } },
      create: { campaignId, workspaceId, url, urlHash },
      update: {},
      select: { id: true },
    });
    map.set(url, row.id);
  }
  return map;
}

export function pixelHtml(baseUrl: string): string {
  return `<img src="${baseUrl}/api/public/campaigns/o/{{open_token}}" width="1" height="1" alt="" style="display:none">`;
}
