import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { executeTool } from "@/lib/assistant/tools";
import type { Principal } from "@/lib/assistant/principal";
import { POST as createTask } from "@/app/api/v1/tasks/route";
import { PATCH as patchTask } from "@/app/api/v1/tasks/[ref]/route";
import { POST as postComment } from "@/app/api/v1/tasks/[ref]/comments/route";
import { POST as claim, DELETE as unclaim } from "@/app/api/v1/tasks/[ref]/claim/route";
import { POST as archive } from "@/app/api/v1/tasks/[ref]/archive/route";
import { cleanup, uniqueSuffix } from "../helpers/fixtures";
import { buildWorld, type World } from "./assistant-fixtures";

const suffix = uniqueSuffix();
let w: World;

const run = (principal: Principal, name: string, input: unknown = {}, via: "chat" | "mcp" = "mcp") => executeTool(principal, name, input, { via });
function ok<T = Record<string, unknown>>(outcome: Awaited<ReturnType<typeof run>>): T {
  if (!outcome.ok) throw new Error(`expected ok, got ${outcome.error}`);
  return outcome.result.data as T;
}
const member = () => w.principal(w.users.member.id, "MEMBER");
const api = (path: string, token: string, body?: unknown, method = "POST") =>
  new Request(`http://localhost${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
const ref = <T extends string>(r: T) => ({ params: Promise.resolve({ ref: r }) });

describe.sequential("MCP / REST task parity with the services", () => {
  beforeAll(async () => {
    w = await buildWorld(suffix);
  });
  afterAll(async () => {
    await cleanup(w.slugs, w.domain);
    await prisma.$disconnect();
  });

  it("creates at a fractional board position after existing tasks, with provenance", async () => {
    const first = ok<{ ref: string }>(await run(member(), "sw_create_task", { title: "First", project: "BOT" }));
    const second = ok<{ ref: string }>(await run(member(), "sw_create_task", { title: "Second", project: "BOT" }));
    const rows = await prisma.task.findMany({ where: { workspaceId: w.a.id, title: { in: ["Calibrate servo", "First", "Second"] } }, orderBy: { position: "asc" } });
    expect(rows.map((r) => r.title)).toEqual(["Calibrate servo", "First", "Second"]);
    expect(rows[2]!.position).toBeLessThan(1_000_000);
    expect(rows[2]!.position - rows[1]!.position).toBe(1024);
    expect(second.ref).not.toBe(first.ref);
  });

  it("refuses disabled members as assignees", async () => {
    await prisma.user.update({ where: { id: w.users.admin.id }, data: { disabledAt: new Date() } });
    const denied = await run(member(), "sw_create_task", { title: "No", project: "BOT", assignees: [w.users.admin.id] });
    expect(denied).toMatchObject({ ok: false, code: "invalid" });
    await prisma.user.update({ where: { id: w.users.admin.id }, data: { disabledAt: null } });
  });

  it("rejects writes in archived projects with a conflict", async () => {
    await prisma.project.update({ where: { id: w.projects.bot.id }, data: { status: "ARCHIVED" } });
    expect(await run(member(), "sw_update_task", { ref: "BOT-1", title: "Nope" })).toMatchObject({ ok: false, code: "conflict" });
    expect(await run(member(), "sw_assign_task", { ref: "BOT-1", userIds: ["me"] })).toMatchObject({ ok: false, code: "conflict" });
    expect(await run(member(), "sw_move_task", { ref: "BOT-1", status: "done" })).toMatchObject({ ok: false, code: "conflict" });
    await prisma.project.update({ where: { id: w.projects.bot.id }, data: { status: "ACTIVE" } });
  });

  it("parses date-only due dates in the workspace time zone", async () => {
    const p = { ...member(), workspace: { ...member().workspace, timezone: "Asia/Kolkata" } };
    const task = ok<{ dueAt: string }>(await run(p, "sw_create_task", { title: "Dated", dueAt: "2026-11-02" }));
    expect(task.dueAt).toBe("2026-11-01T18:30:00.000Z");
    const cleared = ok<{ dueAt: string | null }>(await run(p, "sw_update_task", { ref: "#" + (await prisma.task.findFirstOrThrow({ where: { title: "Dated" } })).number, dueAt: null }));
    expect(cleared.dueAt).toBeNull();
  });

  it("completing via update unblocks dependants like the app path, and logs granular history", async () => {
    const blocked = ok<{ ref: string }>(await run(member(), "sw_create_task", { title: "Blocked", project: "BOT", assignees: [w.users.owner.id] }));
    const blocker = await prisma.task.findFirstOrThrow({ where: { workspaceId: w.a.id, number: 1 } });
    const blockedRow = await prisma.task.findFirstOrThrow({ where: { workspaceId: w.a.id, title: "Blocked" } });
    await prisma.taskDependency.create({ data: { workspaceId: w.a.id, blockingTaskId: blocker.id, blockedTaskId: blockedRow.id, type: "BLOCKS" } });
    const done = ok<{ status: string }>(await run(member(), "sw_update_task", { ref: "BOT-1", status: "done" }));
    expect(done.status).toBe("done");
    expect(await prisma.taskActivity.count({ where: { taskId: blockedRow.id, kind: "unblocked" } })).toBe(1);
    expect(await prisma.taskActivity.count({ where: { taskId: blocker.id, kind: { in: ["moved", "completed"] } } })).toBeGreaterThan(0);
    expect(blocked.ref).toContain("BOT-");
  });

  it("adds comments, archives, moves, assigns and claims through the services", async () => {
    const created = ok<{ ref: string }>(await run(member(), "sw_create_task", { title: "Flow", project: "BOT" }));
    const r = created.ref;
    expect(ok<{ commentId: string }>(await run(member(), "sw_add_comment", { ref: r, body: "Looks good" })).commentId).toBeTruthy();
    expect(await prisma.taskActivity.count({ where: { kind: "commented", task: { workspaceId: w.a.id, title: "Flow" } } })).toBe(1);

    const moved = ok<{ column: string }>(await run(member(), "sw_move_task", { ref: r, column: "in progress", position: "top" }));
    expect(moved.column).toMatch(/progress/i);
    expect(await run(member(), "sw_move_task", { ref: r })).toMatchObject({ ok: false });

    const added = ok<{ assignees: Array<{ id: string }> }>(await run(member(), "sw_assign_task", { ref: r, userIds: ["me", w.users.owner.id] }));
    expect(added.assignees.map((a) => a.id).sort()).toEqual([w.users.member.id, w.users.owner.id].sort());
    const removed = ok<{ assignees: Array<{ id: string }> }>(await run(member(), "sw_assign_task", { ref: r, userIds: ["me"], mode: "remove" }));
    expect(removed.assignees.map((a) => a.id)).toEqual([w.users.owner.id]);
    const set = ok<{ assignees: Array<{ id: string }> }>(await run(member(), "sw_update_task", { ref: r, assignees: ["me"] }));
    expect(set.assignees.map((a) => a.id)).toEqual([w.users.member.id]);
    const released = ok<{ assignees: unknown[] }>(await run(member(), "sw_claim_task", { ref: r, release: true }));
    expect(released.assignees).toEqual([]);
    expect(ok<{ assignees: unknown[] }>(await run(member(), "sw_claim_task", { ref: r })).assignees).toHaveLength(1);

    ok(await run(member(), "sw_archive_task", { ref: r }));
    expect((await prisma.task.findFirstOrThrow({ where: { title: "Flow" } })).archivedAt).not.toBeNull();
    expect(await run(member(), "sw_add_comment", { ref: r, body: "late" })).toMatchObject({ ok: false, code: "conflict" });
    ok(await run(member(), "sw_archive_task", { ref: r, archived: false }));
    expect((await prisma.task.findFirstOrThrow({ where: { title: "Flow" } })).archivedAt).toBeNull();
    const kinds = (await prisma.taskActivity.findMany({ where: { task: { title: "Flow" } } })).map((a) => a.kind);
    expect(kinds).toEqual(expect.arrayContaining(["created", "commented", "moved", "assigned", "archived", "restored"]));
  });

  it("enforces roles, scopes and tenancy on the new tools", async () => {
    const guest = w.principal(w.users.guest.id, "GUEST");
    for (const [name, input] of [["sw_add_comment", { ref: "BOT-1", body: "x" }], ["sw_claim_task", { ref: "BOT-1" }], ["sw_move_task", { ref: "BOT-1", status: "done" }]] as const) {
      expect(await run(guest, name, input)).toMatchObject({ ok: false, code: "forbidden" });
    }
    const readOnly = w.principal(w.users.admin.id, "ADMIN", "token", { scopes: ["read:tasks", "mcp"], tokenId: "t" });
    expect(await run(readOnly, "sw_archive_task", { ref: "BOT-1" })).toMatchObject({ ok: false, code: "forbidden" });
    expect(await run(member(), "sw_assign_task", { ref: "SEC-2", userIds: ["me"] })).toMatchObject({ ok: false, code: "not_found" });
  });

  it("serves the same writes over REST with the right status codes", async () => {
    const { token } = await w.makeToken(["read:tasks", "write:tasks"]);
    const created = await createTask(api("/api/v1/tasks", token, { title: "Via REST", project: "BOT", dueAt: "2026-12-01" }));
    expect(created.status).toBe(201);
    const { data } = (await created.json()) as { data: { ref: string } };
    const patched = await patchTask(api(`/api/v1/tasks/${data.ref}`, token, { status: "in_progress", assignees: ["me"] }, "PATCH"), ref(data.ref));
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { data: { status: string } }).data.status).toBe("in progress");
    expect((await postComment(api(`/api/v1/tasks/${data.ref}/comments`, token, { body: "hi" }), ref(data.ref))).status).toBe(201);
    expect((await unclaim(api(`/api/v1/tasks/${data.ref}/claim`, token, undefined, "DELETE"), ref(data.ref))).status).toBe(200);
    expect((await claim(api(`/api/v1/tasks/${data.ref}/claim`, token), ref(data.ref))).status).toBe(200);
    expect((await archive(api(`/api/v1/tasks/${data.ref}/archive`, token), ref(data.ref))).status).toBe(200);
    expect((await postComment(api(`/api/v1/tasks/${data.ref}/comments`, token, { body: "late" }), ref(data.ref))).status).toBe(409);
    expect((await postComment(api(`/api/v1/tasks/BOT-9999/comments`, token, { body: "x" }), ref("BOT-9999"))).status).toBe(404);
    const dueRow = await prisma.task.findFirstOrThrow({ where: { title: "Via REST" } });
    expect(dueRow.dueAt?.toISOString()).toBe("2026-11-30T18:30:00.000Z");
  });
});
