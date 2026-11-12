import { getWorkspaceForAction } from "@/lib/permissions";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { recordAuditEvent } from "@/lib/audit";
import { FinanceError } from "@/lib/finance/tools/access";
import { STATEMENT_KINDS, STATEMENT_TITLES, statementCsv, type StatementKind } from "@/lib/finance/statements/export";
import { loadStatements } from "@/lib/finance/statements/load";
import { statementPdf } from "@/lib/finance/statements/pdf";

export async function GET(request: Request, { params }: RouteContext<"/w/[workspaceSlug]/finance/statements/export/[kind]">) {
  const { workspaceSlug, kind } = await params;
  const actor = await getWorkspaceForAction(workspaceSlug, "MEMBER");
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  if (!actor || !(STATEMENT_KINDS as readonly string[]).includes(kind)) return new Response("Not found", { status: 404, headers });
  if (await isActionRateLimited("apiRead", `finance-statements:${actor.user.id}`)) return new Response("Try again in a minute.", { status: 429, headers });
  const url = new URL(request.url);
  const pdf = url.searchParams.get("format") === "pdf";
  try {
    const data = await loadStatements(actor, { year: Number(url.searchParams.get("year")) || undefined, currency: url.searchParams.get("currency") ?? undefined });
    await recordAuditEvent({ workspaceId: actor.workspace.id, actorId: actor.user.id, action: "finance.statement_exported", targetType: "statement", targetId: kind, metadata: { format: pdf ? "pdf" : "csv", year: data.range.year } });
    const name = `${STATEMENT_TITLES[kind as StatementKind].toLowerCase().replaceAll(" ", "-")}-${data.range.label}.${pdf ? "pdf" : "csv"}`;
    const body = pdf ? new Uint8Array(await statementPdf(data, kind as StatementKind)) : `﻿${statementCsv(data, kind as StatementKind)}`;
    return new Response(body, { headers: { ...headers, "Content-Type": pdf ? "application/pdf" : "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` } });
  } catch (e) {
    if (e instanceof FinanceError) return new Response(e.message, { status: /access/.test(e.message) ? 404 : 400, headers });
    throw e;
  }
}
