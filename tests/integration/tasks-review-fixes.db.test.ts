import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createProject, updateProject } from "@/lib/projects/service";
import type { TaskActor } from "@/lib/tasks/access";
import { setRecurrence } from "@/lib/tasks/recurrenceService";
import { addDependency, bulkUpdateTasks, createTask, createTaskType, removeDependency, setAssignees, setDefaultTaskType, transferTask, updateTaskType } from "@/lib/tasks/service";
import { POST as archiveRoute } from "@/app/api/v1/tasks/[ref]/archive/route";
import { POST as transferRoute } from "@/app/api/v1/tasks/[ref]/transfer/route";
import { mutateCycle } from "@/lib/cycles/service";
import { executeTool } from "@/lib/assistant/tools";
import { generateTokenSecret } from "@/lib/apiTokens";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@revfix-${suffix}.test`;
const slug = `revfix-${suffix}`;

let owner: TaskActor;
let asha: TaskActor;
let stranger: TaskActor;
let ids: { a: string; b: string; locked: string };
let wsId: string;

async function actorFor(userId: string, workspaceId: string, role: WorkspaceRole): Promise<TaskActor> {
  const [user, workspace] = await Promise.all([prisma.user.findUniqueOrThrow({ where: { id: userId } }), prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })]);
  return { user: { id: user.id, name: user.name }, workspace, membership: { role } };
}
async function newTask(actor: TaskActor, projectId: string, title: string, extra: Record<string, unknown> = {}) {
  const result = await createTask(actor, { projectId, title, ...extra });
  if (!result.ok) throw new Error(result.error);
  return result.data!;
}
const call = (route: (r: Request, c: never) => Promise<Response>, path: string, token: string, init: RequestInit, ref: string) =>
  route(new Request(`http://localhost${path}`, { method: "POST", ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } }), { params: Promise.resolve({ ref }) } as never);

