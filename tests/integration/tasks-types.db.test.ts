import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createProject } from "@/lib/projects/service";
import type { TaskActor } from "@/lib/tasks/access";
import { getBoardData, getTaskDetail } from "@/lib/tasks/queries";
import { createTask, createTaskType, deleteTaskType, listTaskTypes, reorderTaskTypes, setDefaultTaskType, updateTask, updateTaskType } from "@/lib/tasks/service";
import { ensureDefaultTaskTypes } from "@/lib/tasks/service/types";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@types-${suffix}.test`;
const slug = `types-${suffix}`;

let owner: TaskActor;
let member: TaskActor;
let projectId: string;
let otherProjectId: string;

async function actorFor(userId: string, workspaceId: string, role: WorkspaceRole): Promise<TaskActor> {
  const [user, workspace] = await Promise.all([prisma.user.findUniqueOrThrow({ where: { id: userId } }), prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })]);
  return { user: { id: user.id, name: user.name }, workspace, membership: { role } };
}
const types = async (id = projectId) => {
  const result = await listTaskTypes(owner, id);
  if (!result.ok) throw new Error(result.error);
  return result.data!.types;
};
const idOf = async (name: string, id = projectId) => (await types(id)).find((type) => type.name === name)!.id;

describe.sequential("tasks: per-project task types", () => {
  beforeAll(async () => {
    const ownerUser = await createUser(`owner${domain}`, "Owner Olivia");
    const memberUser = await createUser(`member${domain}`, "Member Mira");
    const ws = await createWorkspace(slug, ownerUser.id);
    await addMember(ws.id, memberUser.id, "MEMBER");
    owner = await actorFor(ownerUser.id, ws.id, "OWNER");
    member = await actorFor(memberUser.id, ws.id, "MEMBER");
    const one = await createProject(owner, { name: "Types", key: "TYP" });
    const two = await createProject(owner, { name: "Other", key: "OTH" });
    if (!one.ok || !two.ok) throw new Error("project setup failed");
    projectId = one.data!.id;
    otherProjectId = two.data!.id;
  }, 60_000);

  afterAll(async () => {
    await cleanup([slug], domain);
  });

  it("creates Task, Bug and Feature lazily and idempotently", async () => {
    expect(await prisma.projectTaskType.count({ where: { projectId } })).toBe(0);
    expect((await types()).map((type) => [type.name, type.isDefault])).toEqual([["Task", true], ["Bug", false], ["Feature", false]]);
    await Promise.all([ensureDefaultTaskTypes(owner.workspace.id, projectId), ensureDefaultTaskTypes(owner.workspace.id, projectId)]);
    await types();
    expect(await prisma.projectTaskType.count({ where: { projectId } })).toBe(3);
  });

  it("only people who manage the project change its types", async () => {
    expect((await createTaskType(member, { projectId, name: "Spike" })).ok).toBe(false);
    expect((await updateTaskType(member, { typeId: await idOf("Bug"), name: "Defect" })).ok).toBe(false);
  });

  it("creates, renames, recolours and re-icons a type, and refuses duplicate names", async () => {
    const created = await createTaskType(owner, { projectId, name: "Chore", tone: "WARNING", icon: "CHORE" });
    expect(created.ok).toBe(true);
    const id = created.ok ? created.data!.id : "";
    expect((await createTaskType(owner, { projectId, name: "Chore" })).ok).toBe(false);
    expect((await updateTaskType(owner, { typeId: id, name: "Housekeeping", tone: "ACCENT", icon: "DOCS" })).ok).toBe(true);
    expect(await prisma.projectTaskType.findUniqueOrThrow({ where: { id } })).toMatchObject({ name: "Housekeeping", tone: "ACCENT", icon: "DOCS" });
    expect((await updateTaskType(owner, { typeId: id, name: "Bug" })).ok).toBe(false);
  });

  it("switches the default, reorders, and keeps one default", async () => {
    const feature = await idOf("Feature");
    expect((await setDefaultTaskType(owner, { typeId: feature })).ok).toBe(true);
    expect((await types()).filter((type) => type.isDefault).map((type) => type.name)).toEqual(["Feature"]);
    expect((await setDefaultTaskType(owner, { typeId: await idOf("Task") })).ok).toBe(true);
    const ids = (await types()).map((type) => type.id).reverse();
    expect((await reorderTaskTypes(owner, { projectId, typeIds: ids })).ok).toBe(true);
    expect((await types()).map((type) => type.id)).toEqual(ids);
    expect((await reorderTaskTypes(owner, { projectId, typeIds: ids.slice(1) })).ok).toBe(false);
  });

  it("sets a task's type, records type_changed with names, and validates the project", async () => {
    const created = await createTask(owner, { projectId, title: "Typed" });
    const taskId = created.ok ? created.data!.id : "";
    const taskRow = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(taskRow.typeId).toBe(await idOf("Task"));
    const bug = await idOf("Bug");
    expect((await updateTask(owner, { taskId, typeId: bug })).ok).toBe(true);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).typeId).toBe(bug);
    const history = await prisma.taskActivity.findFirstOrThrow({ where: { taskId, kind: "type_changed" } });
    expect(history.data).toMatchObject({ from: "Task", to: "Bug" });
    expect((await updateTask(owner, { taskId, typeId: bug })).ok).toBe(true);
    expect(await prisma.taskActivity.count({ where: { taskId, kind: "type_changed" } })).toBe(1);
    const foreign = await idOf("Bug", otherProjectId);
    expect((await updateTask(owner, { taskId, typeId: foreign })).ok).toBe(false);
    expect((await createTask(owner, { projectId, title: "Bad type", typeId: foreign })).ok).toBe(false);
    expect((await createTask(owner, { projectId, title: "Good type", typeId: bug })).ok).toBe(true);
    expect((await updateTask(owner, { taskId, typeId: null })).ok).toBe(true);
    expect((await prisma.taskActivity.findFirstOrThrow({ where: { taskId, kind: "type_changed" }, orderBy: { createdAt: "desc" } })).data).toMatchObject({ from: "Bug", to: "Task" });
  });

  it("exposes the effective type in board and detail data", async () => {
    const board = await getBoardData(owner, "TYP");
    expect(board!.taskTypes.map((type) => type.name)).toContain("Bug");
    const bugId = await idOf("Bug");
    expect(board!.tasks.some((task) => task.typeId === bugId)).toBe(true);
    const legacy = await prisma.task.create({ data: { workspaceId: owner.workspace.id, projectId, number: 9_001, title: "Legacy", creatorId: owner.user.id } });
    const detail = await getTaskDetail(owner, legacy.number);
    expect(detail!.typeId).toBe(await idOf("Task"));
  });

  it("refuses to delete the default or a type in use, then deletes an unused one", async () => {
    expect((await deleteTaskType(owner, { typeId: await idOf("Task") })).ok).toBe(false);
    const used = await deleteTaskType(owner, { typeId: await idOf("Bug") });
    expect(used).toMatchObject({ ok: false, error: expect.stringMatching(/^Move \d+ tasks? to another type first\.$/) });
    const unused = await idOf("Feature");
    expect((await deleteTaskType(owner, { typeId: unused })).ok).toBe(true);
    expect(await prisma.projectTaskType.count({ where: { id: unused } })).toBe(0);
  });
});
