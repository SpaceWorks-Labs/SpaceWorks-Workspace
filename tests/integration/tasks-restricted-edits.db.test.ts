import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createProject, updateProject } from "@/lib/projects/service";
import type { TaskActor } from "@/lib/tasks/access";
import { setRecurrence } from "@/lib/tasks/recurrenceService";
import {
  addAttachment,
  addComment,
  addDependency,
  createTask,
  moveTask,
  setAssignees,
  setLabels,
  setTaskArchived,
  setTaskCompleted,
  updateTask,
} from "@/lib/tasks/service";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@restrict-${suffix}.test`;
const slug = `restrict-${suffix}`;

let owner: TaskActor;
let creator: TaskActor;
let assignee: TaskActor;
let stranger: TaskActor;
let admin: TaskActor;
let projectId: string;
let taskId: string;
let otherId: string;
let columnId: string;

async function actorFor(userId: string, workspaceId: string, role: WorkspaceRole): Promise<TaskActor> {
  const [user, workspace] = await Promise.all([prisma.user.findUniqueOrThrow({ where: { id: userId } }), prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })]);
  return { user: { id: user.id, name: user.name }, workspace, membership: { role } };
}

type Call = (who: TaskActor) => Promise<{ ok: boolean; error?: string }>;
const paths = (): Record<string, Call> => ({
  updateTask: (who) => updateTask(who, { taskId, title: `Retitled ${Math.random()}` }),
  moveTask: (who) => moveTask(who, { taskId, columnId, afterTaskId: null }),
  setTaskCompleted: (who) => setTaskCompleted(who, { taskId, completed: true }),
  setLabels: (who) => setLabels(who, { taskId, labelIds: [] }),
  setAssignees: (who) => setAssignees(who, { taskId, userIds: [assignee.user.id, who.user.id] }),
  setTaskArchived: (who) => setTaskArchived(who, { taskId, archived: true }),
  addDependency: (who) => addDependency(who, { taskId, reference: `#${otherNumber}`, direction: "blockedBy" }),
  setRecurrence: (who) => setRecurrence(who, { taskId, rrule: "FREQ=WEEKLY;BYDAY=MO" }),
  createSubtask: (who) => createTask(who, { parentId: taskId, title: "Sub" }),
});
let otherNumber = 0;

describe.sequential("tasks: restrictTaskEdits gates every mutation path", () => {
  beforeAll(async () => {
    const ownerUser = await createUser(`owner${domain}`, "Owner Olivia");
    const adminUser = await createUser(`admin${domain}`, "Admin Arun");
    const creatorUser = await createUser(`creator${domain}`, "Creator Chris");
    const assigneeUser = await createUser(`assignee${domain}`, "Assignee Asha");
    const strangerUser = await createUser(`stranger${domain}`, "Stranger Sam");
    const ws = await createWorkspace(slug, ownerUser.id);
    for (const [user, role] of [[adminUser, "ADMIN"], [creatorUser, "MEMBER"], [assigneeUser, "MEMBER"], [strangerUser, "MEMBER"]] as const) await addMember(ws.id, user.id, role);
    owner = await actorFor(ownerUser.id, ws.id, "OWNER");
    admin = await actorFor(adminUser.id, ws.id, "ADMIN");
    creator = await actorFor(creatorUser.id, ws.id, "MEMBER");
    assignee = await actorFor(assigneeUser.id, ws.id, "MEMBER");
    stranger = await actorFor(strangerUser.id, ws.id, "MEMBER");
    const project = await createProject(owner, { name: "Restricted", key: "RST" });
    if (!project.ok) throw new Error(project.error);
    projectId = project.data!.id;
    columnId = (await prisma.boardColumn.findFirstOrThrow({ where: { projectId }, orderBy: { position: "desc" } })).id;
    const row = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const set = await updateProject(owner, { projectId, name: row.name, key: row.key, status: "ACTIVE", ownerId: row.ownerId, restrictTaskEdits: true });
    if (!set.ok) throw new Error(set.error);
    const created = await createTask(creator, { projectId, title: "Guarded", assigneeIds: [assignee.user.id] });
    if (!created.ok) throw new Error(created.error);
    taskId = created.data!.id;
    const other = await createTask(owner, { projectId, title: "Other" });
    if (!other.ok) throw new Error(other.error);
    otherId = other.data!.id;
    otherNumber = other.data!.number;
  }, 60_000);

  afterAll(async () => {
    await cleanup([slug], domain);
  });

  it("refuses a non-creator, non-assignee member on every edit path", async () => {
    for (const [name, call] of Object.entries(paths())) {
      const result = await call(stranger);
      expect(result.ok, name).toBe(false);
      expect(result.error, name).toMatch(/Only the creator, assignees and project admins/);
    }
  });

  it("still lets that member comment and attach", async () => {
    expect((await addComment(stranger, { taskId, body: "Looks good" })).ok).toBe(true);
    const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "note.txt", { type: "text/plain" });
    const upload = await addAttachment(stranger, taskId, file);
    expect(upload.ok ? "" : upload.error).not.toMatch(/Only the creator/);
  });

  it("allows the assignee, the creator, the project owner and an admin", async () => {
    for (const who of [assignee, creator, owner, admin]) {
      expect((await updateTask(who, { taskId, title: `By ${who.user.name}` })).ok, who.user.name ?? "").toBe(true);
    }
  });

  it("lifts the gate when the restriction is switched off", async () => {
    const row = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    await updateProject(owner, { projectId, name: row.name, key: row.key, status: "ACTIVE", ownerId: row.ownerId, restrictTaskEdits: false });
    expect((await updateTask(stranger, { taskId: otherId, title: "Open to all" })).ok).toBe(true);
  });
});