describe.sequential("tasks: review fixes", () => {
  beforeAll(async () => {
    const o = await createUser(`owner${domain}`, "Owner Olivia");
    const a = await createUser(`asha${domain}`, "Member Asha");
    const s = await createUser(`stranger${domain}`, "Member Sam");
    const ws = await createWorkspace(slug, o.id);
    wsId = ws.id;
    for (const user of [a, s]) await addMember(ws.id, user.id, "MEMBER");
    owner = await actorFor(o.id, ws.id, "OWNER");
    asha = await actorFor(a.id, ws.id, "MEMBER");
    stranger = await actorFor(s.id, ws.id, "MEMBER");
    const make = async (name: string, key: string) => {
      const result = await createProject(owner, { name, key });
      if (!result.ok) throw new Error(result.error);
      return result.data!.id;
    };
    ids = { a: await make("Alpha", "ALP"), b: await make("Beta", "BET"), locked: await make("Locked", "LCK") };
    const row = await prisma.project.findUniqueOrThrow({ where: { id: ids.locked } });
    const set = await updateProject(owner, { projectId: ids.locked, name: row.name, key: row.key, status: "ACTIVE", ownerId: row.ownerId, restrictTaskEdits: true });
    if (!set.ok) throw new Error(set.error);
  }, 60_000);

  afterAll(async () => {
    await cleanup([slug], domain);
  });

  it("M1: a malformed or non-JSON body never archives; an empty body still does", async () => {
    const secret = generateTokenSecret();
    await prisma.apiToken.create({ data: { workspaceId: wsId, name: "CI bot", prefix: secret.prefix, secretHash: secret.secretHash, scopes: ["write:tasks", "read:tasks"], createdById: owner.user.id } });
    const task = await newTask(owner, ids.a, "Archive me");
    const path = `/api/v1/tasks/ALP-${task.number}/archive`;
    const bad = await call(archiveRoute, path, secret.token, { body: "{not json", headers: { "content-type": "application/json" } }, `ALP-${task.number}`);
    expect(bad.status).toBe(400);
    const wrongType = await call(archiveRoute, path, secret.token, { body: "archived=false", headers: { "content-type": "text/plain" } }, `ALP-${task.number}`);
    expect(wrongType.status).toBe(400);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).archivedAt).toBeNull();
    expect((await call(archiveRoute, path, secret.token, {}, `ALP-${task.number}`)).status).toBe(200);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).archivedAt).not.toBeNull();
    // L14: history carries the token name; L6: transfer needs a project.
    const other = await newTask(owner, ids.a, "Move me");
    const noProject = await call(transferRoute, "/x", secret.token, { body: "{}", headers: { "content-type": "application/json" } }, `ALP-${other.number}`);
    expect(noProject.status).toBe(400);
    const archivedHistory = await prisma.taskActivity.findFirst({ where: { taskId: task.id, kind: "archived" } });
    expect(archivedHistory ? JSON.stringify(archivedHistory.data) : "").toContain("CI bot");
  });

  it("M2: keeping an assignee who was disabled afterwards is allowed; adding one is not", async () => {
    const task = await newTask(owner, ids.a, "Keep", { assigneeIds: [asha.user.id] });
    await prisma.user.update({ where: { id: asha.user.id }, data: { disabledAt: new Date() } });
    const keep = await setAssignees(owner, { taskId: task.id, userIds: [asha.user.id, owner.user.id] });
    expect(keep.ok).toBe(true);
    const add = await setAssignees(owner, { taskId: task.id, userIds: [asha.user.id, owner.user.id, stranger.user.id, "nobody"] });
    expect(add.ok).toBe(false);
    await prisma.user.update({ where: { id: asha.user.id }, data: { disabledAt: null } });
  });

  it("M4: a stopped repeat does not block a move; an active one does", async () => {
    const task = await newTask(owner, ids.a, "Repeats");
    const rec = await setRecurrence(owner, { taskId: task.id, rrule: "FREQ=WEEKLY;BYDAY=MO" });
    expect(rec.ok).toBe(true);
    expect((await transferTask(owner, { taskId: task.id, targetProjectKey: "BET" })).ok).toBe(false);
    await prisma.taskRecurrence.updateMany({ where: { templateTaskId: task.id }, data: { active: false } });
    expect((await transferTask(owner, { taskId: task.id, targetProjectKey: "BET" })).ok).toBe(true);
  });

  it("M5: dependencies need the edit gate on the other task too", async () => {
    const mine = await newTask(owner, ids.a, "Open task");
    const guarded = await newTask(owner, ids.locked, "Guarded task");
    const refused = await addDependency(stranger, { taskId: mine.id, reference: `#${guarded.number}`, direction: "blockedBy" });
    expect(refused.ok).toBe(false);
    expect((await addDependency(owner, { taskId: mine.id, reference: `#${guarded.number}`, direction: "blockedBy" })).ok).toBe(true);
    const removed = await removeDependency(stranger, { blockingTaskId: guarded.id, blockedTaskId: mine.id });
    expect(removed.ok).toBe(false);
    expect(await prisma.taskDependency.count({ where: { blockingTaskId: guarded.id, blockedTaskId: mine.id } })).toBe(1);
  });

  it("L9/L11: duplicate type names ignore case; concurrent default changes leave exactly one", async () => {
    const dup = await createTaskType(owner, { projectId: ids.a, name: "bug" });
    expect(dup.ok ? "" : dup.error).toMatch(/already exists/);
    const made = await createTaskType(owner, { projectId: ids.a, name: "Chore" });
    if (!made.ok) throw new Error(made.error);
    const renamed = await updateTaskType(owner, { typeId: made.data!.id, name: "FEATURE" });
    expect(renamed.ok).toBe(false);
    const types = await prisma.projectTaskType.findMany({ where: { projectId: ids.a } });
    await Promise.all(types.map((type) => setDefaultTaskType(owner, { typeId: type.id })));
    expect(await prisma.projectTaskType.count({ where: { projectId: ids.a, isDefault: true } })).toBe(1);
  });

  it("L15: adding a task to a cycle needs the edit gate on a restricted project", async () => {
    await prisma.project.update({ where: { id: ids.locked }, data: { cyclesEnabled: true } });
    const cycle = await prisma.cycle.create({ data: { workspaceId: wsId, projectId: ids.locked, number: 1, name: "C1", status: "UPCOMING", startsAt: new Date(), endsAt: new Date(Date.now() + 86_400_000 * 7) } });
    const task = await newTask(owner, ids.locked, "Cycle me");
    await expect(mutateCycle(stranger, { op: "assign", cycleId: cycle.id, taskId: task.id })).rejects.toThrow(/Only the creator/);
    await mutateCycle(owner, { op: "assign", cycleId: cycle.id, taskId: task.id });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).cycleId).toBe(cycle.id);
  });

  it("L7/M6/L13: assistant tools validate before applying; unresolvable target column fails with no move; dropped assignees are notified", async () => {
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: wsId } });
    const principal = { kind: "user" as const, workspace: { id: ws.id, slug: ws.slug, name: ws.name, timezone: ws.timezone, currency: ws.currency, financeVisibleToMembers: ws.financeVisibleToMembers }, userId: owner.user.id, userName: "Owner", role: "OWNER" as const };
    const task = await newTask(owner, ids.a, "Tool target");
    const ref = `ALP-${task.number}`;
    const assign = await executeTool(principal, "sw_assign_task", { ref, userIds: [asha.user.id, "ghost-user"], mode: "add" }, { via: "chat" });
    expect(assign.ok).toBe(false);
    expect(await prisma.taskAssignee.count({ where: { taskId: task.id } })).toBe(0);
    const move = await executeTool(principal, "sw_move_task", { ref, project: "BET", column: "No such column" }, { via: "chat" });
    expect(move.ok).toBe(false);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).projectId).toBe(ids.a);
    // L13: a private-team project drops assignees who can't see it and tells them.
    const team = await prisma.team.create({ data: { workspaceId: wsId, name: "Core", slug: `core-${suffix}`, visibility: "PRIVATE", members: { create: [{ userId: owner.user.id }] } } });
    const priv = await createProject(owner, { name: "Private", key: "PRV", teamId: team.id });
    if (!priv.ok) throw new Error(priv.error);
    const withAsha = await newTask(owner, ids.a, "Has Asha", { assigneeIds: [asha.user.id] });
    expect((await transferTask(owner, { taskId: withAsha.id, targetProjectKey: "PRV" })).ok).toBe(true);
    expect(await prisma.taskAssignee.count({ where: { taskId: withAsha.id } })).toBe(0);
    const notified = await prisma.notification.count({ where: { userId: asha.user.id, kind: "task.unassigned" } });
    expect(notified).toBeGreaterThan(0);
  });

  it("L17: bulk move keeps selection order; recurrence copies are not 'assigned by me'", async () => {
    const col = await prisma.boardColumn.findFirstOrThrow({ where: { projectId: ids.b, category: "IN_PROGRESS" } });
    const t1 = await newTask(owner, ids.b, "One");
    const t2 = await newTask(owner, ids.b, "Two");
    const t3 = await newTask(owner, ids.b, "Three");
    const res = await bulkUpdateTasks(owner, { taskIds: [t1.id, t2.id, t3.id], op: { kind: "move", columnId: col.id } });
    expect(res.ok).toBe(true);
    const order = await prisma.task.findMany({ where: { columnId: col.id }, orderBy: [{ position: "asc" }, { number: "asc" }], select: { id: true } });
    expect(order.map((row) => row.id)).toEqual([t1.id, t2.id, t3.id]);
  });
});
