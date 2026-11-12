import { describe, expect, it } from "vitest";
import { areaOf, countLines, groupBy, isCountable, languageOf, summarize } from "../../scripts/loc.mjs";

describe("scripts/loc.mjs", () => {
  it("counts lines with and without a trailing newline", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("a\nb\n")).toBe(2);
    expect(countLines("a\nb")).toBe(2);
  });

  it("excludes lockfiles, the generated registry, binaries and the submodule", () => {
    expect(isCountable("package-lock.json")).toBe(false);
    expect(isCountable("packages/cli/package-lock.json")).toBe(false);
    expect(isCountable("lib/frontend/registry.ts")).toBe(false);
    expect(isCountable("design-kit/tokens.json")).toBe(false);
    expect(isCountable("public/brand/mascot/patch.webp")).toBe(false);
    expect(isCountable("lib/tasks/access.ts")).toBe(true);
  });

  it("maps files to languages and areas", () => {
    expect(languageOf("app/page.tsx")).toBe("TypeScript (TSX)");
    expect(languageOf("docker/Dockerfile")).toBe("Dockerfile");
    expect(languageOf("LICENSE")).toBe("Other");
    expect(areaOf("lib/tasks/access.ts")).toBe("lib");
    expect(areaOf("README.md")).toBe("(root)");
  });

  it("groups and sorts by lines", () => {
    const entries = [
      { file: "lib/a.ts", lines: 10 },
      { file: "lib/b.ts", lines: 5 },
      { file: "docs/c.md", lines: 30 },
    ];
    expect(groupBy(entries, areaOf)).toEqual([
      { name: "docs", files: 1, lines: 30 },
      { name: "lib", files: 2, lines: 15 },
    ]);
    expect(summarize(entries).totals).toEqual({ files: 3, lines: 45 });
  });
});
