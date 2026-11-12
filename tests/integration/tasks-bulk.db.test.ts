import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createProject, updateProject } from "@/lib/projects/service";
import type { TaskActor } from "@/lib/tasks/access";
import { MAX_BULK } from "@/lib/tasks/bulkSchemas";
import { bulkUpdateTasks, createTask } from "@/lib/tasks/service";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@bulk-${suffix}.test`;
const slug = `bulk-${suffix}`;

let owner: TaskActor;
let creator: TaskActor;
let stranger: TaskActor;
let projectId: string;
let columns: Array<{ id: string; name: string }>;

async function actorFor(userId: string, workspaceId: string, role: WorkspaceRole): Promise<TaskActor> {
  const [user, workspace] = await Promise.all([prisma.user.findUniqueOrThrow({ where: { id: userId } }), prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })]);
  return { user: { id: user.id, name: user.name }, workspace, membership: { role } };
}
async function newTask(as: TaskActor, title: string, assigneeIds: string[] = []) {
  const result = await createTask(as, { projectId, title, assigneeIds });
  if (!result.ok) throw new Error(result.error);
  return result.data!.id;
}
const restrict = async (on: boolean) => {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const result = await updateProject(owner, { projectId, name: project.name, key: project.key, status: "ACTIVE", ownerId: project.ownerId, restrictTaskEdits: on });
  if (!result.ok) throw new Error(result.error);
};

describe.sequential("bulk task updates", () => {
  beforeAll(async () => {
    const [ownerUser, creatorUser, strangerUser] = await Promise.all([createUser(`owner${domain}`, "Owner Olivia"), createUser(`creator${domain}`, "Creator Chris"), createUser(`stranger${domain}`, "Stranger Sam")]);
    const ws = await createWorkspace(slug, ownerUser.id);
    await addMember(ws.id, creatorUser.id, "MEMBER");
    await addMember(ws.id, strangerUser.id, "MEMBER");
    owner = await actorFor(ownerUser.id, ws.id, "OWNER");
    creator = await actorFor(creatorUser.id, ws.id, "MEMBER");
    stranger = await actorFor(strangerUser.id, ws.id, "MEMBER");
    const project = await createProject(owner, { name: "Bulk", key: "BLK" });
    if (!project.ok) throw new Error(project.error);
    projectId = project.data!.id;
    columns = await prisma.boardColumn.findMany({ where: { projectId }, orderBy: { position: "asc" }, select: { id: true, name: true } });
  }, 60_000);

  afterAll(async () => {
    await cleanup([slug], domain);
  });

  it("returns a result per task: a restricted task fails for a stranger while the rest succeed", async () => {
    await restrict(true);
    const open = await newTask(owner, "Open one", [stranger.user.id]);
    const locked = await newTask(owner, "Locked one", [creator.user.id]);
    const result = await bulkUpdateTasks(stranger, { taskIds: [open, locked], op: { kind: "priority", priority: "HIGH" } });
    expect(result.ok).toBe(true);
    const [first, second] = result.ok ? result.data!.results : [];
    expect(first).toMatchObject({ taskId: open, ok: true, ref: expect.stringMatching(/^BLK-\d+$/) });
    expect(second).toMatchObject({ taskId: locked, ok: false });
    expect(second!.error).toBeTruthy();
    expect((await prisma.task.findUniqueOrThrow({ where: { id: open } })).priority).toBe("HIGH");
    expect((await prisma.task.findUniqueOrThrow({ where: { id: locked } })).priority).toBe("NONE");
    await restrict(false);
  });

  it("moves, assigns, unassigns, claims and archives through the single-task services", async () => {
    const ids = [await newTask(creator, "A"), await newTask(creator, "B")];
    const done = columns.at(-1)!;
    expect((await bulkUpdateTasks(creator, { taskIds: ids, op: { kind: "move", columnId: done.id } })).ok).toBe(true);
    expect((await prisma.task.findMany({ where: { id: { in: ids } } })).every((task) => task.columnId === done.id)).toBe(true);
    await bulkUpdateTasks(creator, { taskIds: ids, op: { kind: "assign", userId: owner.user.id } });
    expect(await prisma.taskAssignee.count({ where: { taskId: { in: ids }, userId: owner.user.id } })).toBe(2);
    await bulkUpdateTasks(creator, { taskIds: ids, op: { kind: "unassign", userId: owner.user.id } });
    expect(await prisma.taskAssignee.count({ where: { taskId: { in: ids } } })).toBe(0);
    await bulkUpdateTasks(stranger, { taskIds: ids, op: { kind: "claim" } });
    expect(await prisma.taskAssignee.count({ where: { taskId: { in: ids }, userId: stranger.user.id } })).toBe(2);
    const archived = await bulkUpdateTasks(creator, { taskIds: ids, op: { kind: "archive" } });
    expect(archived.ok && archived.data!.results.every((row) => row.ok)).toBe(true);
    expect(await prisma.task.count({ where: { id: { in: ids }, archivedAt: { not: null } } })).toBe(2);
  });

  it("reports unknown or invisible ids as failures without touching anything", async () => {
    const result = await bulkUpdateTasks(creator, { taskIds: ["does-not-exist"], op: { kind: "archive" } });
    expect(result.ok && result.data!.results[0]).toMatchObject({ ok: false, ref: "Unknown task" });
  });

  it(`enforces the ${MAX_BULK} task cap and rejects empty or malformed input`, async () => {
    const tooMany = Array.from({ length: MAX_BULK + 1 }, (_, index) => `id${index}`);
    expect((await bulkUpdateTasks(creator, { taskIds: tooMany, op: { kind: "claim" } })).ok).toBe(false);
    expect((await bulkUpdateTasks(creator, { taskIds: [], op: { kind: "claim" } })).ok).toBe(false);
    expect((await bulkUpdateTasks(creator, { taskIds: ["x"], op: { kind: "explode" } })).ok).toBe(false);
    const exactly: string[] = [];
    for (let index = 0; index < MAX_BULK; index++) exactly.push(await newTask(creator, `Cap ${index}`));
    const result = await bulkUpdateTasks(creator, { taskIds: exactly, op: { kind: "priority", priority: "LOW" } });
    expect(result.ok && result.data!.results).toHaveLength(MAX_BULK);
    expect(result.ok && result.data!.results.every((row) => row.ok)).toBe(true);
  }, 120_000);
});
