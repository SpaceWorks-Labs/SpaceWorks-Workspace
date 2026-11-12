import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { executeTool } from "@/lib/assistant/tools";
import type { Principal } from "@/lib/assistant/principal";
import { GET as listTasksApi } from "@/app/api/v1/tasks/route";
import { GET as getTaskApi } from "@/app/api/v1/tasks/[ref]/route";
import { cleanup, uniqueSuffix } from "../helpers/fixtures";
import { buildWorld, type World } from "./assistant-fixtures";

const suffix = uniqueSuffix();
let w: World;

const run = (principal: Principal, name: string, input: unknown = {}) => executeTool(principal, name, input, { via: "mcp" });
function ok<T = Record<string, unknown>>(outcome: Awaited<ReturnType<typeof run>>): T {
  if (!outcome.ok) throw new Error(`expected ok, got ${outcome.error}`);
  return outcome.result.data as T;
}
type TaskRow = { ref: string; archived: boolean; assignees: Array<{ id: string }> };
const refs = (data: { tasks: TaskRow[] }) => data.tasks.map((task) => task.ref).sort();
const member = () => w.principal(w.users.member.id, "MEMBER");

describe.sequential("MCP / REST task parity: archived, creator, email, history, comments, columns", () => {
  beforeAll(async () => {
    w = await buildWorld(suffix);
    const owner = w.users.owner.id;
    const todo = await prisma.boardColumn.findFirstOrThrow({ where: { projectId: w.projects.bot.id, category: "TODO" } });
    await prisma.boardColumn.update({ where: { id: todo.id }, data: { color: "INFO", wipLimit: 4 } });
    // BOT-1 (owner-created) is live; BOT-3 (member-created, assigned to the owner) is archived.
    await prisma.workspaceCounter.update({ where: { workspaceId_name: { workspaceId: w.a.id, name: "task" } }, data: { value: 3 } });
    const archived = await prisma.task.create({ data: { workspaceId: w.a.id, projectId: w.projects.bot.id, columnId: todo.id, number: 3, title: "Old plan", creatorId: w.users.member.id, archivedAt: new Date(), assignees: { create: { userId: owner } } } });
    await prisma.taskActivity.create({ data: { taskId: archived.id, actorId: w.users.member.id, kind: "archived" } });
    const first = await prisma.task.findFirstOrThrow({ where: { workspaceId: w.a.id, number: 1 } });
    for (let index = 0; index < 5; index += 1) {
      await prisma.taskComment.create({ data: { taskId: first.id, authorId: index % 2 ? owner : w.users.member.id, body: `Comment ${index}`, createdAt: new Date(Date.now() - (10 - index) * 60_000) } });
    }
    await prisma.taskActivity.createMany({ data: [{ taskId: first.id, actorId: owner, kind: "created" }, { taskId: first.id, actorId: w.users.member.id, kind: "priority", data: { from: "NONE", to: "HIGH" } }, { taskId: first.id, actorId: owner, kind: "commented" }] });
  });
  afterAll(async () => {
    await cleanup(w.slugs, w.domain);
    await prisma.$disconnect();
  });

  it("leaves archived tasks out unless includeArchived, and marks them", async () => {
    const live = ok<{ tasks: TaskRow[] }>(await run(member(), "sw_list_tasks", { status: "all" }));
    expect(refs(live)).not.toContain("BOT-3");
    const all = ok<{ tasks: TaskRow[] }>(await run(member(), "sw_list_tasks", { status: "all", includeArchived: true }));
    expect(refs(all)).toContain("BOT-3");
    expect(all.tasks.find((task) => task.ref === "BOT-3")?.archived).toBe(true);
    expect(all.tasks.find((task) => task.ref === "BOT-1")?.archived).toBe(false);
  });

  it("never exposes archived tasks of a private team's project, to jobs, or across workspaces", async () => {
    const hidden = await prisma.task.update({ where: { workspaceId_number: { workspaceId: w.a.id, number: 2 } }, data: { archivedAt: new Date() } });
    const all = ok<{ tasks: TaskRow[] }>(await run(member(), "sw_list_tasks", { status: "all", includeArchived: true }));
    expect(refs(all)).not.toContain("SEC-2");
    const job = w.principal(w.users.owner.id, "OWNER", "job");
    expect(refs(ok<{ tasks: TaskRow[] }>(await run(job, "sw_list_tasks", { status: "all", includeArchived: true })))).not.toContain("BOT-3");
    await prisma.task.update({ where: { id: hidden.id }, data: { archivedAt: null } });
  });

  it("filters by creator (me, id, email) and by assignee email", async () => {
    const mine = ok<{ tasks: TaskRow[] }>(await run(member(), "sw_list_tasks", { status: "all", includeArchived: true, creator: "me" }));
    expect(refs(mine)).toEqual(["BOT-3"]);
    const byId = ok<{ tasks: TaskRow[] }>(await run(member(), "sw_list_tasks", { status: "all", creator: w.users.owner.id }));
    expect(refs(byId)).toEqual(["BOT-1"]);
    const byEmail = ok<{ tasks: TaskRow[] }>(await run(member(), "sw_list_tasks", { status: "all", includeArchived: true, creator: w.users.member.email.toUpperCase() }));
    expect(refs(byEmail)).toEqual(["BOT-3"]);
    const assigned = ok<{ tasks: TaskRow[] }>(await run(member(), "sw_list_tasks", { status: "all", includeArchived: true, assignee: w.users.owner.email }));
    expect(refs(assigned)).toEqual(["BOT-3"]);
    expect(await run(member(), "sw_list_tasks", { assignee: "nobody@elsewhere.test" })).toMatchObject({ ok: false, code: "not_found" });
    // An email of someone outside this workspace never resolves.
    const stranger = await prisma.user.findFirstOrThrow({ where: { email: { startsWith: "ownerb" } } });
    expect(await run(member(), "sw_list_tasks", { creator: stranger.email })).toMatchObject({ ok: false, code: "not_found" });
  });

  it("serves the same filters over REST", async () => {
    const { token } = await w.makeToken(["read:tasks"]);
    const res = await listTasksApi(new Request(`http://localhost/api/v1/tasks?status=all&includeArchived=true&creator=${encodeURIComponent(w.users.member.email)}`, { headers: { authorization: `Bearer ${token}` } }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: TaskRow[] }).data.map((task) => task.ref)).toEqual(["BOT-3"]);
  });

  it("returns history and pages through every comment, oldest first", async () => {
    const page1 = ok<{ comments: Array<{ id: string; body: string }>; nextCommentCursor: string | null; activity: Array<{ text: string; kind: string; actor: string | null }>; latestComments: unknown[] }>(await run(member(), "sw_get_task", { ref: "BOT-1", commentLimit: 2 }));
    expect(page1.comments.map((c) => c.body)).toEqual(["Comment 0", "Comment 1"]);
    expect(page1.nextCommentCursor).toBeTruthy();
    expect(page1.latestComments).toHaveLength(5);
    const page2 = ok<{ comments: Array<{ body: string }>; nextCommentCursor: string | null }>(await run(member(), "sw_get_task", { ref: "BOT-1", commentLimit: 2, commentCursor: page1.nextCommentCursor }));
    expect(page2.comments.map((c) => c.body)).toEqual(["Comment 2", "Comment 3"]);
    const page3 = ok<{ comments: Array<{ body: string }>; nextCommentCursor: string | null }>(await run(member(), "sw_get_task", { ref: "BOT-1", commentLimit: 2, commentCursor: page2.nextCommentCursor }));
    expect(page3.comments.map((c) => c.body)).toEqual(["Comment 4"]);
    expect(page3.nextCommentCursor).toBeNull();
    expect(page1.activity.map((a) => a.kind).sort()).toEqual(["created", "priority"]);
    expect(page1.activity.find((a) => a.kind === "priority")).toMatchObject({ text: "set the priority to high", actor: "Meera" });
    expect(ok<{ activity: unknown[] }>(await run(member(), "sw_get_task", { ref: "BOT-1", activityLimit: 0 })).activity).toEqual([]);
    const { token } = await w.makeToken(["read:tasks"]);
    const res = await getTaskApi(new Request("http://localhost/api/v1/tasks/BOT-1?commentLimit=3", { headers: { authorization: `Bearer ${token}` } }), { params: Promise.resolve({ ref: "BOT-1" }) });
    expect(((await res.json()) as { data: { comments: unknown[] } }).data.comments).toHaveLength(3);
  });

  it("archives and restores through sw_archive_task", async () => {
    const restored = ok<{ archived: boolean; ref: string }>(await run(member(), "sw_archive_task", { ref: "BOT-3", archived: false }));
    expect(restored).toMatchObject({ ref: "BOT-3", archived: false });
    expect((await prisma.task.findFirstOrThrow({ where: { workspaceId: w.a.id, number: 3 } })).archivedAt).toBeNull();
    expect(refs(ok<{ tasks: TaskRow[] }>(await run(member(), "sw_list_tasks", { status: "all" })))).toContain("BOT-3");
    ok(await run(member(), "sw_archive_task", { ref: "BOT-3" }));
    expect((await prisma.task.findFirstOrThrow({ where: { workspaceId: w.a.id, number: 3 } })).archivedAt).not.toBeNull();
  });

  it("lists each board's columns with category, colour and WIP limit, and the task types", async () => {
    const data = ok<{ projects: Array<{ key: string; columns: Array<{ name: string; category: string; color: string | null; wipLimit: number | null }>; taskTypes: Array<{ name: string; default: boolean }> }> }>(await run(member(), "sw_list_projects", {}));
    const bot = data.projects.find((project) => project.key === "BOT")!;
    expect(bot.columns.length).toBeGreaterThanOrEqual(3);
    expect(bot.columns.find((column) => column.category === "TODO")).toMatchObject({ color: "INFO", wipLimit: 4 });
    expect(bot.columns.find((column) => column.category === "DONE")).toMatchObject({ color: null, wipLimit: null });
    expect(bot.taskTypes.map((type) => type.name)).toEqual(expect.arrayContaining(["Task", "Bug", "Feature"]));
    expect(bot.taskTypes.filter((type) => type.default)).toHaveLength(1);
    expect(data.projects.map((project) => project.key)).not.toContain("SEC");
  });
});
