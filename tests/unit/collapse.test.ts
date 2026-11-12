import { describe, expect, it } from "vitest";
import { parseOpenMap, resolveOpen, withOpen } from "@/lib/collapse";

describe("collapse persistence helpers", () => {
  it("parses stored maps and ignores junk", () => {
    expect(parseOpenMap('{"a":true,"b":false,"c":"x"}')).toEqual({ a: true, b: false });
    expect(parseOpenMap("not json")).toEqual({});
    expect(parseOpenMap("[1]")).toEqual({});
    expect(parseOpenMap("")).toEqual({});
    expect(parseOpenMap(null)).toEqual({});
  });

  it("falls back to the default when nothing is stored", () => {
    expect(resolveOpen({}, "x", true)).toBe(true);
    expect(resolveOpen({}, "x", false)).toBe(false);
    expect(resolveOpen({ x: false }, "x", true)).toBe(false);
  });

  it("writes one choice without losing the others", () => {
    expect(parseOpenMap(withOpen({ a: true }, "b", false))).toEqual({ a: true, b: false });
  });
});
