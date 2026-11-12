import { describe, expect, it } from "vitest";
import { consentGatedAllowed, parseConsentCookie, parseConsentMode, privacySignalActive } from "@/lib/observability/consent";
import { isAnalyticsRouteAllowed, workspaceSlugFromPath } from "@/lib/observability/routes";

describe("consent and privacy signals", () => {
  it("parses the cookie and defaults to opt-in", () => {
    expect(parseConsentCookie("analytics:1")).toBe("granted");
    expect(parseConsentCookie("analytics:0")).toBe("denied");
    expect(parseConsentCookie("junk")).toBe("unset");
    expect(parseConsentMode("bogus")).toBe("opt-in");
    expect(parseConsentMode("none")).toBe("none");
  });

  it("honours DNT and GPC", () => {
    expect(privacySignalActive({ doNotTrack: "1" })).toBe(true);
    expect(privacySignalActive({ doNotTrack: "0", globalPrivacyControl: true })).toBe(true);
    expect(privacySignalActive({}, { doNotTrack: "yes" })).toBe(true);
    expect(privacySignalActive({ doNotTrack: null })).toBe(false);
  });

  it("gates by mode, consent, signal and route", () => {
    const base = { privacySignal: false, routeAllowed: true };
    expect(consentGatedAllowed({ ...base, mode: "opt-in", consent: "unset" })).toBe(false);
    expect(consentGatedAllowed({ ...base, mode: "opt-in", consent: "granted" })).toBe(true);
    expect(consentGatedAllowed({ ...base, mode: "opt-out", consent: "unset" })).toBe(true);
    expect(consentGatedAllowed({ ...base, mode: "opt-out", consent: "denied" })).toBe(false);
    expect(consentGatedAllowed({ ...base, mode: "none", consent: "denied" })).toBe(true);
    expect(consentGatedAllowed({ ...base, mode: "none", consent: "granted", privacySignal: true })).toBe(false);
    expect(consentGatedAllowed({ ...base, mode: "none", consent: "granted", routeAllowed: false })).toBe(false);
  });
});

describe("route allow-list and deny-list", () => {
  it.each(["/w/acme", "/w/acme/projects/ck1", "/w/acme/t/12", "/w/acme/calendar"])("allows %s", (path) => expect(isAnalyticsRouteAllowed(path)).toBe(true));
  it.each([
    "/w/acme/vault", "/w/acme/secrets/x", "/w/acme/finance", "/w/acme/chat/c1", "/w/acme/dm/u1", "/w/acme/money-controls", "/w/acme/safeguarding",
    "/w/acme/hiring", "/w/acme/funding", "/w/acme/payroll", "/w/acme/settings/analytics", "/admin", "/admin/observability", "/login", "/account", "/w/acme/unknown-area",
  ])("blocks %s", (path) => expect(isAnalyticsRouteAllowed(path)).toBe(false));
  it("extracts the slug", () => {
    expect(workspaceSlugFromPath("/w/acme/projects")).toBe("acme");
    expect(workspaceSlugFromPath("/account")).toBeNull();
  });
});
