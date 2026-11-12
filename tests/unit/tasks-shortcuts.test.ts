import { describe, expect, it } from "vitest";
import { DENSITY_KEY, parseDensity } from "@/lib/tasks/density";
import { INLINE_IMAGE_SRC, isInlineImageSrc } from "@/lib/tasks/inlineImages";
import { nextFocusIndex, shortcutFor } from "@/lib/tasks/shortcuts";

const press = (key: string, extra: Partial<Parameters<typeof shortcutFor>[0]> = {}) => ({ key, metaKey: false, ctrlKey: false, altKey: false, target: null, ...extra });

describe("board shortcuts", () => {
  it("maps / j k to actions", () => {
    expect(shortcutFor(press("/"), false)).toBe("search");
    expect(shortcutFor(press("j"), false)).toBe("next");
    expect(shortcutFor(press("k"), false)).toBe("prev");
    expect(shortcutFor(press("x"), false)).toBeNull();
  });
  it("ignores typing in fields and editors", () => {
    for (const target of [{ tagName: "INPUT" }, { tagName: "TEXTAREA" }, { tagName: "SELECT" }, { tagName: "DIV", isContentEditable: true }]) {
      expect(shortcutFor(press("j", { target: target as unknown as EventTarget }), false)).toBeNull();
    }
    expect(shortcutFor(press("j", { target: { tagName: "BUTTON" } as unknown as EventTarget }), false)).toBe("next");
  });
  it("ignores modified keys, handled events and open menus or dialogs", () => {
    expect(shortcutFor(press("j", { metaKey: true }), false)).toBeNull();
    expect(shortcutFor(press("j", { ctrlKey: true }), false)).toBeNull();
    expect(shortcutFor(press("/", { altKey: true }), false)).toBeNull();
    expect(shortcutFor(press("j", { defaultPrevented: true }), false)).toBeNull();
    expect(shortcutFor(press("j"), true)).toBeNull();
  });
  it("moves card focus without leaving the board", () => {
    expect(nextFocusIndex(-1, 5, "next")).toBe(0);
    expect(nextFocusIndex(-1, 5, "prev")).toBe(4);
    expect(nextFocusIndex(2, 5, "next")).toBe(3);
    expect(nextFocusIndex(4, 5, "next")).toBe(4);
    expect(nextFocusIndex(0, 5, "prev")).toBe(0);
    expect(nextFocusIndex(0, 0, "next")).toBe(-1);
  });
});

describe("card density", () => {
  it("defaults to comfortable for anything but 'compact'", () => {
    expect(parseDensity("compact")).toBe("compact");
    expect(parseDensity("comfortable")).toBe("comfortable");
    expect(parseDensity("weird")).toBe("comfortable");
    expect(parseDensity(null)).toBe("comfortable");
    expect(DENSITY_KEY).toMatch(/^sww\.tasks\./);
  });
});

describe("description image sources", () => {
  it("accepts only our authenticated file route", () => {
    expect(isInlineImageSrc("/api/files/cm1abcDEF_-9")).toBe(true);
    for (const bad of ["https://evil.test/a.png", "//evil.test/a.png", "/api/files/abc?download=1", "/api/files/../x", "/api/files/", "data:image/png;base64,AAAA", "javascript:alert(1)", "/other/abc", ""]) {
      expect(isInlineImageSrc(bad), bad).toBe(false);
    }
    expect(isInlineImageSrc(undefined)).toBe(false);
    expect(INLINE_IMAGE_SRC.test("/api/files/abc\n")).toBe(false);
  });
});
