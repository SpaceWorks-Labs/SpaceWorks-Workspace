import { describe, expect, it } from "vitest";
import { pseudonymize, pseudonymizeUser, pseudonymizeUserInWorkspace, pseudonymizeWorkspace, signObsToken, verifyObsToken } from "@/lib/observability/identity";

describe("pseudonymous identity", () => {
  it("is stable, opaque and separated by kind", () => {
    expect(pseudonymizeUser("user-1")).toBe(pseudonymizeUser("user-1"));
    expect(pseudonymizeUser("user-1")).toMatch(/^[0-9a-f]{32}$/);
    expect(pseudonymizeUser("user-1")).not.toContain("user-1");
    expect(pseudonymizeUser("user-1")).not.toBe(pseudonymizeUser("user-2"));
    expect(pseudonymize("user", "x")).not.toBe(pseudonymize("workspace", "x"));
    expect(pseudonymizeWorkspace("w1")).not.toBe(pseudonymizeUser("w1"));
  });

  it("gives a user a different id in each workspace project", () => {
    expect(pseudonymizeUserInWorkspace("u1", "w1")).not.toBe(pseudonymizeUserInWorkspace("u1", "w2"));
    expect(pseudonymizeUserInWorkspace("u1", "w1")).not.toBe(pseudonymizeUser("u1"));
  });
});

describe("signed workspace token", () => {
  it("verifies, expires and rejects tampering", () => {
    const now = Date.now();
    const token = signObsToken({ w: "w1", u: "u1" }, 60, now);
    expect(verifyObsToken(token, now + 1000)).toMatchObject({ w: "w1", u: "u1" });
    expect(verifyObsToken(token, now + 120_000)).toBeNull();
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ w: "w2", u: "u1", exp: 9_999_999_999 })).toString("base64url");
    expect(verifyObsToken(`${forged}.${sig}`, now)).toBeNull();
    expect(verifyObsToken(`${body}.bad`, now)).toBeNull();
    expect(verifyObsToken(null)).toBeNull();
  });
});
