import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateFixture, generateMotion, generatePalette, kitVersion } from "../../scripts/sync-design-tokens.mjs";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const kitTokens = path.join(process.cwd(), "design-kit/tokens/tokens.json");
// Builds and CI never need the submodule; this guard only runs when it is checked out.
const guard = existsSync(kitTokens) ? describe : describe.skip;

guard("Design-Kit sync (skipped: design-kit submodule not checked out; run git submodule update --init design-kit)", () => {
  const tokens = () => JSON.parse(read("design-kit/tokens/tokens.json"));
  const version = () => kitVersion(read("design-kit/README.md"));
  it("committed palette.css matches the kit", () => {
    expect(read("app/styles/palette.css")).toBe(generatePalette(tokens(), version()));
  });
  it("committed motion.css matches the kit", () => {
    expect(read("app/styles/motion.css")).toBe(generateMotion(tokens(), version()));
  });
  it("committed token fixture matches the kit", () => {
    expect(read("tests/fixtures/design-tokens.json")).toBe(generateFixture(tokens()));
  });
});

describe("sync generator", () => {
  it("emits scrim and the shadow colour from it in both dark blocks", () => {
    const palette = read("app/styles/palette.css");
    expect(palette.match(/--sw-color-scrim: 0 0 0;/g)).toHaveLength(2);
    expect(palette.match(/--sw-shadow-color: 0 0 0;/g)).toHaveLength(2);
  });
});
