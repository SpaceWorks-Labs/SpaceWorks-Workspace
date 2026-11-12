import "server-only";
import { makeReportPdf } from "@/lib/finance/tools/pdf";
import { STATEMENT_DISCLAIMER } from "./fiscal";
import { STATEMENT_TITLES, statementPdfSections, type StatementKind } from "./export";
import type { StatementData } from "./load";

export function statementPdf(d: StatementData, kind: StatementKind) {
  return makeReportPdf({
    workspaceName: d.workspaceName,
    title: STATEMENT_TITLES[kind],
    subtitle: `Financial year ${d.range.label}, ${d.range.from} to ${d.range.to} | ${d.currency} | ${STATEMENT_DISCLAIMER}`,
    footerLabel: "Management statement - not audited",
    sections: statementPdfSections(d, kind),
  });
}
