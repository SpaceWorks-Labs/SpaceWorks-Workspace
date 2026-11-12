import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createProject, updateProject } from "@/lib/projects/service";
import type { TaskActor } from "@/lib/tasks/access";
import { getBoardData } from "@/lib/tasks/queries";
import { assignTask, claimTask, createTask, setAssignees, unassignTask, unclaimTask } from "@/lib/tasks/service";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@assign-${suffix}.test`;
const slug = `assign-${suffix}`;

let owner: TaskActor;
let creator: TaskActor;
let a: TaskActor;
let b: TaskActor;
let guest: TaskActor;
let projectId: string;
let projectKey: string;

async function actorFor(userId: string, workspaceId: string, role: WorkspaceRole): Promise<TaskActor> {
  const [user, workspace] = await Promise.all([prisma.user.findUniqueOrThrow({ where: { id: userId } }), prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })]);
  return { user: { id: user.id, name: user.name }, workspace, membership: { role } };
}

async function newTask(as: TaskActor, assigneeIds: string[] = []) {
  const result = await createTask(as, { projectId, title: `Task ${Math.random().toString(36).slice(2, 8)}`, assigneeIds });
  if (!result.ok) throw new Error(result.error);
  return result.data!.id;
}
const assigneesOf = async (taskId: string) => (await prisma.taskAssignee.findMany({ where: { taskId }, select: { userId: true } })).map((row) => row.userId).sort();
const restrict = async (on: boolean) => {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const result = await updateProject(owner, { projectId, name: project.name, key: project.key, status: "ACTIVE", ownerId: project.ownerId, restrictTaskEdits: on });
  if (!result.ok) throw new Error(result.error);
};

describe.sequential("tasks: assignment and self-assignment", () => {
  beforeAll(async () => {
    const ownerUser = await createUser(`owner${domain}`, "Owner Olivia");
    const creatorUser = await createUser(`creator${domain}`, "Creator Chris");
    const aUser = await createUser(`a${domain}`, "Member Asha");
    const bUser = await createUser(`b${domain}`, "Member Bilal");
    const guestUser = await createUser(`guest${domain}`, "Guest Gita");
    const ws = await createWorkspace(slug, ownerUser.id);
    await addMember(ws.id, creatorUser.id, "MEMBER");
    await addMember(ws.id, aUser.id, "MEMBER");
    await addMember(ws.id, bUser.id, "MEMBER");
    await addMember(ws.id, guestUser.id, "GUEST");
    owner = await actorFor(ownerUser.id, ws.id, "OWNER");
    creator = await actorFor(creatorUser.id, ws.id, "MEMBER");
    a = await actorFor(aUser.id, ws.id, "MEMBER");
    b = await actorFor(bUser.id, ws.id, "MEMBER");
    guest = await actorFor(guestUser.id, ws.id, "GUEST");
    const project = await createProject(owner, { name: "Assignment", key: "ASG" });
    if (!project.ok) throw new Error(project.error);
    projectId = project.data!.id;
    projectKey = project.data!.key;
  }, 60_000);

  afterAll(async () => {
    await cleanup([slug], domain);
  });

  it("restricted project: two members claiming an unassigned task leaves exactly one assignee", async () => {
    await restrict(true);
    const taskId = await newTask(creator);
    const results = await Promise.all([claimTask(a, { taskId }), claimTask(b, { taskId })]);
    expect(results.filter((result) => result.ok && result.data!.assigneeIds.length === 1)).toHaveLength(2 - results.filter((result) => !result.ok).length);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    expect(await assigneesOf(taskId)).toHaveLength(1);
    expect(await prisma.taskActivity.count({ where: { taskId, kind: "assigned" } })).toBe(1);
  });

  it("records the actor's source on non-assignment history too", async () => {
    await restrict(false);
    const via = { ...creator, via: { source: "mcp" as const, client: "Cursor" } };
    const taskId = await newTask(via);
    const created = await prisma.taskActivity.findFirstOrThrow({ where: { taskId, kind: "created" } });
    expect(created.data).toMatchObject({ source: "mcp", client: "Cursor" });
  });

  it("claims are idempotent, record who assigned, and unclaim removes only me", async () => {
    await restrict(false);
    const taskId = await newTask(creator);
    expect((await claimTask(a, { taskId })).ok).toBe(true);
    expect((await claimTask(a, { taskId })).ok).toBe(true);
    expect(await prisma.taskActivity.count({ where: { taskId, kind: "assigned" } })).toBe(1);
    const row = await prisma.taskAssignee.findFirstOrThrow({ where: { taskId } });
    expect(row.assignedById).toBe(a.user.id);
    const activity = await prisma.taskActivity.findFirstOrThrow({ where: { taskId, kind: "assigned" } });
    expect(activity.data).toMatchObject({ userIds: [a.user.id], claimed: true, source: "web" });
    expect((await assignTask(a, { taskId, userId: b.user.id })).ok).toBe(true);
    expect((await prisma.taskAssignee.findUniqueOrThrow({ where: { taskId_userId: { taskId, userId: b.user.id } } })).assignedById).toBe(a.user.id);
    expect((await unclaimTask(a, { taskId })).ok).toBe(true);
    expect((await unclaimTask(a, { taskId })).ok).toBe(true);
    expect(await assigneesOf(taskId)).toEqual([b.user.id]);
    expect(await prisma.taskActivity.count({ where: { taskId, kind: "unassigned" } })).toBe(1);
  });

  it("concurrent adds from two actors keep both people", async () => {
    await restrict(false);
    const taskId = await newTask(creator);
    const [r1, r2] = await Promise.all([assignTask(a, { taskId, userId: a.user.id }), assignTask(b, { taskId, userId: b.user.id })]);
    expect(r1.ok && r2.ok).toBe(true);
    expect(await assigneesOf(taskId)).toEqual([a.user.id, b.user.id].sort());
    const [s1, s2] = await Promise.all([setAssignees(creator, { taskId, userIds: [a.user.id, b.user.id, owner.user.id] }), assignTask(a, { taskId, userId: creator.user.id })]);
    expect(s1.ok && s2.ok).toBe(true);
    expect((await assigneesOf(taskId)).length).toBeGreaterThanOrEqual(3);
  });

  it("notifies added and removed people, but not the actor", async () => {
    await restrict(false);
    const taskId = await newTask(creator);
    const count = (userId: string, kind: string) => prisma.notification.count({ where: { userId, kind } });
    const [assignedA, assignedC, unassignedA, unassignedC] = [await count(a.user.id, "task.assigned"), await count(creator.user.id, "task.assigned"), await count(a.user.id, "task.unassigned"), await count(creator.user.id, "task.unassigned")];
    await setAssignees(creator, { taskId, userIds: [a.user.id, creator.user.id] });
    expect(await count(a.user.id, "task.assigned")).toBe(assignedA + 1);
    expect(await count(creator.user.id, "task.assigned")).toBe(assignedC);
    await unassignTask(creator, { taskId, userId: a.user.id });
    expect(await count(a.user.id, "task.unassigned")).toBe(unassignedA + 1);
    await unassignTask(creator, { taskId, userId: creator.user.id });
    expect(await count(creator.user.id, "task.unassigned")).toBe(unassignedC);
  });

  it("restricted project: claim only when nobody is assigned; outsiders cannot manage others", async () => {
    await restrict(true);
    const taken = await newTask(creator, [a.user.id]);
    const claim = await claimTask(b, { taskId: taken });
    expect(claim.ok).toBe(false);
    expect((await assignTask(b, { taskId: taken, userId: owner.user.id })).ok).toBe(false);
    expect((await unassignTask(b, { taskId: taken, userId: a.user.id })).ok).toBe(false);
    expect((await unassignTask(a, { taskId: taken, userId: a.user.id })).ok).toBe(true);
    expect((await claimTask(b, { taskId: taken })).ok).toBe(true);
    expect((await setAssignees(owner, { taskId: taken, userIds: [a.user.id] })).ok).toBe(true);
  });

  it("guests and non-members cannot claim or be assigned", async () => {
    await restrict(false);
    const taskId = await newTask(creator);
    expect((await claimTask(guest, { taskId })).ok).toBe(false);
    expect((await assignTask(creator, { taskId, userId: guest.user.id })).ok).toBe(false);
    expect(await assigneesOf(taskId)).toEqual([]);
  });

  it("board DTO carries per-task rights that follow the restriction", async () => {
    await restrict(true);
    const taskId = await newTask(creator, [a.user.id]);
    const asB = (await getBoardData(b, projectKey))!.tasks.find((task) => task.id === taskId)!;
    expect(asB).toMatchObject({ canEdit: false, canClaim: false, isAssignedToMe: false });
    const asA = (await getBoardData(a, projectKey))!.tasks.find((task) => task.id === taskId)!;
    expect(asA).toMatchObject({ canEdit: true, canUnclaim: true, isAssignedToMe: true });
    await restrict(false);
    const open = (await getBoardData(b, projectKey))!.tasks.find((task) => task.id === taskId)!;
    expect(open).toMatchObject({ canEdit: true, canClaim: true });
  });

  it("only someone who can manage the project can toggle the restriction", async () => {
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const denied = await updateProject(a, { projectId, name: project.name, key: project.key, status: "ACTIVE", ownerId: project.ownerId, restrictTaskEdits: true });
    expect(denied.ok).toBe(false);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).restrictTaskEdits).toBe(false);
  });
});
