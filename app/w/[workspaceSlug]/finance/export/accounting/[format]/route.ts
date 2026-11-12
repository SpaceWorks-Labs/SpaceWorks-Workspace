import { getWorkspaceForAction } from "@/lib/permissions";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { recordAuditEvent } from "@/lib/audit";
import { FinanceError } from "@/lib/finance/tools/access";
import { buildAccountingExport } from "@/lib/finance/accounting-export";
import { isAccountingFormat } from "@/lib/finance/accounting-export/types";
import { dateOnly } from "@/lib/finance/dates";

const validDay = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && dateOnly(v).toISOString().slice(0, 10) === v;

export async function GET(request: Request, { params }: RouteContext<"/w/[workspaceSlug]/finance/export/accounting/[format]">) {
  const { workspaceSlug, format } = await params;
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  const actor = await getWorkspaceForAction(workspaceSlug, "MEMBER");
  if (!actor || !isAccountingFormat(format)) return new Response("Not found", { status: 404, headers });
  if (await isActionRateLimited("apiRead", `finance-accounting-export:${actor.user.id}`)) return new Response("Try again in a minute.", { status: 429, headers });
  const url = new URL(request.url).searchParams;
  const from = url.get("from");
  const to = url.get("to");
  if (!validDay(from) || !validDay(to) || from > to) return new Response("Choose a start date and an end date after it.", { status: 400, headers });
  try {
    const result = await buildAccountingExport(actor, format, { from, to, accountId: url.get("account") || null, journalLedger: url.get("journalLedger")?.slice(0, 100) || null });
    if (result.unmapped.length && url.get("partial") !== "1")
      return new Response(`${result.unmapped.length} entries are not mapped to ledger codes. Map them, or download only the mapped entries.`, { status: 409, headers });
    await recordAuditEvent({
      workspaceId: actor.workspace.id,
      actorId: actor.user.id,
      action: "finance.accounting_export_downloaded",
      targetType: format,
      metadata: { rows: result.count, unmapped: result.unmapped.length, from, to },
    });
    return new Response(format === "tally" ? result.body : `﻿${result.body}`, {
      headers: { ...headers, "Content-Type": result.contentType, "Content-Disposition": `attachment; filename="${result.filename}"`, "X-Unmapped-Entries": String(result.unmapped.length) },
    });
  } catch (e) {
    if (e instanceof FinanceError) return new Response(e.message, { status: /access/.test(e.message) ? 404 : 400, headers });
    throw e;
  }
}
