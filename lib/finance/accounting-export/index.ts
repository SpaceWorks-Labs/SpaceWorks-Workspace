import "server-only";
import { journalCsv, quickbooksCsv, tallyXml, xeroCsv } from "./builders";
import { loadAccountingRows, type ExportFilter } from "./query";
import { FORMAT_INFO, type AccountingFormat } from "./types";
import type { FinanceActor } from "@/lib/finance/tools/access";

export { loadAccountingRows, MAX_EXPORT_ROWS, type ExportFilter } from "./query";
export { saveExternalCodes } from "./mapping";

export async function buildAccountingExport(actor: FinanceActor, format: AccountingFormat, filter: ExportFilter) {
  const { rows, unmapped } = await loadAccountingRows(actor, format, filter);
  const body = format === "tally" ? tallyXml(rows) : format === "xero" ? xeroCsv(rows) : format === "quickbooks" ? quickbooksCsv(rows) : journalCsv(rows);
  const info = FORMAT_INFO[format];
  return { body, count: rows.length, unmapped, contentType: info.contentType, filename: `accounting-${format}-${filter.from}-to-${filter.to}.${info.extension}` };
}
