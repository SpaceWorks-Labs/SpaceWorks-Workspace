/** Deterministic README artwork, banners come from readme-banner.ts, swatches are plain SVG. */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateBanners } from "./readme-banner.ts";
const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "docs/readme");
const brand = { "deep-ink": "#142C2A", "warm-cream": "#FFF4E8", "maker-teal": "#006E63", "workshop-orange": "#FF7447", citron: "#DFFF8F", "sky-blue": "#B5CDFF", "warm-yellow": "#FFD447" };
await mkdir(out, { recursive: true });
await generateBanners();
for(const [name,hex] of Object.entries(brand)) await writeFile(path.join(out,`swatch-${name}.svg`),`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="24"><rect x=".5" y=".5" width="47" height="23" rx="6" fill="${hex}" stroke="#7F8C89"/></svg>\n`);
console.log("Generated light/dark banners (SVG + 2x PNG) and seven brand swatches.");
