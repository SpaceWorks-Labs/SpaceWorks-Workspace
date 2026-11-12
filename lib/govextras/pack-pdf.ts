import "server-only";
import { PDFDocument, rgb, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
export async function packPdf(
  title: string,
  subtitle: string,
  sections: Array<{ title: string; body: string }>,
) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(
    await readFile(
      path.join(process.cwd(), "public/brand/fonts/Gilroy-Light.woff2"),
    ),
    { subset: true, features: { liga: false } },
  );
  const strong = await pdf.embedFont(
    await readFile(
      path.join(process.cwd(), "public/brand/fonts/Gilroy-ExtraBold.woff2"),
    ),
    { subset: true, features: { liga: false } },
  );
  const chars = new Set(font.getCharacterSet());
  const clean = (s: string) =>
    [...s]
      .map((c) =>
        c === "\n" || c === "\r" || chars.has(c.codePointAt(0)!) ? c : "?",
      )
      .join("");
  const ink = rgb(20 / 255, 44 / 255, 42 / 255),
    teal = rgb(0, 110 / 255, 99 / 255);
  let page: PDFPage,
    y = 0;
  const next = () => {
    page = pdf.addPage([595.28, 841.89]);
    page.drawText("Space Works | Private board pack", {
      x: 44,
      y: 797,
      font: strong,
      size: 13,
      color: teal,
    });
    y = 765;
  };
  const write = (s: string, bold = false) => {
    const f = bold ? strong : font,
      size = bold ? 14 : 10;
    for (const para of clean(s).split(/\r?\n/)) {
      let line = "";
      const emit = () => {
        if (y < 64) next();
        page.drawText(line, { x: 44, y, font: f, size, color: ink });
        y -= bold ? 23 : 16;
        line = "";
      };
      for (const char of para) {
        if (f.widthOfTextAtSize(line + char, size) > 507) emit();
        line += char;
      }
      emit();
    }
    y -= 8;
  };
  next();
  write(title, true);
  write(subtitle);
  for (const s of sections) {
    if (y < 130) next();
    write(s.title, true);
    write(s.body);
  }
  pdf
    .getPages()
    .forEach((p, i) =>
      p.drawText(
        `${i + 1} / ${pdf.getPageCount()} | Frozen snapshot - retain with the bundle`,
        { x: 44, y: 35, font, size: 9, color: ink },
      ),
    );
  pdf.setTitle(title);
  pdf.setProducer("Space Works Workspace");
  return Buffer.from(await pdf.save());
}
