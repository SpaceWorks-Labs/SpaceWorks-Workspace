import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createProject, setProjectArchived, updateProject } from "@/lib/projects/service";
import type { TaskActor } from "@/lib/tasks/access";
import { canonicalTaskRedirect } from "@/lib/tasks/links";
import { createTask, previewTransfer, setTaskArchived, transferTask } from "@/lib/tasks/service";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@xfer-${suffix}.test`;
const slug = `xfer-${suffix}`;

let owner: TaskActor;
let asha: TaskActor;
let bilal: TaskActor;
let stranger: TaskActor;
let ids: { src: string; dst: string; priv: string; archived: string; bare: string };

async function actorFor(userId: string, workspaceId: string, role: WorkspaceRole): Promise<TaskActor> {
  const [user, workspace] = await Promise.all([prisma.user.findUniqueOrThrow({ where: { id: userId } }), prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })]);
  return { user: { id: user.id, name: user.name }, workspace, membership: { role } };
}
const column = (projectId: string, name: string) => prisma.boardColumn.findFirstOrThrow({ where: { projectId, name } });
async function newTask(projectId: string, columnName: string, extra: { assignees?: string[]; parentId?: string } = {}) {
  const col = extra.parentId ? null : await column(projectId, columnName);
  const result = await createTask(owner, { projectId: extra.parentId ? undefined : projectId, columnId: col?.id, parentId: extra.parentId, title: `T ${Math.random().toString(36).slice(2, 7)}`, assigneeIds: extra.assignees ?? [] });
  if (!result.ok) throw new Error(result.error);
  return result.data!.id;
}

describe.sequential("tasks: moving a task to another project", () => {
  beforeAll(async () => {
    const o = await createUser(`owner${domain}`, "Owner Olivia");
    const a = await createUser(`asha${domain}`, "Member Asha");
    const b = await createUser(`bilal${domain}`, "Member Bilal");
    const s = await createUser(`stranger${domain}`, "Member Sam");
    const ws = await createWorkspace(slug, o.id);
    for (const user of [a, b, s]) await addMember(ws.id, user.id, "MEMBER");
    owner = await actorFor(o.id, ws.id, "OWNER");
    asha = await actorFor(a.id, ws.id, "MEMBER");
    bilal = await actorFor(b.id, ws.id, "MEMBER");
    stranger = await actorFor(s.id, ws.id, "MEMBER");
    const team = await prisma.team.create({ data: { workspaceId: ws.id, name: "Core", slug: `core-${suffix}`, visibility: "PRIVATE", members: { create: [{ userId: o.id }, { userId: a.id }] } } });
    const make = async (name: string, key: string, extra: Record<string, unknown> = {}) => {
      const result = await createProject(owner, { name, key, ...extra });
      if (!result.ok) throw new Error(result.error);
      return result.data!.id;
    };
    ids = { src: await make("Source", "SRC"), dst: await make("Destination", "DST"), priv: await make("Private", "PRV", { teamId: team.id }), archived: await make("Frozen", "FRZ"), bare: await make("Bare", "BAR", { template: "simple" }) };
    await prisma.boardColumn.deleteMany({ where: { projectId: ids.bare, category: "DONE" } });
    await setProjectArchived(owner, { projectId: ids.archived }, true);
  }, 60_000);

  afterAll(async () => {
    await cleanup([slug], domain);
  });

  it("moves a finished task with subtasks, remapping column, type and assignees and clearing links", async () => {
    const taskId = await newTask(ids.src, "Done", { assignees: [asha.user.id, bilal.user.id] });
    const subId = await newTask(ids.src, "", { parentId: taskId, assignees: [bilal.user.id] });
    const existing = await newTask(ids.priv, "Done");
    const bug = await prisma.projectTaskType.findFirstOrThrow({ where: { projectId: ids.src, name: "Bug" } });
    await prisma.task.update({ where: { id: taskId }, data: { typeId: bug.id } });
    const cycle = await prisma.cycle.create({ data: { workspaceId: owner.workspace.id, projectId: ids.src, number: 1, startsAt: new Date(), endsAt: new Date(Date.now() + 864e5) } });
    await prisma.task.update({ where: { id: taskId }, data: { cycleId: cycle.id } });
    const milestone = await prisma.projectMilestone.create({ data: { workspaceId: owner.workspace.id, projectId: ids.src, name: "Alpha", targetOn: new Date() } });
    await prisma.projectMilestoneTask.create({ data: { workspaceId: owner.workspace.id, projectId: ids.src, milestoneId: milestone.id, taskId } });
    await prisma.task.update({ where: { id: taskId }, data: { completedAt: new Date("2026-01-01T00:00:00Z") } });
    const before = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });

    const preview = await previewTransfer(owner, { taskId, targetProjectKey: "prv" });
    expect(preview).toMatchObject({ ok: true, data: { columnName: "Done", milestoneLinks: 1, clearsCycle: true, subtaskCount: 1, droppedAssigneeIds: [bilal.user.id] } });

    const result = await transferTask(owner, { taskId, targetProjectKey: "PRV" });
    expect(result).toMatchObject({ ok: true, data: { key: "PRV", reference: `PRV-${before.number}`, url: `/w/${slug}/projects/PRV/${before.number}` } });
    const after = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    const done = await column(ids.priv, "Done");
    const target = await prisma.projectTaskType.findFirstOrThrow({ where: { projectId: ids.priv, name: "Bug" } });
    expect(after).toMatchObject({ projectId: ids.priv, columnId: done.id, cycleId: null, typeId: target.id, number: before.number });
    expect(after.position).toBeGreaterThan((await prisma.task.findUniqueOrThrow({ where: { id: existing } })).position);
    expect(after.completedAt?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(await prisma.projectMilestoneTask.count({ where: { taskId } })).toBe(0);
    expect(await prisma.taskAssignee.findMany({ where: { taskId } }).then((rows) => rows.map((row) => row.userId))).toEqual([asha.user.id]);
    const sub = await prisma.task.findUniqueOrThrow({ where: { id: subId } });
    expect(sub).toMatchObject({ projectId: ids.priv, columnId: null, parentId: taskId });
    expect(await prisma.taskAssignee.count({ where: { taskId: subId } })).toBe(0);
    const history = await prisma.taskActivity.findFirstOrThrow({ where: { taskId, kind: "transferred" } });
    expect(history.data).toMatchObject({ from: { key: "SRC", name: "Source" }, to: { key: "PRV", name: "Private" }, droppedAssignees: [bilal.user.id], source: "web" });
    const doc = await prisma.searchDocument.findFirst({ where: { workspaceId: owner.workspace.id, entityType: "task", entityId: taskId } });
    expect(doc).toMatchObject({ projectId: ids.priv, url: `/w/${slug}/projects/PRV/${before.number}` });
  });

  it("syncs completedAt with the target column and falls back to the first To do column", async () => {
    const active = await newTask(ids.src, "In progress");
    expect((await transferTask(owner, { taskId: active, targetProjectKey: "DST" })).ok).toBe(true);
    expect(await prisma.task.findUniqueOrThrow({ where: { id: active }, include: { column: true } })).toMatchObject({ completedAt: null, column: { name: "In progress" } });
    const finished = await newTask(ids.src, "Done");
    await prisma.task.update({ where: { id: finished }, data: { completedAt: new Date() } });
    expect((await transferTask(owner, { taskId: finished, targetProjectKey: "BAR" })).ok).toBe(true);
    expect(await prisma.task.findUniqueOrThrow({ where: { id: finished }, include: { column: true } })).toMatchObject({ completedAt: null, column: { name: "To do" } });
  });

  it("drops the type when the target has no type of that name", async () => {
    const custom = await prisma.projectTaskType.create({ data: { workspaceId: owner.workspace.id, projectId: ids.src, name: "Spike", position: 9 } });
    const taskId = await newTask(ids.src, "To do");
    await prisma.task.update({ where: { id: taskId }, data: { typeId: custom.id } });
    expect((await transferTask(owner, { taskId, targetProjectKey: "DST" })).ok).toBe(true);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).typeId).toBeNull();
  });

  it("refuses subtasks, repeating templates, the same project, archived and unseen targets", async () => {
    const parent = await newTask(ids.src, "To do");
    const sub = await newTask(ids.src, "", { parentId: parent });
    expect(await transferTask(owner, { taskId: sub, targetProjectKey: "DST" })).toMatchObject({ ok: false, error: "This is a subtask. Move the parent task instead." });
    const template = await newTask(ids.src, "To do");
    await prisma.taskRecurrence.create({ data: { workspaceId: owner.workspace.id, templateTaskId: template, rrule: "FREQ=WEEKLY", assigneeRule: { type: "FIXED", userIds: [] } } });
    expect(await transferTask(owner, { taskId: template, targetProjectKey: "DST" })).toMatchObject({ ok: false, error: expect.stringContaining("repeating") });
    expect(await transferTask(owner, { taskId: parent, targetProjectKey: "SRC" })).toMatchObject({ ok: false, error: "This task is already in that project." });
    expect(await transferTask(owner, { taskId: parent, targetProjectKey: "FRZ" })).toMatchObject({ ok: false, error: "This project is archived. Restore it to make changes." });
    expect(await transferTask(bilal, { taskId: parent, targetProjectKey: "PRV" })).toMatchObject({ ok: false, error: "That project doesn't exist or you can't see it." });
    expect(await transferTask(owner, { taskId: parent, targetProjectKey: "NOPE" })).toMatchObject({ ok: false });
    await setTaskArchived(owner, { taskId: parent, archived: true });
    expect((await transferTask(owner, { taskId: parent, targetProjectKey: "DST" })).ok).toBe(false);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: sub } })).projectId).toBe(ids.src);
  });

  it("applies the restricted-edit rule on the source task", async () => {
    const project = await prisma.project.findUniqueOrThrow({ where: { id: ids.src } });
    expect((await updateProject(owner, { projectId: ids.src, name: project.name, key: project.key, status: "ACTIVE", ownerId: project.ownerId, restrictTaskEdits: true })).ok).toBe(true);
    const taskId = await newTask(ids.src, "To do");
    expect((await transferTask(stranger, { taskId, targetProjectKey: "DST" })).ok).toBe(false);
    expect((await transferTask(owner, { taskId, targetProjectKey: "DST" })).ok).toBe(true);
  });

  it("old links resolve to the task's current project", async () => {
    expect(canonicalTaskRedirect(slug, "SRC", { number: 5, projectKey: "DST" })).toBe(`/w/${slug}/projects/DST/5`);
    expect(canonicalTaskRedirect(slug, "DST", { number: 5, projectKey: "DST" })).toBeNull();
  });
});
