import { describe, expect, it } from "vitest";
import { hashEmailVerificationToken, isPlausibleVerificationToken } from "@/lib/emailVerificationToken";
import { hashPasswordResetToken } from "@/lib/passwordResetToken";
import { randomToken } from "@/lib/crypto";

describe("email verification tokens", () => {
  it("hashes deterministically, never to the raw token, and apart from reset tokens", () => {
    const token = randomToken(32);
    expect(hashEmailVerificationToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashEmailVerificationToken(token)).toBe(hashEmailVerificationToken(token));
    expect(hashEmailVerificationToken(token)).not.toBe(token);
    expect(hashEmailVerificationToken(token)).not.toBe(hashPasswordResetToken(token));
  });
  it("only accepts the 43-character URL-safe shape", () => {
    expect(isPlausibleVerificationToken(randomToken(32))).toBe(true);
    for (const bad of ["", "short", "a".repeat(44), `${"a".repeat(42)}!`, undefined, 7]) expect(isPlausibleVerificationToken(bad)).toBe(false);
  });
});
