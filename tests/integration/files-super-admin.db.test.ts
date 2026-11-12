import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => ({ mfa: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: (name: string) => (name === "sww.admin-mfa.v1" && request.mfa ? { value: request.mfa } : undefined) }),
}));

import { prisma } from "@/lib/db";
import { findDownloadableFile } from "@/lib/files";
import { createSuperAdminMfaProof } from "@/lib/superAdminMfa";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@files-sa-${suffix}.test`;
const slug = `files-sa-${suffix}`;
let workspaceId = "";
let owner = "";
let member = "";
let outsider = "";
let superId = "";

const file = (name: string, extra: Record<string, unknown> = {}) =>
  prisma.fileObject.create({
    data: { workspaceId, storageKey: `workspaces/${workspaceId}/files/${suffix}-${name}`, filename: name, contentType: "application/pdf", size: 4, uploadedById: owner, ...extra },
  });
const audits = () => prisma.auditEvent.count({ where: { workspaceId, action: "admin.workspace_accessed" } });

beforeAll(async () => {
  process.env.SUPER_ADMIN_EMAIL = `root${domain}`;
  owner = (await createUser(`owner${domain}`)).id;
  workspaceId = (await createWorkspace(slug, owner)).id;
  member = (await createUser(`member${domain}`)).id;
  outsider = (await createUser(`out${domain}`)).id;
  await addMember(workspaceId, member, "MEMBER");
  const root = await prisma.user.create({ data: { email: `root${domain}`, name: "Root", emailVerified: new Date(), mfaEnabledAt: new Date() } });
  superId = root.id;
  request.mfa = createSuperAdminMfaProof(superId, root.sessionVersion);
}, 60_000);

afterAll(async () => {
  await cleanup([slug], domain);
  await prisma.$disconnect();
});

describe.sequential("file downloads for the super admin", () => {
  it("serves a finance receipt and a document file without membership, auditing once", async () => {
    const entry = await prisma.ledgerEntry.create({ data: { workspaceId, kind: "EXPENSE", amountMinor: 100, currency: "INR", description: "Parts", occurredOn: new Date("2026-10-01") } });
    const receipt = await file("receipt.pdf", { folder: "/finance-tools" });
    await prisma.financeAttachment.create({ data: { workspaceId, recordType: "LEDGER", recordId: entry.id, fileId: receipt.id, uploadedById: owner } });
    const doc = await file("doc.pdf", { folder: "/documents" });
    await prisma.documentFile.create({ data: { workspaceId, kind: "PROFILE", fileId: doc.id } });
    expect(await prisma.membership.count({ where: { workspaceId, userId: superId } })).toBe(0);
    expect(await findDownloadableFile(receipt.id, superId)).not.toBeNull();
    expect(await findDownloadableFile(doc.id, superId)).not.toBeNull();
    expect(await audits()).toBe(1);
    expect(await findDownloadableFile(receipt.id, outsider)).toBeNull();
    expect(await findDownloadableFile(doc.id, outsider)).toBeNull();
  });

  it("bypasses team privacy for the super admin only", async () => {
    const team = await prisma.team.create({ data: { workspaceId, name: `Ops ${suffix}`, slug: `ops-${suffix}`, visibility: "PRIVATE" } });
    await prisma.teamMember.create({ data: { teamId: team.id, userId: owner } });
    const project = await prisma.project.create({ data: { workspaceId, key: "OPS", name: "Ops", teamId: team.id } });
    const task = await prisma.task.create({ data: { workspaceId, projectId: project.id, number: 1, title: "Keys", position: 1, creatorId: owner } });
    const f = await file("keys.txt", { taskId: task.id, contentType: "text/plain" });
    expect(await findDownloadableFile(f.id, superId)).not.toBeNull();
    expect(await findDownloadableFile(f.id, owner)).not.toBeNull();
    expect(await findDownloadableFile(f.id, member)).toBeNull();
  });

  it("refuses the super admin without a fresh MFA proof", async () => {
    const f = await file("nomfa.txt", { contentType: "text/plain" });
    request.mfa = undefined;
    try {
      expect(await findDownloadableFile(f.id, superId)).toBeNull();
    } finally {
      request.mfa = createSuperAdminMfaProof(superId, (await prisma.user.findUniqueOrThrow({ where: { id: superId } })).sessionVersion);
    }
  });

  it("hides files of non-active organisations from members but not the super admin", async () => {
    const f = await file("suspended.txt", { contentType: "text/plain" });
    try {
      for (const status of ["SUSPENDED", "PENDING", "REJECTED"] as const) {
        await prisma.workspace.update({ where: { id: workspaceId }, data: { status } });
        expect(await findDownloadableFile(f.id, owner)).toBeNull();
        expect(await findDownloadableFile(f.id, member)).toBeNull();
        expect(await findDownloadableFile(f.id, superId)).not.toBeNull();
      }
    } finally {
      await prisma.workspace.update({ where: { id: workspaceId }, data: { status: "ACTIVE" } });
    }
    expect(await findDownloadableFile(f.id, owner)).not.toBeNull();
  });
});
