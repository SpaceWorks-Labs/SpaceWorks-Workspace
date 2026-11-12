import { getWorkspaceForAction } from "@/lib/permissions";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { recordAuditEvent } from "@/lib/audit";
import { FinanceError } from "@/lib/finance/tools/access";
import { fcraReceiptsCsv } from "@/lib/finance/fcra";

export async function GET(request: Request, { params }: RouteContext<"/w/[workspaceSlug]/finance/statements/fcra">) {
  const { workspaceSlug } = await params;
  const actor = await getWorkspaceForAction(workspaceSlug, "ADMIN");
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  if (!actor) return new Response("Not found", { status: 404, headers });
  if (await isActionRateLimited("apiRead", `finance-fcra:${actor.user.id}`)) return new Response("Try again in a minute.", { status: 429, headers });
  const url = new URL(request.url);
  const year = Number(url.searchParams.get("year")), quarter = Number(url.searchParams.get("quarter"));
  try {
    const { csv, quarter: q } = await fcraReceiptsCsv(actor, year, quarter);
    await recordAuditEvent({ workspaceId: actor.workspace.id, actorId: actor.user.id, action: "finance.fcra_receipts_exported", targetType: "fcra", metadata: { year, quarter: q } });
    return new Response(`﻿${csv}`, { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="fcra-receipts-${year}-q${q}.csv"` } });
  } catch (e) {
    if (e instanceof FinanceError) return new Response(e.message, { status: /access/.test(e.message) ? 404 : 400, headers });
    throw e;
  }
}
