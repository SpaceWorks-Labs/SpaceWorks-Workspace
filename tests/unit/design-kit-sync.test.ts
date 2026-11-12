import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateFixture, generateMotion, generatePalette, kitVersion } from "../../scripts/sync-design-tokens.mjs";
import { generateBoxOpenCss, generateBoxOpenMarkup, generateThemeRevealCss } from "../../scripts/sync-design-motion.mjs";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const kitTokens = path.join(process.cwd(), "design-kit/tokens/tokens.json");
// Builds and CI never need the submodule; this guard only runs when it is checked out.
const guard = existsSync(kitTokens) ? describe : describe.skip;

guard("Design System sync (skipped: design-kit submodule not checked out; run git submodule update --init design-kit)", () => {
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
  it("committed box-open loader CSS and artwork match the kit", () => {
    expect(read("app/styles/box-open.css")).toBe(generateBoxOpenCss(read("design-kit/motion/box-open/box-open.css"), tokens(), version()));
    expect(read("components/brand/boxOpenMarkup.ts")).toBe(generateBoxOpenMarkup(read("design-kit/motion/box-open/box-open-markup.html"), tokens(), version()));
  });
  it("committed theme reveal CSS matches the kit", () => {
    expect(read("app/styles/theme-reveal.css")).toBe(generateThemeRevealCss(read("design-kit/motion/theme-reveal/theme-reveal.css"), version()));
  });
});

describe("sync generator", () => {
  const palette = read("app/styles/palette.css");
  it("emits scrim and the shadow colour from it in both dark blocks", () => {
    expect(palette.match(/--sw-color-scrim: 0 0 0;/g)).toHaveLength(2);
    expect(palette.match(/--sw-shadow-color: 0 0 0;/g)).toHaveLength(2);
  });
  it("emits the chart series and loader colours in light, dark and the OS fallback", () => {
    for (const name of ["chart-accent", "chart-info", "chart-success", "chart-warn", "chart-danger", "loader-under", "loader-spark", "loader-seam"]) {
      expect(palette.match(new RegExp(`--sw-${name}: \\d+ \\d+ \\d+;`, "g")), name).toHaveLength(3);
    }
  });
  it("maps the loader theme onto the app's dark scopes and keeps the artwork hex-free", () => {
    const css = read("app/styles/box-open.css");
    expect(css).not.toContain("html.dark");
    expect(css).not.toContain(".sw-box.once");
    for (const scope of [':root[data-color-mode="dark"] .sw-box .dk', ".yy-dark-band .sw-box .dk", ":root:not([data-color-mode]) .sw-box .dk"]) expect(css).toContain(scope);
    expect(css).toContain("--sw-under:rgb(var(--sw-loader-under))");
    const markup = read("components/brand/boxOpenMarkup.ts");
    expect(markup).not.toMatch(/#[\da-f]{3,6}\b|fill="/i);
    expect(markup).toContain("fill:var(--sw-orange);--c:var(--sw-orange)");
  });
  it("rejects kit artwork that uses a colour outside the brand", () => {
    const tokens = { brand: { "maker-teal": "#006E63" } };
    expect(() => generateBoxOpenMarkup('<svg class="lt"><path fill="#123456"/></svg><svg class="dk"></svg>', tokens, "x")).toThrow(/not a brand colour/);
  });
});
