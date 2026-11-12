import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { addColumn, createProject, updateColumn } from "@/lib/projects/service";
import type { TaskActor } from "@/lib/tasks/access";
import { getBoardData, listArchivedTasks } from "@/lib/tasks/queries";
import { addComment, createTask, deleteTaskPermanently, setTaskArchived, updateTask, uploadDescriptionImage } from "@/lib/tasks/service";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@tdel-${suffix}.test`;
const slug = `tdel-${suffix}`;
let workspaceId: string;
let projectId: string;
const who: Record<string, TaskActor> = {};

async function actorFor(userId: string, role: WorkspaceRole): Promise<TaskActor> {
  const [user, workspace] = await Promise.all([prisma.user.findUniqueOrThrow({ where: { id: userId } }), prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })]);
  return { user: { id: user.id, name: user.name }, workspace, membership: { role } };
}
const make = async (title: string, archive = true) => {
  const created = await createTask(who.member!, { projectId, title });
  if (!created.ok || !created.data) throw new Error("create failed");
  if (archive) expect((await setTaskArchived(who.member!, { taskId: created.data.id, archived: true })).ok).toBe(true);
  return created.data;
};

describe.sequential("tasks: archived tab, permanent delete, columns, conflicts, images", () => {
  beforeAll(async () => {
    const [owner, admin, lead, member, guest] = await Promise.all(["owner", "admin", "lead", "member", "guest"].map((name) => createUser(`${name}${domain}`, name)));
    workspaceId = (await createWorkspace(slug, owner!.id)).id;
    for (const [user, role] of [[admin, "ADMIN"], [lead, "MEMBER"], [member, "MEMBER"], [guest, "GUEST"]] as const) await addMember(workspaceId, user!.id, role);
    who.owner = await actorFor(owner!.id, "OWNER");
    who.admin = await actorFor(admin!.id, "ADMIN");
    who.lead = await actorFor(lead!.id, "MEMBER");
    who.member = await actorFor(member!.id, "MEMBER");
    who.guest = await actorFor(guest!.id, "GUEST");
    const project = await createProject(who.lead!, { name: "Delete me", key: "DEL", template: "standard" });
    if (!project.ok || !project.data) throw new Error("project failed");
    projectId = project.data.id;
  });
  afterAll(async () => {
    await cleanup([slug], domain);
    await prisma.$disconnect();
  });

  it("lists archived tasks with who archived them and who can restore", async () => {
    const task = await make("Listed");
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const rows = await listArchivedTasks(who.member!, project);
    expect(rows.find((row) => row.id === task.id)).toMatchObject({ number: task.number, archivedBy: "member", canRestore: true });
    expect((await listArchivedTasks(who.guest!, project)).find((row) => row.id === task.id)?.canRestore).toBe(false);
  });

  it("refuses members, guests and live tasks; asks for the project key", async () => {
    const archived = await make("Protected");
    const live = await make("Still live", false);
    for (const actor of [who.member!, who.guest!]) {
      expect(await deleteTaskPermanently(actor, { taskId: archived.id, confirmKey: "DEL" })).toMatchObject({ ok: false });
    }
    expect(await deleteTaskPermanently(who.lead!, { taskId: live.id, confirmKey: "DEL" })).toMatchObject({ ok: false, error: expect.stringMatching(/Archive this task first/) });
    expect(await deleteTaskPermanently(who.lead!, { taskId: archived.id, confirmKey: "WRONG" })).toMatchObject({ ok: false, fieldErrors: { confirmKey: expect.any(Array) } });
    expect(await prisma.task.count({ where: { id: { in: [archived.id, live.id] } } })).toBe(2);
  });

  it("lets the project owner and an admin delete, cascading everything with audit, search and realtime cleanup", async () => {
    const task = await make("Cascade me", false);
    const subtask = await createTask(who.member!, { parentId: task.id, title: "Child" });
    expect((await addComment(who.member!, { taskId: task.id, body: "Remember this" })).ok).toBe(true);
    const fileRow = await prisma.fileObject.create({ data: { workspaceId, taskId: task.id, storageKey: `tdel/${suffix}/note.txt`, filename: "note.txt", contentType: "text/plain", size: 8, checksum: "x" } });
    // The subtask is still indexed (archiving the parent only de-indexes the parent); deleting removes both.
    expect(await prisma.searchDocument.count({ where: { workspaceId, entityType: "task", entityId: subtask.ok ? subtask.data!.id : "" } })).toBe(1);
    expect((await setTaskArchived(who.member!, { taskId: task.id, archived: true })).ok).toBe(true);
    expect(await deleteTaskPermanently(who.lead!, { taskId: task.id, confirmKey: "del" })).toEqual({ ok: true });
    expect(await prisma.task.count({ where: { id: { in: [task.id, subtask.ok ? subtask.data!.id : ""] } } })).toBe(0);
    expect(await prisma.taskComment.count({ where: { taskId: task.id } })).toBe(0);
    expect(await prisma.taskActivity.count({ where: { taskId: task.id } })).toBe(0);
    expect((await prisma.fileObject.findUniqueOrThrow({ where: { id: fileRow.id } })).deletedAt).not.toBeNull();
    expect(await prisma.searchDocument.count({ where: { workspaceId, entityType: "task", entityId: { in: [task.id, subtask.ok ? subtask.data!.id : ""] } } })).toBe(0);
    const audit = await prisma.auditEvent.findFirst({ where: { workspaceId, action: "task.deleted", targetId: task.id } });
    expect(audit?.metadata).toMatchObject({ number: task.number, projectKey: "DEL", subtasks: 1, files: 1 });

    const second = await make("Admin delete");
    expect(await deleteTaskPermanently(who.admin!, { taskId: second.id, confirmKey: "DEL" })).toEqual({ ok: true });
    expect(await prisma.task.findUnique({ where: { id: second.id } })).toBeNull();
  });

  it("refuses to delete a subtask directly and anything in an archived project", async () => {
    const parent = await make("Parent", false);
    const child = await createTask(who.member!, { parentId: parent.id, title: "Sub" });
    await prisma.task.update({ where: { id: child.ok ? child.data!.id : "" }, data: { archivedAt: new Date() } });
    expect(await deleteTaskPermanently(who.lead!, { taskId: child.ok ? child.data!.id : "", confirmKey: "DEL" })).toMatchObject({ ok: false, error: expect.stringMatching(/parent/i) });
    const task = await make("Frozen");
    await prisma.project.update({ where: { id: projectId }, data: { status: "ARCHIVED" } });
    expect(await deleteTaskPermanently(who.lead!, { taskId: task.id, confirmKey: "DEL" })).toMatchObject({ ok: false });
    await prisma.project.update({ where: { id: projectId }, data: { status: "ACTIVE" } });
  });

  it("saves a column colour and soft WIP limit, clears them with null and leaves them alone when omitted", async () => {
    const board = await getBoardData(who.lead!, "DEL");
    const column = board!.columns[1]!;
    expect(await updateColumn(who.lead!, { columnId: column.id, name: column.name, category: column.category, color: "WARNING", wipLimit: 3 })).toEqual({ ok: true });
    expect((await getBoardData(who.lead!, "DEL"))!.columns[1]).toMatchObject({ color: "WARNING", wipLimit: 3 });
    expect(await updateColumn(who.lead!, { columnId: column.id, name: "Renamed", category: column.category })).toEqual({ ok: true });
    expect((await getBoardData(who.lead!, "DEL"))!.columns[1]).toMatchObject({ name: "Renamed", color: "WARNING", wipLimit: 3 });
    expect(await updateColumn(who.lead!, { columnId: column.id, name: "Renamed", category: column.category, color: null, wipLimit: null })).toEqual({ ok: true });
    expect((await getBoardData(who.lead!, "DEL"))!.columns[1]).toMatchObject({ color: null, wipLimit: null });
    expect(await updateColumn(who.lead!, { columnId: column.id, name: "Renamed", category: column.category, wipLimit: 0 })).toMatchObject({ ok: false });
    expect(await updateColumn(who.lead!, { columnId: column.id, name: "Renamed", category: column.category, color: "PURPLE" })).toMatchObject({ ok: false });
    expect(await updateColumn(who.member!, { columnId: column.id, name: "Nope", category: column.category })).toMatchObject({ ok: false });
    expect((await addColumn(who.lead!, { projectId, name: "Extra", category: "TODO" })).ok).toBe(true);
  });

  it("refuses a save over someone else's change to the title or description", async () => {
    const task = await make("Editable", false);
    expect((await updateTask(who.member!, { taskId: task.id, description: "<p>First</p>" })).ok).toBe(true);
    expect((await updateTask(who.lead!, { taskId: task.id, description: "<p>Theirs</p>" })).ok).toBe(true);
    const stale = await updateTask(who.member!, { taskId: task.id, description: "<p>Mine</p>", expectedDescription: "<p>First</p>" });
    expect(stale).toMatchObject({ ok: false, fieldErrors: { conflict: expect.any(Array) } });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).description).toBe("<p>Theirs</p>");
    expect((await updateTask(who.member!, { taskId: task.id, description: "<p>Mine</p>", expectedDescription: "<p>Theirs</p>" })).ok).toBe(true);
    expect(await updateTask(who.member!, { taskId: task.id, title: "New title", expectedTitle: "Editable" })).toEqual({ ok: true });
    expect(await updateTask(who.lead!, { taskId: task.id, title: "Other title", expectedTitle: "Editable" })).toMatchObject({ ok: false, fieldErrors: { conflict: expect.any(Array) } });
  });

  it("stores description images as private inline task files and refuses guests and other types", async () => {
    const task = await make("Pictures", false);
    const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64"));
    const image = new File([png], "wiring.png", { type: "image/png" });
    expect(await uploadDescriptionImage(who.guest!, task.id, image)).toMatchObject({ ok: false });
    expect(await uploadDescriptionImage(who.member!, task.id, new File(["x"], "a.txt", { type: "text/plain" }))).toMatchObject({ ok: false, error: expect.stringMatching(/PNG/) });
    const stored = await uploadDescriptionImage(who.member!, task.id, image);
    expect(stored.ok).toBe(true);
    const id = stored.ok ? stored.data!.id : "";
    expect(stored.ok && stored.data!.url).toBe(`/api/files/${id}`);
    const row = await prisma.fileObject.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ folder: "/tasks/inline", taskId: task.id, workspaceId });
    expect((await updateTask(who.member!, { taskId: task.id, description: `<p>See</p><img src="/api/files/${id}" alt="x"><img src="https://evil.test/a.png">` })).ok).toBe(true);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).description).toBe(`<p>See</p><img src="/api/files/${id}" alt="x" />`);
    const board = await getBoardData(who.member!, "DEL");
    expect(board!.tasks.find((item) => item.id === task.id)!.attachmentCount).toBe(0);
  });
});
