import "server-only";
import { prisma } from "@/lib/db";
import { getObject } from "@/lib/storage";
/** Resolve a queued receipt afresh, including donor consent and the private generated-file link. */
export async function fundingReceiptAttachment(
  workspaceId: string,
  raw: unknown,
  to: string,
) {
  if (!raw || typeof raw !== "object")
    throw new Error("Invalid receipt email.");
  const r = raw as Record<string, unknown>;
  if (
    ![r.recordId, r.fileId, r.contactId].every(
      (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v),
    )
  )
    throw new Error("Invalid receipt email.");
  const gift = await prisma.fundingRecord.findFirst({
    where: {
      workspaceId,
      id: String(r.recordId),
      contactId: String(r.contactId),
      receiptFileId: String(r.fileId),
      kind: "DONATION",
      status: "RECEIVED",
      archivedAt: null,
      workspace: { status: "ACTIVE", archivedAt: null },
    },
  });
  if (!gift) throw new Error("That donation receipt is unavailable.");
  const controlled = await prisma.documentFile.findFirst({
    where: { workspaceId, fileId: String(r.fileId), kind: "PDF" },
    select: { document: { select: { status: true } } },
  });
  if (controlled?.document && controlled.document.status !== "ISSUED")
    throw new Error("That controlled receipt is cancelled or unavailable.");
  const contact = await prisma.contact.findFirst({
    where: {
      workspaceId,
      id: String(r.contactId),
      deletedAt: null,
      consentStatus: "GRANTED",
      doNotContact: false,
      preferredChannel: "EMAIL",
    },
    select: { emails: true },
  });
  const emails = contact && Array.isArray(contact.emails) ? contact.emails : [];
  if (
    !emails.some(
      (e) => e && typeof e === "object" && "value" in e && e.value === to,
    )
  )
    throw new Error("Donor email consent is unavailable.");
  const attachment = await prisma.fundingAttachment.findFirst({
    where: {
      workspaceId,
      recordId: gift.id,
      fileId: String(r.fileId),
      generated: true,
      file: { workspaceId, deletedAt: null, contentType: "application/pdf" },
    },
    select: {
      file: { select: { storageKey: true, filename: true, checksum: true } },
    },
  });
  if (!attachment) throw new Error("That receipt PDF is unavailable.");
  const file = await getObject(attachment.file.storageKey);
  if (!file) throw new Error("That receipt PDF is unavailable.");
  const { createHash } = await import("node:crypto");
  if (
    !attachment.file.checksum ||
    createHash("sha256").update(file.body).digest("hex") !==
      attachment.file.checksum
  )
    throw new Error("The receipt checksum does not match.");
  return {
    filename: attachment.file.filename,
    content: Buffer.from(file.body),
    contentType: "application/pdf",
  };
}
