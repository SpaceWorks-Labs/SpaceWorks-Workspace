/**
 * README banners: SVG source (text converted to paths, mascot embedded) rendered to 2x PNG.
 * Fonts come from public/brand/fonts or the optional design-kit submodule; Patch from the
 * submodule when present (high resolution), otherwise from public/brand/mascot.
 */
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import sharp from "sharp";

const fontkit = createRequire(import.meta.url)("fontkit");
const root = path.resolve(import.meta.dirname, "..");
const W = 1280, H = 360, LEFT = 72;

const themes = {
  light: {
    file: "banner", bg: "#FFF4E8", ink: "#142C2A", accent: "#006E63", chipLine: "#142C2A",
    lockup: "lockup-horizontal.svg", disc: "#DFFF8F", dot: "#FF7447", mascot: "patch.png", quad: "#006E63",
  },
  dark: {
    file: "banner-dark", bg: "#000000", ink: "#FFF4E8", accent: "#DFFF8F", chipLine: "#FFF4E8",
    lockup: "lockup-horizontal-reversed.svg", disc: "#006E63", dot: "#FF7447", mascot: "dark/patch.png", quad: "#142C2A",
  },
};

const findFile = (name: string, dirs: string[]) => {
  const hit = dirs.map((dir) => path.join(root, dir, name)).find(existsSync);
  if (!hit) throw new Error(`Missing ${name}; looked in ${dirs.join(", ")}`);
  return hit;
};
// Gilroy ExtraBold comes from the brand fonts. Outfit and Unbounded are variable woff2 files that fontkit
// cannot instance, so scripts/assets holds static SemiBold (wght 600) instances made with fontTools
// varLib.instancer from the OFL Design-Kit fonts.
const fontFile = (name: string) => findFile(name, ["scripts/assets", "public/brand/fonts", "design-kit/fonts"]);

/** Lays out a string with fontkit and returns SVG path markup plus its advance width. */
function textPaths(value: string, fontName: string, size: number, x: number, baseline: number, fill: string) {
  const font = fontkit.openSync(fontFile(fontName));
  const run = font.layout(value), scale = size / font.unitsPerEm;
  let cursor = 0, markup = "";
  run.glyphs.forEach((glyph: { path: { toSVG(): string } }, i: number) => {
    const pos = run.positions[i];
    const d = glyph.path.toSVG();
    if (d) markup += `<path d="${d}" transform="translate(${(x + (cursor + pos.xOffset) * scale).toFixed(2)} ${(baseline - pos.yOffset * scale).toFixed(2)}) scale(${scale} ${-scale})"/>`;
    cursor += pos.xAdvance;
  });
  return { markup: `<g fill="${fill}">${markup}</g>`, width: cursor * scale };
}

const chips = ["Projects", "Chat", "Docs", "Finance", "Assistant + MCP"];

function chipRow(theme: typeof themes.light, y: number) {
  let x = LEFT, out = "";
  for (const label of chips) {
    const text = textPaths(label, "Outfit-SemiBold.ttf", 16, 0, 0, theme.ink);
    const w = Math.round(text.width + 32), h = 36;
    const t = textPaths(label, "Outfit-SemiBold.ttf", 16, x + 16, y + 23.5, theme.ink);
    out += `<rect x="${x + 0.75}" y="${y + 0.75}" width="${w - 1.5}" height="${h - 1.5}" rx="${h / 2 - 0.75}" fill="none" stroke="${theme.chipLine}" stroke-opacity="0.55" stroke-width="1.5"/>${t.markup}`;
    x += w + 10;
  }
  return out;
}

function mascotDataUri(theme: typeof themes.light) {
  const hi = path.join(root, "design-kit/mascot", theme.mascot);
  const lo = path.join(root, "public/brand/mascot", theme.mascot.replace(".png", ".webp"));
  return sharp(existsSync(hi) ? hi : lo)
    .resize(1000, 1000, { fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9, palette: true, quality: 92 })
    .toBuffer()
    .then((buf) => `data:image/png;base64,${buf.toString("base64")}`);
}

function lockup(theme: typeof themes.light) {
  // Official lockup, unmodified: scaled uniformly (360x58 -> 312x50.2), never recoloured or stretched.
  const svg = readFileSync(path.join(root, "public/brand/logo", theme.lockup), "utf8");
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/id="clip0_[^"]*"/g, 'id="lockup-clip"').replace(/url\(#clip0_[^)]*\)/g, "url(#lockup-clip)");
  const scale = 312 / 360;
  return `<g transform="translate(${LEFT} 52) scale(${scale.toFixed(5)})">${inner}</g>`;
}

export async function buildBanner(name: "light" | "dark") {
  const t = themes[name];
  const mascot = await mascotDataUri(t);
  const line1 = textPaths("The self-hosted workspace for", "Gilroy-ExtraBold.woff2", 42, LEFT, 168, t.ink);
  const line2 = textPaths("maker organisations", "Unbounded-SemiBold.ttf", 36, LEFT, 222, t.accent);
  // "Space Works" then "Workspace": a thin rule and the product name a clear space (¼ lockup height) after the lockup.
  const ruleX = LEFT + 312 + 14;
  const product = textPaths("Workspace", "Outfit-SemiBold.ttf", 30, ruleX + 15, 85, t.ink);
  const cx = 1060, cy = 180, r = 138;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Space Works Workspace. The self-hosted workspace for maker organisations.">
<title>Space Works Workspace</title>
<rect width="${W}" height="${H}" fill="${t.bg}"/>
<circle cx="${cx}" cy="${cy + 6}" r="${r + 30}" fill="${t.disc}"/>
<circle cx="${cx + 128}" cy="${cy - 118}" r="13" fill="${t.dot}"/>
<image x="${cx - r}" y="${cy - r + 6}" width="${r * 2}" height="${r * 2}" xlink:href="${mascot}" href="${mascot}"/>
${lockup(t)}
<rect x="${ruleX}" y="58" width="2" height="38" rx="1" fill="${t.ink}" opacity="0.35"/>
${product.markup}
${line1.markup}
${line2.markup}
${chipRow(t, 262)}
</svg>
`;
  const dir = path.join(root, "docs/readme");
  await writeFile(path.join(dir, `${t.file}.svg`), svg);
  await sharp(Buffer.from(svg), { density: 144 }).png({ compressionLevel: 9 }).toFile(path.join(dir, `${t.file}.png`));
}

export async function generateBanners() {
  await buildBanner("light");
  await buildBanner("dark");
}
