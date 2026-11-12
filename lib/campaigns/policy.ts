/**
 * Pure campaign rules (client-safe): email and domain handling, list slugs,
 * and the thresholds that turn bounces into blocklisting.
 */

export const MAX_EMAIL_LENGTH = 254;
const EMAIL = /^[^\s@<>,;"()[\]\\]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  const email = normaliseEmail(value);
  return email.length <= MAX_EMAIL_LENGTH && email.indexOf("@") > 0 && email.indexOf("@") <= 64 && EMAIL.test(email);
}

export function emailDomain(email: string): string {
  return normaliseEmail(email).slice(normaliseEmail(email).lastIndexOf("@") + 1);
}

const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

/** Accepts `example.com`, `@example.com` or `*.example.com`; returns null when it is not a domain. */
export function normaliseDomainEntry(value: string): string | null {
  const domain = value.trim().toLowerCase().replace(/^[@*]+\.?/, "").replace(/\.$/, "");
  return DOMAIN.test(domain) ? domain : null;
}

/** Split free text (newlines, commas, spaces) into unique valid domains plus the entries that were rejected. */
export function parseDomainList(text: string): { domains: string[]; invalid: string[] } {
  const domains = new Set<string>();
  const invalid: string[] = [];
  for (const raw of text.split(/[\s,;]+/).filter(Boolean)) {
    const domain = normaliseDomainEntry(raw);
    if (domain) domains.add(domain); else invalid.push(raw.slice(0, 60));
  }
  return { domains: [...domains].slice(0, 500), invalid };
}

/** True when the address is on a blocked domain or any subdomain of one. */
export function isDomainBlocked(email: string, blocklist: readonly string[]): boolean {
  const domain = emailDomain(email);
  return blocklist.some((entry) => domain === entry || domain.endsWith(`.${entry}`));
}

export function slugifyListName(name: string): string {
  const slug = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return slug || "list";
}

export const BLOCKLIST_REASONS = ["UNSUBSCRIBE_ALL", "BOUNCE_HARD", "BOUNCE_SOFT_LIMIT", "COMPLAINT", "CONTACT_DNC", "ADMIN"] as const;
export type BlocklistReason = (typeof BLOCKLIST_REASONS)[number];

export const SOFT_BOUNCE_WINDOW_DAYS = 30;

/** SOFT bounces blocklist once `softBounceLimit` of them land inside the window. */
export function shouldBlocklistSoft(recentSoftBounces: number, softBounceLimit: number): boolean {
  return softBounceLimit > 0 && recentSoftBounces >= softBounceLimit;
}

/** Hard bounces and complaints blocklist immediately. */
export function blocklistReasonForBounce(kind: "SOFT" | "HARD" | "COMPLAINT", recentSoftBounces: number, softBounceLimit: number): BlocklistReason | null {
  if (kind === "HARD") return "BOUNCE_HARD";
  if (kind === "COMPLAINT") return "COMPLAINT";
  return shouldBlocklistSoft(recentSoftBounces, softBounceLimit) ? "BOUNCE_SOFT_LIMIT" : null;
}

/** Tracking a campaign can only narrow the workspace setting. */
export function narrowTracking(workspace: { trackOpens: boolean; trackClicks: boolean; individualTracking: boolean }, campaign: { trackOpens: boolean; trackClicks: boolean; individualTracking: boolean }) {
  const trackOpens = workspace.trackOpens && campaign.trackOpens;
  const trackClicks = workspace.trackClicks && campaign.trackClicks;
  return { trackOpens, trackClicks, individualTracking: workspace.individualTracking && campaign.individualTracking && (trackOpens || trackClicks) };
}

const ATTRIBUTE_KEY = /^[a-z0-9_]{1,40}$/;

/** Turn a header such as "Favourite Colour" into an attribute key, or null when nothing usable remains. */
export function attributeKey(header: string): string | null {
  const key = header.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return ATTRIBUTE_KEY.test(key) ? key : null;
}
