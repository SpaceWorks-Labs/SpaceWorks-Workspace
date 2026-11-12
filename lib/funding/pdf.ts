import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
/** Shared brand font, conservative margins and automatic pagination for saved receipts/reports. */
export async function createFundingPdf(title: string, paragraphs: string[]) {
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await readFile(path.join(process.cwd(), "public/brand/fonts/Gilroy-Light.woff2")), { subset: true });
  doc.setTitle(title); doc.setCreator("Space Works Workspace");
  let page = doc.addPage([595.28, 841.89]); let y = 790;
  const ink = rgb(20 / 255, 44 / 255, 42 / 255); const teal = rgb(0, 110 / 255, 99 / 255);
  const line = (text: string, size: number) => { if (y < 60) { page = doc.addPage([595.28, 841.89]); y = 790; } page.drawText(text, { x: 48, y, size, font, color: size > 14 ? teal : ink }); y -= size * 1.6; };
  for (const [index, paragraph] of [title, ...paragraphs].entries()) {
    const size = index === 0 ? 20 : 11;
    for (const part of paragraph.split(/\r?\n/)) {
      let current = "";
      for (const word of part.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").split(/\s+/)) {
        const next = current ? `${current} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) > 499 && current) { line(current, size); current = ""; }
        // Long unbroken identifiers also stay inside the printable area.
        for (const char of (current ? ` ${word}` : word)) { if (font.widthOfTextAtSize(current + char, size) > 499 && current) { line(current, size); current = ""; } current += char; }
      }
      if (current) line(current, size);
    }
    y -= 10;
  }
  const pages = doc.getPages();
  pages.forEach((p, index) => p.drawText(`Space Works Workspace · ${index + 1} / ${pages.length}`, { x: 48, y: 28, size: 9, font, color: ink }));
  return Buffer.from(await doc.save());
}
