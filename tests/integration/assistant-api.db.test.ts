import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { authenticateApiToken } from "@/lib/apiTokens";
import { GET as listTasks, POST as createTask } from "@/app/api/v1/tasks/route";
import { GET as listChannels } from "@/app/api/v1/channels/route";
import { POST as postMessage } from "@/app/api/v1/channels/[channel]/messages/route";
import { GET as getDoc } from "@/app/api/v1/docs/[docId]/route";
import { POST as mcp, GET as mcpGet } from "@/app/api/mcp/route";
import { cleanup, uniqueSuffix } from "../helpers/fixtures";
import { buildWorld, type World } from "./assistant-fixtures";

const suffix = uniqueSuffix();
let w: World;

const req = (path: string, token: string | null, init: RequestInit = {}) =>
  new Request(`http://localhost${path}`, { ...init, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } });
const jsonReq = (path: string, token: string, body: unknown, method = "POST") => req(path, token, { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });

let rpcId = 0;
const rpc = (token: string | null, method: string, rpcParams: unknown = {}) =>
  mcp(
    req("/api/mcp", token, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params: rpcParams }),
    }),
  );

describe.sequential("API tokens, /api/v1 and /api/mcp", () => {
  beforeAll(async () => {
    w = await buildWorld(suffix);
  });

  afterAll(async () => {
    await cleanup(w.slugs, w.domain);
    await prisma.$disconnect();
  });

  it("authenticates only valid, active tokens of active admins", async () => {
    const good = await w.makeToken(["read:tasks"]);
    expect(await authenticateApiToken(`Bearer ${good.token}`)).toMatchObject({ principal: { kind: "token", userId: w.users.admin.id, workspace: { id: w.a.id } }, scopes: ["read:tasks"] });
    expect(await authenticateApiToken(`Bearer ${good.token.slice(0, -1)}x`)).toBeNull();
    expect(await authenticateApiToken(null)).toBeNull();
    expect(await authenticateApiToken("Bearer nonsense")).toBeNull();
    expect((await prisma.apiToken.findUniqueOrThrow({ where: { id: good.id } })).lastUsedAt).not.toBeNull();

    const memberMade = await w.makeToken(["read:tasks"], w.users.member.id);
    expect(await authenticateApiToken(`Bearer ${memberMade.token}`)).toBeNull();

    const expiring = await w.makeToken(["read:tasks"]);
    await prisma.apiToken.update({ where: { id: expiring.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await authenticateApiToken(`Bearer ${expiring.token}`)).toBeNull();
    for (const status of ["SUSPENDED", "PENDING", "REJECTED"] as const) {
      await prisma.workspace.update({ where: { id: w.a.id }, data: { status } });
      expect(await authenticateApiToken(`Bearer ${good.token}`)).toBeNull();
    }
    await prisma.workspace.update({ where: { id: w.a.id }, data: { status: "ACTIVE" } });
    expect(await authenticateApiToken(`Bearer ${good.token}`)).not.toBeNull();
  });

  it("enforces scopes on /api/v1 and returns minimal paginated DTOs", async () => {
    const reader = await w.makeToken(["read:tasks"]);
    expect((await listTasks(req("/api/v1/tasks", null))).status).toBe(401);
    const page = await listTasks(req("/api/v1/tasks?status=all&limit=1", reader.token));
    expect(page.status).toBe(200);
    const body = (await page.json()) as { data: Array<Record<string, unknown>>; nextCursor: string | null };
    expect(body.data).toHaveLength(1);
    expect(body.nextCursor).toBeTruthy();
    expect(Object.keys(body.data[0]!)).toEqual(expect.arrayContaining(["ref", "title", "status", "url"]));
    const next = (await (await listTasks(req(`/api/v1/tasks?status=all&limit=1&cursor=${body.nextCursor}`, reader.token))).json()) as { data: Array<{ ref: string }> };
    expect(next.data[0]!.ref).not.toBe(body.data[0]!.ref);

    const denied = await createTask(jsonReq("/api/v1/tasks", reader.token, { title: "Nope" }));
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as { error: { code: string } }).error.code).toBe("FORBIDDEN");
    expect((await listChannels(req("/api/v1/channels", reader.token))).status).toBe(403);
    expect((await getDoc(req(`/api/v1/docs/${w.docs.publicDoc.id}`, reader.token), params({ docId: w.docs.publicDoc.id }))).status).toBe(403);

    // Even an admin's token never reads admin-only docs or another tenant's docs.
    const docs = await w.makeToken(["read:docs"]);
    expect((await getDoc(req(`/api/v1/docs/${w.docs.publicDoc.id}`, docs.token), params({ docId: w.docs.publicDoc.id }))).status).toBe(200);
    expect((await getDoc(req(`/api/v1/docs/${w.docs.adminDoc.id}`, docs.token), params({ docId: w.docs.adminDoc.id }))).status).toBe(404);
    expect((await getDoc(req(`/api/v1/docs/${w.docs.bDoc.id}`, docs.token), params({ docId: w.docs.bDoc.id }))).status).toBe(404);
  });

  it("creates through write scopes, audits the token and stops after revocation", async () => {
    const writer = await w.makeToken(["read:tasks", "write:tasks", "write:chat"]);
    const created = await createTask(jsonReq("/api/v1/tasks", writer.token, { title: "From a script", project: "BOT" }));
    expect(created.status).toBe(201);
    const task = ((await created.json()) as { data: { ref: string } }).data;
    expect(task.ref).toMatch(/^BOT-\d+$/);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { workspaceId: w.a.id, action: "assistant.task_created", actorApiTokenId: writer.id } });
    expect(audit.metadata).toMatchObject({ via: "api" });
    expect((await createTask(jsonReq("/api/v1/tasks", writer.token, { title: "" }))).status).toBe(400);

    const posted = await postMessage(jsonReq("/api/v1/channels/general/messages", writer.token, { text: "Printer is back" }), params({ channel: "general" }));
    expect(posted.status).toBe(201);
    const dm = await postMessage(jsonReq(`/api/v1/channels/${w.channels.dm.id}/messages`, writer.token, { text: "sneaky" }), params({ channel: w.channels.dm.id }));
    expect(dm.status).toBe(404);

    await prisma.apiToken.update({ where: { id: writer.id }, data: { revokedAt: new Date() } });
    expect((await createTask(jsonReq("/api/v1/tasks", writer.token, { title: "After revoke" }))).status).toBe(401);
  });

  it("stops a token when its creator is demoted", async () => {
    const token = await w.makeToken(["read:tasks"], w.users.admin.id);
    expect((await listTasks(req("/api/v1/tasks", token.token))).status).toBe(200);
    await prisma.membership.update({ where: { userId_workspaceId: { userId: w.users.admin.id, workspaceId: w.a.id } }, data: { role: "MEMBER" } });
    expect((await listTasks(req("/api/v1/tasks", token.token))).status).toBe(401);
    await prisma.membership.update({ where: { userId_workspaceId: { userId: w.users.admin.id, workspaceId: w.a.id } }, data: { role: "ADMIN" } });
  });

  it("serves MCP initialize, tools/list and tools/call over HTTP", async () => {
    const token = await w.makeToken(["mcp", "read:tasks", "read:docs"]);
    expect((await rpc(null, "initialize")).status).toBe(401);
    const noMcp = await w.makeToken(["read:tasks"]);
    expect((await rpc(noMcp.token, "tools/list")).status).toBe(403);
    expect((await mcpGet()).status).toBe(405);

    const init = await rpc(token.token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.status).toBe(200);
    const initBody = (await init.json()) as { result: { serverInfo: { name: string }; capabilities: { tools?: object } } };
    expect(initBody.result.serverInfo.name).toBe("space-works");
    expect(initBody.result.capabilities.tools).toBeDefined();

    const list = (await (await rpc(token.token, "tools/list")).json()) as { result: { tools: Array<{ name: string; inputSchema: { type: string }; annotations?: { readOnlyHint?: boolean } }> } };
    const names = list.result.tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["sw_list_tasks", "sw_get_task", "sw_list_docs", "sw_search_memory", "sw_search_workspace"]));
    expect(names).not.toContain("sw_create_task");
    expect(names).not.toContain("sw_list_channels");
    expect(names).not.toContain("sw_list_monitors");
    expect(list.result.tools.every((t) => t.inputSchema.type === "object" && t.annotations?.readOnlyHint === true)).toBe(true);

    const call = (await (await rpc(token.token, "tools/call", { name: "sw_list_tasks", arguments: { status: "all" } })).json()) as { result: { content: Array<{ text: string }>; isError?: boolean } };
    expect(call.result.isError).toBeFalsy();
    const tasks = JSON.parse(call.result.content[0]!.text) as { tasks: Array<{ title: string }> };
    expect(tasks.tasks.map((t) => t.title)).toContain("Calibrate servo");
    expect(tasks.tasks.map((t) => t.title)).not.toContain("Other tenant task");

    const forbidden = (await (await rpc(token.token, "tools/call", { name: "sw_create_task", arguments: { title: "x" } })).json()) as { result: { isError: boolean; content: Array<{ text: string }> } };
    expect(forbidden.result.isError).toBe(true);
    expect(forbidden.result.content[0]!.text).toContain("scope");
  });
});
