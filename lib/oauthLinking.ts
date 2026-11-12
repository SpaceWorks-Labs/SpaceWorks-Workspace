/**
 * Linking policy for Google, GitHub and Apple sign-in. Pure: callers load the
 * facts (linked account, session, matching user) and this module decides.
 * The invite-only rule stays the default; self sign-up needs an instance flag.
 */
export type OAuthProvider = "google" | "github" | "apple";
export const OAUTH_PROVIDERS: readonly OAuthProvider[] = ["google", "github", "apple"];

export function isOAuthProvider(value: string | undefined | null): value is OAuthProvider {
  return value === "google" || value === "github" || value === "apple";
}

export type OAuthDenial =
  | "disabled" | "email_unverified" | "link_unverified" | "email_in_use" | "already_linked" | "provider_already_linked"
  | "mfa_pending" | "reauth_required" | "domain_not_allowed" | "not_invited";

export type OAuthDecision =
  | { allow: true; mode: "linked" | "link" | "auto_link" | "signup"; userId?: string; email?: string }
  | { allow: false; error: OAuthDenial };

export type OAuthFacts = {
  provider: OAuthProvider;
  /** Lowercased email the provider vouches for, or null. Never an unverified address. */
  verifiedEmail: string | null;
  /** Owner of the (provider, subject) account row, if one exists. */
  linkedUser: { id: string; disabled: boolean } | null;
  /** Fully signed-in user (MFA complete), if any. */
  sessionUserId: string | null;
  /** A user part-way through a second factor, if any. */
  pendingMfaUserId: string | null;
  recentAuth: boolean;
  /** The session user already has another account for this provider. */
  providerHeld: boolean;
  emailUser: { id: string; disabled: boolean; emailVerified: boolean } | null;
  selfSignup: { enabled: boolean; allowedDomains: readonly string[] };
};

const RELAY_DOMAIN = "privaterelay.appleid.com";

export function isRelayEmail(email: string | null | undefined) {
  return Boolean(email && email.trim().toLowerCase().endsWith(`@${RELAY_DOMAIN}`));
}

export function emailDomain(email: string) {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

export function parseAllowedDomains(raw: string | undefined | null) {
  return (raw ?? "").split(/[\s,;]+/).map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
}

export function decideOAuthSignIn(facts: OAuthFacts): OAuthDecision {
  const { linkedUser, sessionUserId, pendingMfaUserId } = facts;
  // A (provider, subject) already linked always wins over anything the email says.
  if (linkedUser) {
    if (linkedUser.disabled) return { allow: false, error: "disabled" };
    if (sessionUserId && sessionUserId !== linkedUser.id) return { allow: false, error: "already_linked" };
    if (pendingMfaUserId && pendingMfaUserId !== linkedUser.id) return { allow: false, error: "mfa_pending" };
    return { allow: true, mode: "linked", userId: linkedUser.id };
  }
  if (sessionUserId) {
    if (!facts.recentAuth) return { allow: false, error: "reauth_required" };
    if (facts.providerHeld) return { allow: false, error: "provider_already_linked" };
    return { allow: true, mode: "link", userId: sessionUserId };
  }
  // A half-finished second factor must never be used to attach another identity.
  if (pendingMfaUserId) return { allow: false, error: "mfa_pending" };
  const email = facts.verifiedEmail;
  if (!email) return { allow: false, error: "email_unverified" };
  const relay = isRelayEmail(email);
  if (facts.emailUser) {
    if (facts.emailUser.disabled) return { allow: false, error: "disabled" };
    if (relay) return { allow: false, error: "email_in_use" };
    if (!facts.emailUser.emailVerified) return { allow: false, error: "link_unverified" };
    return { allow: true, mode: "auto_link", userId: facts.emailUser.id, email };
  }
  if (!facts.selfSignup.enabled) return { allow: false, error: "not_invited" };
  const domains = facts.selfSignup.allowedDomains;
  if (domains.length > 0 && !domains.includes(emailDomain(email))) return { allow: false, error: "domain_not_allowed" };
  return { allow: true, mode: "signup", email };
}

function truthy(value: unknown) {
  return value === true || value === "true";
}

/** The verified email in a provider profile, or null. Apple sends booleans as strings sometimes. */
export function verifiedProfileEmail(profile: unknown): string | null {
  if (!profile || typeof profile !== "object") return null;
  const p = profile as { email?: unknown; email_verified?: unknown };
  if (!truthy(p.email_verified) || typeof p.email !== "string") return null;
  const email = p.email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null;
}

/** GitHub's /user/emails: only the primary address, and only if GitHub verified it. */
export function pickPrimaryVerifiedEmail(emails: unknown): string | null {
  if (!Array.isArray(emails)) return null;
  const hit = emails.find((e) => e && typeof e === "object" && (e as { primary?: unknown }).primary === true && (e as { verified?: unknown }).verified === true);
  const email = (hit as { email?: unknown } | undefined)?.email;
  return typeof email === "string" ? email.trim().toLowerCase() : null;
}

export const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  not_invited: "There's no account for that email. Ask an admin for an invitation.",
  disabled: "This account is disabled. Contact your workspace admin.",
  email_unverified: "That provider didn't share a verified email address. Verify it with the provider, or sign in another way.",
  link_unverified: "Confirm your email first. Check your inbox for the verification link, then try again.",
  email_in_use: "An account with that email already exists. Sign in with your password, then connect it from your account page.",
  already_linked: "That sign-in is already connected to a different account.",
  provider_already_linked: "You already have an account connected for that provider. Disconnect it first.",
  mfa_pending: "Finish two-step verification, or sign out, before using another sign-in.",
  reauth_required: "Sign in again to connect another sign-in method.",
  domain_not_allowed: "Sign-up isn't open to that email domain. Ask an admin for an invitation.",
  email_not_verified: "Confirm your email first. We can send the link again.",
};
