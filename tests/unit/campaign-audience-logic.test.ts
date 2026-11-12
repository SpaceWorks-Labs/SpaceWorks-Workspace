import { describe, expect, it } from "vitest";
import { csvCell, neutraliseCell, parseCsvText, toCsv } from "@/lib/csv";
import { MAX_IMPORT_ROWS, parseSubscriberCsv } from "@/lib/campaigns/importCsv";
import { attributeKey, blocklistReasonForBounce, isDomainBlocked, isValidEmail, narrowTracking, parseDomainList, shouldBlocklistSoft, slugifyListName } from "@/lib/campaigns/policy";
import { buildConsent } from "@/lib/campaigns/subscriptions";
import { checkFormToken, issueFormToken } from "@/lib/campaigns/public/formToken";

describe("csv helpers", () => {
  it("neutralises formulas but not plain numbers", () => {
    expect(neutraliseCell("=1+1")).toBe("'=1+1");
    expect(neutraliseCell("-5")).toBe("-5");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(toCsv([["a,b", 'q"q']])).toBe('"a,b","q""q"\r\n');
  });
  it("parses quotes, CRLF and BOM, and rejects an open quote", () => {
    expect(parseCsvText('﻿a,b\r\n"x,1","y""z"\r\n')).toEqual({ ok: true, rows: [["a", "b"], ["x,1", 'y"z']] });
    expect(parseCsvText('a\n"open').ok).toBe(false);
  });
});

describe("subscriber csv validation", () => {
  it("reports per-row problems, dedupes, and keeps extra columns as attributes", () => {
    const r = parseSubscriberCsv("Email,Name,Favourite Colour\nA@x.org,Ann,red\nbad,Bob,\na@x.org,Dup,\nb@spam.test,Cy,\n,Empty,\n", ["spam.test"]);
    if (!r.ok) throw new Error(r.error);
    expect(r.rows).toEqual([{ line: 2, email: "a@x.org", name: "Ann", attributes: { favourite_colour: "red" } }]);
    expect(r.problems.map((p) => p.line)).toEqual([3, 4, 5, 6]);
  });
  it("needs an email column and caps rows and size", () => {
    expect(parseSubscriberCsv("name\nx").ok).toBe(false);
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `u${i}@x.org`).join("\n");
    expect(parseSubscriberCsv(`email\n${rows}`)).toMatchObject({ ok: false });
    expect(parseSubscriberCsv(`email\n${"a".repeat(2 * 1024 * 1024 + 1)}`)).toMatchObject({ ok: false });
  });
});

describe("policy", () => {
  it("validates emails and domain blocklists including subdomains", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("a b@c.co")).toBe(false);
    expect(isDomainBlocked("x@mail.spam.test", ["spam.test"])).toBe(true);
    expect(isDomainBlocked("x@notspam.test", ["spam.test"])).toBe(false);
    expect(parseDomainList("@A.com, *.b.org nonsense")).toEqual({ domains: ["a.com", "b.org"], invalid: ["nonsense"] });
  });
  it("applies the bounce thresholds", () => {
    expect(blocklistReasonForBounce("HARD", 0, 3)).toBe("BOUNCE_HARD");
    expect(blocklistReasonForBounce("COMPLAINT", 0, 3)).toBe("COMPLAINT");
    expect(shouldBlocklistSoft(2, 3)).toBe(false);
    expect(blocklistReasonForBounce("SOFT", 3, 3)).toBe("BOUNCE_SOFT_LIMIT");
  });
  it("narrows tracking and builds keys", () => {
    expect(narrowTracking({ trackOpens: true, trackClicks: false, individualTracking: true }, { trackOpens: true, trackClicks: true, individualTracking: true })).toEqual({ trackOpens: true, trackClicks: false, individualTracking: true });
    expect(narrowTracking({ trackOpens: false, trackClicks: false, individualTracking: true }, { trackOpens: true, trackClicks: true, individualTracking: true }).individualTracking).toBe(false);
    expect(slugifyListName("Café News!")).toBe("cafe-news");
    expect(attributeKey("Favourite Colour")).toBe("favourite_colour");
  });
});

describe("consent and form token", () => {
  it("stores IP and user agent only when the workspace opted in", () => {
    const input = { source: "FORM" as const, text: "t", ip: "1.2.3.4", userAgent: "ua" };
    expect(buildConsent(input, false)).toMatchObject({ consentSource: "FORM", consentIp: null, consentUserAgent: null });
    expect(buildConsent(input, true)).toMatchObject({ consentIp: "1.2.3.4", consentUserAgent: "ua" });
  });
  it("rejects too-fast, expired, forged and cross-list tokens", () => {
    const t = issueFormToken("w1", "l1", 1_000_000);
    expect(checkFormToken(t, "w1", "l1", 1_001_000)).toBe("too_fast");
    expect(checkFormToken(t, "w1", "l1", 1_010_000)).toBe("ok");
    expect(checkFormToken(t, "w1", "l1", 1_000_000 + 3_700_000)).toBe("expired");
    expect(checkFormToken(t, "w1", "l2", 1_010_000)).toBe("invalid");
    expect(checkFormToken(t.slice(0, 20) + (t[20] === "A" ? "B" : "A") + t.slice(21), "w1", "l1", 1_010_000)).toBe("invalid");
    expect(checkFormToken(undefined, "w1", "l1")).toBe("invalid");
  });
});
