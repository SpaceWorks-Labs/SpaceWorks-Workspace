import "server-only";
import { refundState } from "@/lib/documents/refunds";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { dispatch } from "@/lib/notify";
import { localDate } from "@/lib/finance/dates";
import { INVOICES } from "@/lib/documents/rules";
import { creditsByInvoice } from "@/lib/documents/corrections";
import { lockDocuments } from "@/lib/documents/access";
import { recordAuditEvent } from "@/lib/audit";
export async function run(now: Date) {
  const candidates = await prisma.$queryRaw<
    Array<{ id: string; workspaceId: string }>
  >`
    SELECT d.id,d."workspaceId" FROM "BusinessDocument" d JOIN "Workspace" w ON w.id=d."workspaceId"
    WHERE d.status='ISSUED' AND d.type IN (${Prisma.join([...INVOICES])}) AND w."archivedAt" IS NULL
    AND d."dueOn" < (${now}::timestamptz AT TIME ZONE w.timezone)::date
    AND (d."sourceType" IS NULL OR d."sourceType"<>'PAY_RUN')
    AND d."totalMinor" > COALESCE((SELECT SUM(a."cashMinor"::bigint+a."tdsMinor") FROM "DocumentAllocation" a WHERE a."workspaceId"=d."workspaceId" AND a."invoiceId"=d.id),0)
      + COALESCE((SELECT SUM(CASE WHEN jsonb_typeof(c.snapshot->'source'->'noteAllocations')='array' THEN (SELECT COALESCE(SUM((a->>'amountMinor')::bigint),0) FROM jsonb_array_elements(c.snapshot->'source'->'noteAllocations') a WHERE a->>'invoiceId'=d.id) ELSE c."totalMinor" END) FROM "BusinessDocument" c WHERE c."workspaceId"=d."workspaceId" AND (c."parentId"=d.id OR c.snapshot->'source'->'noteAllocations' @> jsonb_build_array(jsonb_build_object('invoiceId',d.id))) AND c.type='CREDIT_NOTE' AND c.status='ISSUED'),0)
      - COALESCE((SELECT SUM((a->>'cashMinor')::bigint) FROM "BusinessDocument" r CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r.snapshot->'source'->'refundAllocations')='array' THEN r.snapshot->'source'->'refundAllocations' ELSE '[]'::jsonb END) a WHERE r."workspaceId"=d."workspaceId" AND r.status='ISSUED' AND r.type IN ('PAYMENT_REFUND','REFUND_VOUCHER') AND a->>'invoiceId'=d.id),0)
    AND NOT EXISTS(SELECT 1 FROM "AuditEvent" a WHERE a."workspaceId"=d."workspaceId" AND a."targetId"=d.id AND a.action='documents.followup_reminded' AND a.metadata->>'day'=to_char((${now}::timestamptz AT TIME ZONE w.timezone)::date,'YYYY-MM-DD'))
    ORDER BY d."dueOn",d.id LIMIT 200`;
  for (const candidate of candidates) {
    const result = await prisma.$transaction(async (tx) => {
      await lockDocuments(tx, candidate.workspaceId);
      const row = await tx.businessDocument.findFirst({
        where: {
          workspaceId: candidate.workspaceId,
          id: candidate.id,
          status: "ISSUED",
        },
        include: {
          workspace: true,
          allocations: true,
          corrections: { where: { type: "CREDIT_NOTE", status: "ISSUED" } },
        },
      });
      if (!row || !row.dueOn || row.workspace.archivedAt || row.workspace.status !== "ACTIVE") return null;
      const today = localDate(now, row.workspace.timezone);
      if (row.dueOn.toISOString().slice(0, 10) >= today) return null;
      if (
        row.allocations.reduce((s, a) => s + a.cashMinor + a.tdsMinor, 0) -
          ((await refundState(row.workspaceId, tx)).invoices.get(row.id) ?? 0) +
          ((await creditsByInvoice(row.workspaceId, tx)).get(row.id) ?? 0) >=
        row.totalMinor
      )
        return null;
      const key = `documents:${row.id}:${today}`;
      if (
        await tx.auditEvent.findFirst({
          where: {
            workspaceId: row.workspaceId,
            targetId: row.id,
            action: "documents.followup_reminded",
            metadata: { path: ["day"], equals: today },
          },
        })
      )
        return null;
      const admins = await tx.membership.findMany({
        where: {
          workspaceId: row.workspaceId,
          status: "ACTIVE",
          role: { in: ["OWNER", "ADMIN"] },
          user: { disabledAt: null },
        },
        select: { userId: true },
      });
      const sent = await dispatch(
        row.workspaceId,
        {
          type: "documents.receivable.due",
          title: "A document needs payment follow-up",
          url: `/w/${row.workspace.slug}/documents/${row.id}`,
          recipients: admins.map((a) => a.userId),
          dedupeKey: key,
          resource: { type: "business_document", id: row.id },
          data: { documentId: row.id },
        },
        { tx, now },
      );
      await recordAuditEvent({
        workspaceId: row.workspaceId,
        action: "documents.followup_reminded",
        targetType: "business_document",
        targetId: row.id,
        metadata: { day: today },
        client: tx,
      });
      return sent;
    });
    if (result) await result.afterCommit();
  }
}
