import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/auth", () => ({ auth: async () => (session.userId ? { user: { id: session.userId } } : null) }));
vi.mock("@/lib/storage", async (original) => ({ ...(await original<typeof import("@/lib/storage")>()), fileResponse: () => new Response("file-bytes") }));

import { GET as downloadFile } from "@/app/api/files/[id]/route";
import { runApiTool } from "@/lib/apiTokens/http";
import type { Principal } from "@/lib/assistant/principal";
import { executeTool, toolsForWorkspace } from "@/lib/assistant/tools";
import { prisma } from "@/lib/db";
import { invalidateLimits } from "@/lib/limits";
import { workspacesWithoutModule } from "@/lib/modules-server";
import { sendProjectUpdateReminders } from "@/lib/scheduled/projectsPlus";
import { indexSearchDocument } from "@/lib/search/documents";
import { listActivity, searchDocuments } from "@/lib/search/query";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@mgp-${suffix}.test`;
const slug = `mgp-${suffix}`;
let workspaceId: string;
let ownerId: string;
let memberId: string;
let docFileId: string;
let fundingFileId: string;
let channelId: string;
let projectId: string;

const setDisabled = async (disabledModules: string[]) => {
  await prisma.workspaceLimits.upsert({ where: { workspaceId }, create: { workspaceId, disabledModules }, update: { disabledModules } });
  invalidateLimits(workspaceId);
};
const principal = (role: "ADMIN" | "MEMBER" = "ADMIN", kind: "user" | "token" = "user"): Principal => ({
  kind, userId: ownerId, userName: "Owner", role,
  workspace: { id: workspaceId, slug, name: "Gate", timezone: "UTC", currency: "INR", financeVisibleToMembers: true },
  ...(kind === "token" ? { tokenId: "t1", scopes: ["read:tasks", "read:chat", "read:docs", "read:members", "read:finance", "mcp"] as never } : {}),
});
const actor = () => ({ workspaceId, userId: memberId, role: "MEMBER" as const });
const download = async (fileId: string, userId: string) => {
  session.userId = userId;
  return downloadFile(new Request(`https://app.test/api/files/${fileId}`), { params: Promise.resolve({ id: fileId }) } as never);
};

describe.sequential("module gating on the periphery", () => {
  beforeAll(async () => {
    ownerId = (await createUser(`owner${domain}`)).id;
    memberId = (await createUser(`member${domain}`)).id;
    workspaceId = (await createWorkspace(slug, ownerId)).id;
    await addMember(workspaceId, memberId, "MEMBER");
    const channel = await prisma.channel.findFirstOrThrow({ where: { workspaceId, kind: "PUBLIC" } });
    channelId = channel.id;
    await prisma.channelMember.upsert({ where: { channelId_userId: { channelId, userId: memberId } }, create: { channelId, userId: memberId }, update: {} }).catch(() => undefined);
    const doc = await prisma.doc.create({ data: { workspaceId, title: "Zebrafish handbook", createdById: ownerId } });
    await indexSearchDocument({ workspaceId, entityType: "doc", entityId: doc.id, title: "Zebrafish handbook", url: `/w/${slug}/docs/${doc.id}` });
    await indexSearchDocument({ workspaceId, entityType: "channel", entityId: channelId, title: "Zebrafish channel", url: `/w/${slug}/chat/${channel.slug}`, channelId });
    const file = (folder: string) => prisma.fileObject.create({ data: { workspaceId, uploadedById: ownerId, folder, filename: "a.txt", contentType: "text/plain", size: 3, storageKey: `k-${folder}-${suffix}` } });
    docFileId = (await file("/")).id;
    fundingFileId = (await file("/finance/receipts")).id;
    projectId = (await prisma.project.create({ data: { workspaceId, key: "MGP", name: "Gate project", ownerId, createdAt: new Date(Date.now() - 60 * 86_400_000) } })).id;
  });

  afterAll(async () => {
    await cleanup([slug], domain);
    await prisma.$disconnect();
  });

  it("hides search results of a disabled module and keeps the rest", async () => {
    await setDisabled([]);
    expect((await searchDocuments(actor(), "Zebrafish")).map((h) => h.entityType).sort()).toEqual(["channel", "doc"]);
    await setDisabled(["chat"]);
    expect((await searchDocuments(actor(), "Zebrafish")).map((h) => h.entityType)).toEqual(["doc"]);
    await expect(listActivity(actor())).resolves.toBeDefined();
  });

  it("drops the tools of a disabled module and refuses to run them", async () => {
    await setDisabled([]);
    expect((await toolsForWorkspace(principal())).map((t) => t.name)).toContain("sw_send_channel_message");
    expect((await executeTool(principal(), "sw_list_channels", {}, { via: "chat" })).ok).toBe(true);
    await setDisabled(["chat", "finance"]);
    const names = (await toolsForWorkspace(principal("ADMIN", "token"), { requireMcp: true })).map((t) => t.name);
    expect(names).not.toContain("sw_list_channels");
    expect(names).not.toContain("sw_finance_summary");
    expect(names).toContain("sw_list_members");
    const outcome = await executeTool(principal(), "sw_list_channels", {}, { via: "mcp" });
    expect(outcome).toMatchObject({ ok: false, code: "not_found" });
    expect((await executeTool(principal(), "sw_list_members", {}, { via: "chat" })).ok).toBe(true);
  });

  it("answers 404 from the REST API for a disabled module", async () => {
    await setDisabled(["chat"]);
    const token = { principal: principal("ADMIN", "token") } as never;
    const result = await runApiTool(token, "sw_list_channels", {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(404);
    expect((await runApiTool(token, "sw_list_members", {})).ok).toBe(true);
  });

  it("skips a disabled workspace in scheduled work", async () => {
    await setDisabled([]);
    expect(await workspacesWithoutModule("projects")).not.toContain(workspaceId);
    expect(await sendProjectUpdateReminders(new Date())).toBeGreaterThanOrEqual(1);
    await prisma.notificationEventRecord.deleteMany({ where: { workspaceId } });
    await setDisabled(["projects"]);
    expect(await workspacesWithoutModule("projects")).toContain(workspaceId);
    expect(await workspacesWithoutModule("core")).toEqual([]);
    expect(await sendProjectUpdateReminders(new Date())).toBe(0);
    expect(projectId).toBeTruthy();
  });

  it("refuses downloads of module-owned files and leaves the shared library alone", async () => {
    await setDisabled([]);
    expect((await download(docFileId, ownerId)).status).toBe(200);
    expect((await download(fundingFileId, ownerId)).status).toBe(200);
    await setDisabled(["finance"]);
    expect((await download(fundingFileId, ownerId)).status).toBe(404);
    expect((await download(docFileId, ownerId)).status).toBe(200);
    await setDisabled(["knowledge"]);
    expect((await download(docFileId, ownerId)).status).toBe(404);
  });
});
