import { describe, expect, it } from "vitest";
import { checkUsername, parseIdentifier } from "@/lib/username";
import { usernameSchema } from "@/lib/validation";

describe("usernames", () => {
  it("lowercases and accepts the documented shape", () => {
    expect(checkUsername("  Maker.Space_01 ")).toEqual({ ok: true, username: "maker.space_01" });
    expect(checkUsername("ab").ok).toBe(false); // 3 characters minimum
    expect(checkUsername("abc").ok).toBe(true);
    expect(checkUsername("a".repeat(30)).ok).toBe(true);
    expect(checkUsername("a".repeat(31)).ok).toBe(false);
  });
  it("rejects a leading symbol, @, spaces and reserved words", () => {
    for (const bad of ["_maker", ".maker", "-maker", "ma ker", "maker@example.org", "ünïcode", "admin", "Root", "support"]) {
      expect(checkUsername(bad).ok, bad).toBe(false);
    }
  });
  it("the zod schema normalises and reports a sentence", () => {
    expect(usernameSchema.parse("  Fabber ")).toBe("fabber");
    const bad = usernameSchema.safeParse("admin");
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]!.message).toMatch(/reserved/);
  });
  it("treats anything with @ as an email", () => {
    expect(parseIdentifier(" Ana@Example.org ")).toEqual({ kind: "email", value: "ana@example.org" });
    expect(parseIdentifier("Ana.Maker")).toEqual({ kind: "username", value: "ana.maker" });
  });
});
