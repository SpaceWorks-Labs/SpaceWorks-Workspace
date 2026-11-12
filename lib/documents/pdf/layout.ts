import "server-only";
import { currencyMinorDigits } from "@/lib/format/money";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, type PDFPage } from "pdf-lib";
import { DocumentsError } from "../access";
import { label } from "../rules";
import type { DocumentSnapshot } from "../service";

export type DocumentAsset = (id: string) => Promise<{ body: Uint8Array } | null>;

/** A4, Gilroy, Deep Ink/Maker Teal/Warm Cream from the Space Works brand. */
export async function createDocumentLayout(s: DocumentSnapshot) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(
    await readFile(
      path.join(process.cwd(), "public/brand/fonts/Gilroy-Light.woff2"),
    ),
    { subset: true, features: { liga: false } },
  );
  const bold = await pdf.embedFont(
    await readFile(
      path.join(process.cwd(), "public/brand/fonts/Gilroy-ExtraBold.woff2"),
    ),
    { subset: true, features: { liga: false } },
  );
  const ink = rgb(20 / 255, 44 / 255, 42 / 255),
    teal = rgb(0, 110 / 255, 99 / 255),
    cream = rgb(1, 244 / 255, 232 / 255),
    line = rgb(0.78, 0.83, 0.81);
  const chars = new Set(font.getCharacterSet());
  const clean = (s: string) => {
    const text = s.replace(/[\u00a0\t\r]/g, " ");
    if ([...text].some((c) => !chars.has(c.codePointAt(0)!)))
      throw new DocumentsError(
        "The PDF font cannot render part of this text. Use supported wording or retain an externally prepared copy as a source file.",
      );
    return text;
  };
  let page: PDFPage,
    y = 0;
  const v = s.input;
  const money = (n: number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: v.currency,
      currencyDisplay: "code",
    })
      .format(n / 10 ** currencyMinorDigits(v.currency))
      .replaceAll("\u00a0", " ");
  const next = () => {
    page = pdf.addPage([595.28, 841.89]);
    page.drawRectangle({
      x: 0,
      y: 748,
      width: 595.28,
      height: 94,
      color: cream,
    });
    page.drawText("Space Works Workspace", {
      x: 40,
      y: 810,
      font: bold,
      size: 10,
      color: teal,
    });
    page.drawText(
      clean(
        ["CREDIT_NOTE", "DEBIT_NOTE"].includes(v.type) && !v.gstAdjustment
          ? `Commercial ${label(v.type).toLowerCase()}`
          : label(v.type),
      ),
      {
        x: 40,
        y: 781,
        font: bold,
        size: 19,
        color: ink,
      },
    );
    page.drawText(clean(`${s.number} | ${v.issuedOn}`), {
      x: 40,
      y: 759,
      font,
      size: 10,
      color: ink,
    });
    y = 720;
  };
  const ensure = (height = 22) => {
    if (y - height < 65) next();
  };
  const paragraph = (text: string, strong = false, size = 10) => {
    for (const p of text.split("\n")) {
      let current = "";
      const f = strong ? bold : font;
      for (const word of clean(p).split(/\s+/)) {
        const candidate = current ? current + " " + word : word;
        if (f.widthOfTextAtSize(candidate, size) > 510 && current) {
          ensure(size + 8);
          page.drawText(current, { x: 40, y, font: f, size, color: ink });
          y -= size + 6;
          current = word;
        } else current = candidate;
        while (f.widthOfTextAtSize(current, size) > 510) {
          let n = current.length - 1;
          while (n > 1 && f.widthOfTextAtSize(current.slice(0, n), size) > 510)
            n--;
          ensure(size + 8);
          page.drawText(current.slice(0, n), {
            x: 40,
            y,
            font: f,
            size,
            color: ink,
          });
          y -= size + 6;
          current = current.slice(n);
        }
      }
      if (current) {
        ensure(size + 8);
        page.drawText(current, { x: 40, y, font: f, size, color: ink });
        y -= size + 6;
      }
    }
    y -= 5;
  };
  const section = (name: string) => {
    ensure(50);
    y -= 8;
    paragraph(name, true, 12);
  };
  next();
  return {
    pdf,
    font,
    ink,
    line,
    clean,
    money,
    ensure,
    paragraph,
    section,
    get page() {
      return page;
    },
    get y() {
      return y;
    },
    set y(value: number) {
      y = value;
    },
  };
}

export type DocumentLayout = Awaited<ReturnType<typeof createDocumentLayout>>;
