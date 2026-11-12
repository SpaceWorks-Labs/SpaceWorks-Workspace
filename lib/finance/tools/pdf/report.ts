import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  PDFDocument,
  type PDFPage,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import {
  ink,
  teal,
  cream,
  clean,
  textLines,
  wrapped,
} from "./layout";

export async function makeReportPdf(data: {
  workspaceName: string;
  title: string;
  subtitle: string;
  footerLabel?: string;
  strictText?: boolean;
  sections: Array<{ title: string; rows: string[][]; chart?: Array<{ label: string; value: number }> }>;
}) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(
    await readFile(
      path.join(process.cwd(), "public/brand/fonts/Gilroy-Light.woff2"),
    ),
    { features: { liga: false } },
  );
  const strong = await doc.embedFont(
    await readFile(
      path.join(process.cwd(), "public/brand/fonts/Gilroy-ExtraBold.woff2"),
    ),
    { features: { liga: false } },
  );
  if (data.strictText) {
    const supported = new Set(font.getCharacterSet());
    const texts = [data.workspaceName, data.title, data.subtitle, ...data.sections.flatMap(s=>[s.title,...s.rows.flat(),...(s.chart??[]).map(p=>p.label)])];
    if (texts.some(text=>[...text.replace(/[\r\n\t]/g," ")].some(c=>!supported.has(c.codePointAt(0)!)))) throw new Error("The PDF font cannot render some report text.");
  }
  let page: PDFPage,
    y = 0;
  const next = () => {
    page = doc.addPage([595.28, 841.89]);
    page.drawRectangle({
      x: 0,
      y: 745,
      width: 595.28,
      height: 97,
      color: cream,
    });
    wrapped(page, strong, "Space Works", 44, 799, 507, 13);
    wrapped(page, strong, data.title, 44, 770, 507, 21);
    y = 714;
    y = wrapped(page, strong, data.workspaceName, 44, y, 507, 12);
    y = wrapped(page, font, data.subtitle, 44, y, 507, 10) - 12;
  };
  next();
  for (const section of data.sections) {
    if (y < 150) next();
    y = wrapped(page!, strong, section.title, 44, y, 507, 14) - 6;
    if (section.chart?.length) {
      const points = section.chart.slice(0, 8);
      if (y < 70 + points.length * 24) next();
      const max = Math.max(1, ...points.map(p => Math.abs(p.value)));
      const signed = points.some(p=>p.value<0), zeroX=signed?330:210, scaleWidth=signed?120:240;
      if(signed)page!.drawLine({start:{x:zeroX,y:y+10},end:{x:zeroX,y:y-points.length*24+10},thickness:0.5,color:ink});
      for (const point of points) {
        const label = clean(font, point.label).slice(0, 30);
        page!.drawText(label, { x: 44, y, font, size: 9, color: ink });
        page!.drawRectangle({ x: point.value<0?zeroX-scaleWidth*Math.abs(point.value)/max:zeroX, y: y - 2, width: Math.max(1, scaleWidth * Math.abs(point.value) / max), height: 9, color: teal });
        y -= 24;
      }
      y -= 12;
    }
    for (const row of section.rows) {
      const text = row.join("  |  ");
      // A long variance note or receipt list can span pages without clipping.
      const lines = textLines(font, text, 507, 10);
      if (lines.length * 16 + 8 < 540 && y - lines.length * 16 - 8 < 65) next();
      for (const line of lines) {
        if (y < 70) next();
        page!.drawText(line, { x: 44, y, font, size: 10, color: ink });
        y -= 16;
      }
      y -= 12;
    }
    y -= 16;
  }
  for (const [index, p] of doc.getPages().entries()) {
    p.drawText(data.footerLabel ?? "Private finance report", {
      x: 44,
      y: 36,
      font,
      size: 9,
      color: ink,
    });
    p.drawText(`${index + 1} / ${doc.getPageCount()}`, {
      x: 510,
      y: 36,
      font,
      size: 9,
      color: ink,
    });
  }
  doc.setTitle(data.title);
  doc.setProducer("Space Works Workspace");
  return Buffer.from(await doc.save());
}
