import "server-only";

import { createHash } from "crypto";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";
import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";
import type { FileObject } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { assertWithinLimit } from "@/lib/limits/enforce";
import { buildStorageKey, checkUpload, contentDisposition, INLINE_SAFE_TYPES, RASTER_IMAGE_TYPES, sanitizeFilename } from "./policy";

export * from "./policy";

/**
 * Private object storage (Silo locally/VPS, Cloudflare R2 in the cloud).
 * Objects are never public: every read goes through /api/files/[id] after a
 * membership check. In development without S3_BUCKET, objects fall back to
 * `.data/storage` on disk; production refuses to run without S3.
 */

const CLIENT_KEY = Symbol.for("sww.s3");

export function storageConfigured() {
  return Boolean(process.env.S3_BUCKET && process.env.S3_REGION);
}

function client(): S3Client {
  const g = globalThis as typeof globalThis & { [CLIENT_KEY]?: S3Client };
  if (g[CLIENT_KEY]) return g[CLIENT_KEY];
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  g[CLIENT_KEY] = new S3Client({
    region: process.env.S3_REGION!,
    ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "1",
    ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
  });
  return g[CLIENT_KEY];
}

function localPath(key: string) {
  const root = path.resolve(process.cwd(), ".data/storage");
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error("Invalid storage key.");
  return full;
}

function assertStorageAvailable() {
  if (!storageConfigured() && process.env.NODE_ENV === "production") throw new Error("Private object storage is not configured.");
}

export async function putObject(key: string, body: Buffer, contentType: string) {
  assertStorageAvailable();
  if (storageConfigured()) {
    await client().send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key, Body: body, ContentType: contentType }));
    return;
  }
  const file = localPath(key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body);
}

/** Read a whole object. Returns null when it does not exist. */
export async function getObject(key: string): Promise<{ body: Uint8Array; contentType?: string } | null> {
  assertStorageAvailable();
  if (storageConfigured()) {
    try {
      const object = await client().send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key }));
      if (!object.Body) return null;
      return { body: await object.Body.transformToByteArray(), contentType: object.ContentType };
    } catch (error) {
      if ((error as { name?: string }).name === "NoSuchKey") return null;
      throw error;
    }
  }
  try {
    return { body: new Uint8Array(await readFile(localPath(key))) };
  } catch {
    return null;
  }
}

export async function deleteObjects(keys: string[]) {
  const unique = [...new Set(keys)];
  if (unique.length === 0) return;
  assertStorageAvailable();
  if (storageConfigured()) {
    for (let start = 0; start < unique.length; start += 1000) {
      await client().send(new DeleteObjectsCommand({
        Bucket: process.env.S3_BUCKET!,
        Delete: { Objects: unique.slice(start, start + 1000).map((Key) => ({ Key })), Quiet: true },
      }));
    }
    return;
  }
  await Promise.all(unique.map((key) => rm(localPath(key), { force: true })));
}

/**
 * Decode raster images under a pixel limit so a corrupt or decompression-bomb
 * upload is rejected before it is stored. Returns an error message or null.
 */
export async function checkImageSanity(body: Buffer, contentType: string): Promise<string | null> {
  if (!RASTER_IMAGE_TYPES.has(contentType)) return null;
  try {
    const metadata = await sharp(body, { limitInputPixels: 40_000_000, failOn: "error", animated: contentType === "image/gif" }).metadata();
    const expected = contentType === "image/jpeg" ? "jpeg" : contentType.slice("image/".length);
    if (metadata.format !== expected || !metadata.width || !metadata.height) return "That image couldn't be read. Try a PNG, JPEG or WebP file.";
    return null;
  } catch {
    return "That image couldn't be read. Try a PNG, JPEG or WebP file.";
  }
}

export type UploadWorkspaceFileInput = {
  workspaceId: string;
  uploadedById: string | null;
  file: File;
  folder?: string;
  docId?: string | null;
  taskId?: string | null;
  /** Narrow the global allow-list for a feature (e.g. images only for project covers). */
  allowedTypes?: ReadonlySet<string>;
  maxBytes?: number;
  client?: DbClient;
};

export function normalizeFolder(folder: string | undefined): string {
  const parts = (folder ?? "/").split("/").map((part) => sanitizeFilename(part).replace(/^file$/, "")).filter(Boolean);
  return `/${parts.join("/")}`.slice(0, 300) || "/";
}

/**
 * Validate, store and record one upload. Callers must already have checked
 * the uploader's membership/role in `workspaceId`.
 */
export async function uploadWorkspaceFile(input: UploadWorkspaceFileInput): Promise<{ ok: true; file: FileObject } | { ok: false; error: string }> {
  // The per-file cap is the tighter of the caller's and the workspace's; storage counts the new bytes.
  const fileLimit = await assertWithinLimit("fileBytes", input.workspaceId, input.file.size);
  if (!fileLimit.ok) return fileLimit;
  const check = checkUpload({ size: input.file.size, type: input.file.type }, input.maxBytes);
  if (!check.ok) return check;
  const storage = await assertWithinLimit("storageBytes", input.workspaceId, input.file.size, input.client);
  if (!storage.ok) return storage;
  if (input.allowedTypes && !input.allowedTypes.has(check.contentType)) return { ok: false, error: "That file type isn't allowed here." };
  const body = Buffer.from(await input.file.arrayBuffer());
  const imageError = await checkImageSanity(body, check.contentType);
  if (imageError) return { ok: false, error: imageError };

  const filename = sanitizeFilename(input.file.name);
  const storageKey = buildStorageKey(input.workspaceId, filename);
  await putObject(storageKey, body, check.contentType);
  try {
    const file = await (input.client ?? prisma).fileObject.create({
      data: {
        workspaceId: input.workspaceId,
        storageKey,
        filename,
        contentType: check.contentType,
        size: body.length,
        checksum: createHash("sha256").update(body).digest("hex"),
        uploadedById: input.uploadedById,
        folder: normalizeFolder(input.folder),
        docId: input.docId ?? null,
        taskId: input.taskId ?? null,
      },
    });
    return { ok: true, file };
  } catch (error) {
    await deleteObjects([storageKey]).catch(() => undefined);
    throw error;
  }
}

/** Relative URL of the authorised download route for a file. */
export function fileUrl(fileId: string, options: { download?: boolean } = {}) {
  return `/api/files/${encodeURIComponent(fileId)}${options.download ? "?download=1" : ""}`;
}

/** Build the HTTP response for an already-authorised file. */
export async function fileResponse(file: Pick<FileObject, "storageKey" | "filename" | "contentType" | "size">, options: { download?: boolean } = {}) {
  const object = await getObject(file.storageKey);
  if (!object) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const inline = !options.download && INLINE_SAFE_TYPES.has(file.contentType);
  return new Response(Buffer.from(object.body), {
    status: 200,
    headers: {
      "Content-Type": inline ? file.contentType : "application/octet-stream",
      "Content-Length": String(object.body.byteLength),
      "Content-Disposition": contentDisposition(file.filename, inline),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      // Even an inline PDF cannot run script against the app origin.
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "Referrer-Policy": "no-referrer",
    },
  });
}
