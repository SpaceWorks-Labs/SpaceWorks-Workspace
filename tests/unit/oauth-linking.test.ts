import { describe, expect, it } from "vitest";
import { decideOAuthSignIn, isRelayEmail, parseAllowedDomains, pickPrimaryVerifiedEmail, verifiedProfileEmail, type OAuthFacts } from "@/lib/oauthLinking";

const base: OAuthFacts = {
  provider: "github",
  verifiedEmail: "ana@example.org",
  linkedUser: null,
  sessionUserId: null,
  pendingMfaUserId: null,
  recentAuth: true,
  providerHeld: false,
  emailUser: null,
  selfSignup: { enabled: false, allowedDomains: [] },
};
const decide = (over: Partial<OAuthFacts>) => decideOAuthSignIn({ ...base, ...over });
const member = { id: "u1", disabled: false, emailVerified: true };

describe("OAuth linking policy", () => {
  it("a linked (provider, subject) wins even when the email no longer matches or is unverified", () => {
    expect(decide({ linkedUser: { id: "u1", disabled: false }, verifiedEmail: null })).toEqual({ allow: true, mode: "linked", userId: "u1" });
    expect(decide({ linkedUser: { id: "u1", disabled: true } })).toEqual({ allow: false, error: "disabled" });
  });
  it("never attaches a linked identity to a different signed-in or half-signed-in user", () => {
    expect(decide({ linkedUser: { id: "u1", disabled: false }, sessionUserId: "u2" })).toEqual({ allow: false, error: "already_linked" });
    expect(decide({ linkedUser: { id: "u1", disabled: false }, pendingMfaUserId: "u2" })).toEqual({ allow: false, error: "mfa_pending" });
    expect(decide({ linkedUser: { id: "u1", disabled: false }, pendingMfaUserId: "u1" }).allow).toBe(true);
  });
  it("links to the signed-in user only with a recent sign-in and one account per provider", () => {
    expect(decide({ sessionUserId: "u1" })).toEqual({ allow: true, mode: "link", userId: "u1" });
    expect(decide({ sessionUserId: "u1", recentAuth: false })).toEqual({ allow: false, error: "reauth_required" });
    expect(decide({ sessionUserId: "u1", providerHeld: true })).toEqual({ allow: false, error: "provider_already_linked" });
  });
  it("does not let a pending second factor attach a new identity", () => {
    expect(decide({ pendingMfaUserId: "u1", emailUser: member })).toEqual({ allow: false, error: "mfa_pending" });
  });
  it("auto-links only a verified provider email to a user whose email is verified", () => {
    expect(decide({ emailUser: member })).toEqual({ allow: true, mode: "auto_link", userId: "u1", email: "ana@example.org" });
    expect(decide({ emailUser: { ...member, emailVerified: false } })).toEqual({ allow: false, error: "link_unverified" });
    expect(decide({ emailUser: { ...member, disabled: true } })).toEqual({ allow: false, error: "disabled" });
    expect(decide({ verifiedEmail: null, emailUser: member })).toEqual({ allow: false, error: "email_unverified" });
  });
  it("never auto-links an Apple relay address", () => {
    expect(isRelayEmail("x1y2@privaterelay.appleid.com")).toBe(true);
    expect(decide({ provider: "apple", verifiedEmail: "x1y2@privaterelay.appleid.com", emailUser: member })).toEqual({ allow: false, error: "email_in_use" });
  });
  it("stays invite-only unless self sign-up is on, and then honours the domain list", () => {
    expect(decide({})).toEqual({ allow: false, error: "not_invited" });
    expect(decide({ selfSignup: { enabled: true, allowedDomains: [] } })).toEqual({ allow: true, mode: "signup", email: "ana@example.org" });
    expect(decide({ selfSignup: { enabled: true, allowedDomains: ["example.org"] } }).allow).toBe(true);
    expect(decide({ selfSignup: { enabled: true, allowedDomains: ["other.org"] } })).toEqual({ allow: false, error: "domain_not_allowed" });
    expect(decide({ verifiedEmail: null, selfSignup: { enabled: true, allowedDomains: [] } })).toEqual({ allow: false, error: "email_unverified" });
  });
});

describe("provider email helpers", () => {
  it("accepts only a verified, well-formed profile email (Apple sends booleans as strings)", () => {
    expect(verifiedProfileEmail({ email: "Ana@Example.org", email_verified: true })).toBe("ana@example.org");
    expect(verifiedProfileEmail({ email: "ana@example.org", email_verified: "true" })).toBe("ana@example.org");
    expect(verifiedProfileEmail({ email: "ana@example.org", email_verified: "false" })).toBeNull();
    expect(verifiedProfileEmail({ email: "ana@example.org" })).toBeNull();
    expect(verifiedProfileEmail({ email: "not-an-email", email_verified: true })).toBeNull();
    expect(verifiedProfileEmail(null)).toBeNull();
  });
  it("takes only GitHub's primary verified email, never the first listed", () => {
    expect(pickPrimaryVerifiedEmail([{ email: "first@x.org", primary: false, verified: true }, { email: "Main@x.org", primary: true, verified: true }])).toBe("main@x.org");
    expect(pickPrimaryVerifiedEmail([{ email: "main@x.org", primary: true, verified: false }, { email: "alt@x.org", primary: false, verified: true }])).toBeNull();
    expect(pickPrimaryVerifiedEmail({ message: "Bad credentials" })).toBeNull();
  });
  it("parses the allowed-domain list", () => {
    expect(parseAllowedDomains(" Example.org, @other.com ;third.io\nfourth.io")).toEqual(["example.org", "other.com", "third.io", "fourth.io"]);
    expect(parseAllowedDomains(undefined)).toEqual([]);
  });
});
