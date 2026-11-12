import "server-only";
import { prisma } from "@/lib/db";
import { lockFinance } from "@/lib/finance/tools/access";
import { lockDocuments } from "@/lib/documents/access";
import { recordAuditEvent } from "@/lib/audit";
import {
  detailSchemas,
  operationSchema,
  quarterEnd,
} from "@/lib/funding/schema";
import {
  lock,
  ensure,
  type Actor,
} from "./access";
import {
  audit,
  sync,
} from "./activity";
import {
  linked,
  PARENTS,
} from "./record-links";
import { voidDonationLedgerEntry } from "./ledger-link";

export async function operate(actor: Actor, raw: unknown) {
  const input = operationSchema.parse(raw);
  if (input.op === "receipt" || input.op === "email") {
    const { receiptOperation } = await import("../receipts");
    return receiptOperation(actor, input.id, input.op);
  }
  if (input.op === "impactPdf") {
    const { generateImpactReport } = await import("../reports");
    return generateImpactReport(actor, input.id);
  }
  return prisma.$transaction(
    async (tx) => {
      if (input.op === "void") await lockFinance(tx, actor.workspace.id);
      await lock(actor, tx);
      const workspaceId = actor.workspace.id;
      if (input.op === "quarter") {
        const accounts = await tx.fundingRecord.findMany({
          where: {
            workspaceId,
            kind: "TOOL_ACCOUNT",
            archivedAt: null,
            status: { not: "REMOVED" },
          },
          take: 2001,
        });
        ensure(
          accounts.length <= 2000,
          "Review up to 2,000 accounts at a time.",
        );
        for (const account of accounts) {
          const row = await tx.fundingRecord.upsert({
            where: {
              workspaceId_kind_key: {
                workspaceId,
                kind: "ACCESS_REVIEW",
                key: `${account.id}:${input.quarter}`,
              },
            },
            create: {
              workspaceId,
              kind: "ACCESS_REVIEW",
              key: `${account.id}:${input.quarter}`,
              parentId: account.id,
              title: `${account.title} · ${input.quarter}`,
              status: "TODO",
              dueOn: new Date(quarterEnd(input.quarter)),
              ownerId: account.ownerId ?? actor.user.id,
              createdById: actor.user.id,
              details: {
                quarter: input.quarter,
                decision: "KEEP",
                reviewNote: "",
              },
            },
            update: {},
          });
          await sync(actor, tx, row, "review_added");
        }
        return { id: "" };
      }
      const row = await tx.fundingRecord.findFirst({
        where: {
          workspaceId,
          id: input.id,
          archivedAt: input.op === "restore" ? { not: null } : null,
        },
      });
      ensure(row);
      if (input.op === "void") {
        ensure(
          row.kind === "DONATION" && row.status === "RECEIVED",
          "Choose a received donation to void.",
        );
        await lockDocuments(tx, workspaceId);
        const affected = await tx.businessDocument.findMany({
          where: {
            workspaceId,
            sourceType: "FUNDING",
            sourceId: row.id,
            type: {
              in: ["DONATION_RECEIPT", "FCRA_RECEIPT", "DONATION_CERTIFICATE"],
            },
            status: { in: ["ISSUED", "RESERVED"] },
          },
          select: { id: true },
        });
        await tx.businessDocument.updateMany({
          where: { workspaceId, id: { in: affected.map((d) => d.id) } },
          data: {
            status: "CANCELLED",
            cancelledAt: new Date(),
            cancelledById: actor.user.id,
            cancelReason: "Source donation was marked void in Funding.",
          },
        });
        for (const d of affected)
          await recordAuditEvent({
            workspaceId,
            actorId: actor.user.id,
            action: "documents.source_voided",
            targetType: "business_document",
            targetId: d.id,
            client: tx,
          });
        const changed = await tx.fundingRecord.update({
          where: { workspaceId_id: { workspaceId, id: row.id } },
          data: { status: "VOID" },
        });
        await sync(actor, tx, changed, "voided");
        await voidDonationLedgerEntry(tx, workspaceId, row.id, actor.user.id);
        return { id: row.id };
      }
      if (input.op === "donorPreferences") {
        ensure(row.kind === "DONOR" && row.contactId);
        ensure(
          await tx.contact.findFirst({
            where: { workspaceId, id: row.contactId, deletedAt: null },
          }),
        );
        await tx.contact.updateMany({
          where: { workspaceId, id: row.contactId },
          data: {
            preferredChannel: input.preferredChannel,
            consentStatus: input.consentStatus,
            doNotContact: input.doNotContact,
            consentSource: input.consentSource,
            consentAt: new Date(),
          },
        });
        await audit(actor, tx, row, "donor_preferences_updated");
        return { id: row.id };
      }
      if (input.op === "thank") {
        ensure(row.kind === "DONATION" && row.status === "RECEIVED");
        if (!row.thankedAt) {
          await tx.fundingRecord.updateMany({
            where: { workspaceId, id: row.id },
            data: { thankedAt: new Date(), thankedById: actor.user.id },
          });
          await audit(actor, tx, row, "thanked");
        }
        return { id: row.id };
      }
      if (input.op === "sign") {
        ensure(row.kind === "ACCESS_REVIEW");
        if (!row.signedAt) {
          ensure(
            row.parentId &&
              (await linked(tx, workspaceId, row.parentId, "TOOL_ACCOUNT")),
          );
          const d = detailSchemas.ACCESS_REVIEW.parse(row.details);
          ensure(d.reviewNote, "Add a review note before signing off.");
          const signed = await tx.fundingRecord.update({
            where: { workspaceId_id: { workspaceId, id: row.id } },
            data: {
              signedAt: new Date(),
              signedById: actor.user.id,
              status: "SIGNED",
            },
          });
          await sync(actor, tx, signed, "review_signed");
        }
        return { id: row.id };
      }
      if (input.op === "restore") {
        if (row.parentId)
          ensure(
            await linked(tx, workspaceId, row.parentId, Object.values(PARENTS)),
            "Restore the parent record first.",
          );
      } else {
        ensure(!row.signedAt, "Signed reviews stay in the record.");
        ensure(
          !(await tx.fundingRecord.count({
            where: { workspaceId, parentId: row.id, archivedAt: null },
          })),
          "Archive the linked child records first.",
        );
      }
      const changed = await tx.fundingRecord.update({
        where: { workspaceId_id: { workspaceId, id: row.id } },
        data: { archivedAt: input.op === "restore" ? null : new Date() },
      });
      await sync(
        actor,
        tx,
        changed,
        input.op === "restore" ? "restored" : "archived",
      );
      return { id: row.id };
    },
    { timeout: 20000 },
  );
}
