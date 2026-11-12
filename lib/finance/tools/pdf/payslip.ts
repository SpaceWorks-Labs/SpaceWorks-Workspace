import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { payTotals } from "@/lib/finance/tools-rules";
import { currencyMinorDigits } from "@/lib/format/money";
import {
  ink,
  teal,
  cream,
  clean,
  wrapped,
} from "./layout";

export type PayslipData = {
  workspaceName: string;
  person: string;
  month: string;
  currency: string;
  kind: string;
  status: string;
  grossMinor: number;
  allowancesMinor: number;
  pfMinor: number;
  esiMinor: number;
  ptMinor: number;
  tdsMinor: number;
  advancesMinor: number;
  otherMinor: number;
  paidOn: string | null;
  reference: string | null;
};
export async function makePayslipPdf(data: PayslipData) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [regular, bold] = await Promise.all([
    readFile(
      path.join(process.cwd(), "public/brand/fonts/Gilroy-Light.woff2"),
    ),
    readFile(path.join(process.cwd(), "public/brand/fonts/Gilroy-ExtraBold.woff2")),
  ]);
  const font = await doc.embedFont(regular, { features: { liga: false } }),
    strong = await doc.embedFont(bold, { features: { liga: false } });
  const page = doc.addPage([595.28, 841.89]);
  page.drawRectangle({
    x: 0,
    y: 730,
    width: 595.28,
    height: 112,
    color: cream,
  });
  wrapped(page, strong, "Space Works", 44, 795, 510, 15);
  wrapped(page, strong, "Payslip", 44, 758, 510, 25);
  let y = 695;
  y = wrapped(page, strong, data.workspaceName, 44, y, 510, 15);
  y = wrapped(page, font, `${data.person} | ${data.month}`, 44, y - 5, 510, 14);
  y = wrapped(page, font, `${data.kind} | ${data.status}`, 44, y, 510, 11);
  const money = (n: number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: data.currency,
      currencyDisplay: "code",
    })
      .format(n / 10 ** currencyMinorDigits(data.currency))
      .replace(/\u00a0/g, " ");
  const rows: [string, number][] = [
    ["Gross pay", data.grossMinor],
    ["Allowances", data.allowancesMinor],
    ["Provident fund", -data.pfMinor],
    ["ESI", -data.esiMinor],
    ["Professional tax", -data.ptMinor],
    ["TDS", -data.tdsMinor],
    ["Advances recovered", -data.advancesMinor],
    ["Other deductions", -data.otherMinor],
  ];
  y -= 10;
  for (const [name, value] of rows) {
    page.drawLine({
      start: { x: 44, y: y - 10 },
      end: { x: 551, y: y - 10 },
      thickness: 0.5,
      color: cream,
    });
    page.drawText(name, { x: 44, y, font, size: 12, color: ink });
    const amount = clean(font, money(value));
    page.drawText(amount, {
      x: 551 - font.widthOfTextAtSize(amount, 12),
      y,
      font,
      size: 12,
      color: ink,
    });
    y -= 33;
  }
  const { netMinor } = payTotals(data);
  page.drawRectangle({
    x: 44,
    y: y - 20,
    width: 507,
    height: 48,
    color: cream,
  });
  page.drawText("Net pay", {
    x: 57,
    y: y - 2,
    font: strong,
    size: 14,
    color: teal,
  });
  const net = clean(strong, money(netMinor));
  page.drawText(net, {
    x: 538 - strong.widthOfTextAtSize(net, 16),
    y: y - 2,
    font: strong,
    size: 16,
    color: ink,
  });
  y -= 58;
  y = wrapped(
    page,
    font,
    `Paid on: ${data.paidOn ?? "Not paid"}`,
    44,
    y,
    507,
    11,
  );
  y = wrapped(
    page,
    font,
    `Payment reference: ${data.reference ?? "Not recorded"}`,
    44,
    y,
    507,
    11,
  );
  wrapped(
    page,
    font,
    "Manually recorded by the team. Retain with your payment records.",
    44,
    Math.min(y - 10, 135),
    507,
    10,
  );
  page.drawText("Private payroll record", {
    x: 44,
    y: 44,
    font,
    size: 10,
    color: ink,
  });
  page.drawText("1 / 1", { x: 523, y: 44, font, size: 10, color: ink });
  doc.setTitle(`Payslip ${data.month}`);
  doc.setProducer("Space Works Workspace");
  return Buffer.from(await doc.save());
}
