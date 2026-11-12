import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { uploadWorkspaceFile, deleteObjects } from "@/lib/storage";
import {
  documentsAccess,
  getDocument,
  lockDocuments,
  DocumentsError,
  type DocumentsActor,
} from "./access";
import { audit } from "./service";
const types = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
]);
export async function uploadDocumentFiles(
  actor: DocumentsActor,
  id: string,
  kind: string,
  files: File[],
) {
  await documentsAccess(actor);
  z.enum([
    "SOURCE",
    "PROFILE",
    "IRP_QR",
    "IRP_JSON",
    "OFFICIAL_CERTIFICATE",
    "FILING_ACK",
  ]).parse(kind);
  if (
    files.length < 1 ||
    files.length > 10 ||
    files.reduce((n, f) => n + f.size, 0) > 24 * 1024 * 1024
  )
    throw new DocumentsError("Choose up to ten files, at most 24 MB together.");
  if (kind === "PROFILE" && id)
    throw new DocumentsError("Profile assets belong in settings.");
  if (kind !== "PROFILE" && !id)
    throw new DocumentsError("Save a draft before adding files.");
  const keys: string[] = [];
  try {
    return await prisma.$transaction(
      async (tx) => {
        await lockDocuments(tx, actor.workspace.id);
        await documentsAccess(actor, undefined, tx);
        if (id) {
          const row = await getDocument(actor, id, tx);
          if (kind === "IRP_QR" || kind === "IRP_JSON") {
            if (row.status !== "RESERVED")
              throw new DocumentsError(
                "IRP evidence belongs to a reserved document.",
              );
          }
        }
        const count = await tx.documentFile.count({
          where: {
            workspaceId: actor.workspace.id,
            documentId: id || null,
            kind,
          },
        });
        if (count + files.length > 20)
          throw new DocumentsError(
            "Keep at most twenty files of each kind on this record.",
          );
        const ids: string[] = [];
        for (const file of files) {
          if (kind === "IRP_JSON") {
            if (file.size > 2 * 1024 * 1024)
              throw new DocumentsError("Signed JSON must be under 2 MB.");
            try {
              JSON.parse(await file.text());
            } catch {
              throw new DocumentsError("Upload the original signed JSON file.");
            }
          }
          const upload = await uploadWorkspaceFile({
            workspaceId: actor.workspace.id,
            uploadedById: actor.user.id,
            file,
            folder: `/documents/${kind.toLowerCase()}`,
            allowedTypes:
              kind === "IRP_JSON"
                ? new Set(["application/json"])
                : kind === "PROFILE" || kind === "IRP_QR"
                  ? new Set(["image/png", "image/jpeg", "image/webp"])
                  : types,
            maxBytes: 10 * 1024 * 1024,
            client: tx,
          });
          if (!upload.ok) throw new DocumentsError(upload.error);
          keys.push(upload.file.storageKey);
          await tx.documentFile.create({
            data: {
              workspaceId: actor.workspace.id,
              documentId: id || null,
              kind,
              fileId: upload.file.id,
            },
          });
          ids.push(upload.file.id);
        }
        await audit(actor, "files_uploaded", id || "profile", tx);
        return ids;
      },
      { timeout: 30000 },
    );
  } catch (e) {
    await deleteObjects(keys).catch(() => undefined);
    throw e;
  }
}
export async function mayDownloadDocumentFile(
  file: { id: string; workspaceId: string; folder: string },
  userId: string,
  viaSuperAdmin = false,
) {
  const link = await prisma.documentFile.findFirst({
    where: { workspaceId: file.workspaceId, fileId: file.id },
  });
  if (!link) return !file.folder.startsWith("/documents");
  const workspace = await prisma.workspace.findFirst({
    where: { id: file.workspaceId, archivedAt: null },
  });
  if (!workspace) return false;
  const actor = {
    user: { id: userId, name: null },
    workspace,
    membership: { role: "GUEST" as const, ...(viaSuperAdmin ? { viaSuperAdmin: true } : {}) },
  };
  try {
    if (link.documentId) await getDocument(actor, link.documentId);
    else await documentsAccess(actor);
    await audit(actor, "file_downloaded", link.documentId || "profile");
    return true;
  } catch {
    return false;
  }
}
