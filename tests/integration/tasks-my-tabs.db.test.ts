import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createProject } from "@/lib/projects/service";
import type { TaskActor } from "@/lib/tasks/access";
import { directReportIds, listMyTasks } from "@/lib/tasks/queries";
import { createTask } from "@/lib/tasks/service";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@mytabs-${suffix}.test`;
const slug = `mytabs-${suffix}`;

let owner: TaskActor;
let manager: TaskActor;
let report: TaskActor;
let disabledReport: TaskActor;
let peer: TaskActor;
let stranger: TaskActor;
let publicProject: string;
let privateProject: string;

async function actorFor(userId: string, workspaceId: string, role: WorkspaceRole): Promise<TaskActor> {
  const [user, workspace] = await Promise.all([prisma.user.findUniqueOrThrow({ where: { id: userId } }), prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })]);
  return { user: { id: user.id, name: user.name }, workspace, membership: { role } };
}

async function newTask(as: TaskActor, projectId: string, title: string, assigneeIds: string[] = []) {
  const result = await createTask(as, { projectId, title, assigneeIds });
  if (!result.ok) throw new Error(result.error);
  return result.data!.id;
}
/** Assign directly, for people the service would refuse (disabled, or unable to see the project). */
async function assignRaw(taskId: string, userId: string, assignedById: string) {
  await prisma.taskAssignee.create({ data: { taskId, userId, assignedById } });
}
const titles = async (as: TaskActor, tab: "assigned" | "assigned-by-me" | "team" | "created") => (await listMyTasks(as, new Date(), tab)).map((task) => task.title).sort();

describe.sequential("my tasks tabs", () => {
  beforeAll(async () => {
    const users = await Promise.all(["owner", "manager", "report", "disabled", "peer", "stranger"].map((name) => createUser(`${name}${domain}`, `Person ${name}`)));
    const ws = await createWorkspace(slug, users[0]!.id);
    await Promise.all(users.slice(1).map((user) => addMember(ws.id, user.id, "MEMBER")));
    const [o, m, r, d, p, s] = await Promise.all(users.map((user, index) => actorFor(user.id, ws.id, index === 0 ? "OWNER" : "MEMBER")));
    [owner, manager, report, disabledReport, peer, stranger] = [o!, m!, r!, d!, p!, s!];
    await prisma.memberProfile.createMany({
      data: [
        { workspaceId: ws.id, userId: report.user.id, managerId: manager.user.id },
        { workspaceId: ws.id, userId: disabledReport.user.id, managerId: manager.user.id },
      ],
    });
    await prisma.user.update({ where: { id: disabledReport.user.id }, data: { disabledAt: new Date() } });
    const open = await createProject(owner, { name: "Open", key: "OPN" });
    if (!open.ok) throw new Error(open.error);
    publicProject = open.data!.id;
    // A private team project the manager and the report are not part of.
    const team = await prisma.team.create({ data: { workspaceId: ws.id, name: "Secret", slug: `secret-${suffix}`, visibility: "PRIVATE", members: { create: [{ userId: owner.user.id }] } } });
    const hidden = await createProject(owner, { name: "Hidden", key: "HID", teamId: team.id });
    if (!hidden.ok) throw new Error(hidden.error);
    privateProject = hidden.data!.id;
  }, 60_000);

  afterAll(async () => {
    await cleanup([slug], domain);
  });

  it("assigned by me: tasks I handed to someone else, with their assignees; not self-assignments", async () => {
    await newTask(manager, publicProject, "Handed to report", [report.user.id]);
    await newTask(manager, publicProject, "Mine only", [manager.user.id]);
    await newTask(manager, publicProject, "Mixed", [manager.user.id, peer.user.id]);
    const rows = await listMyTasks(manager, new Date(), "assigned-by-me");
    expect(rows.map((row) => row.title).sort()).toEqual(["Handed to report", "Mixed"]);
    expect(rows.find((row) => row.title === "Handed to report")!.assignees.map((person) => person.id)).toEqual([report.user.id]);
    // Someone else's hand-off does not show up for me.
    expect(await titles(report, "assigned-by-me")).toEqual([]);
  });

  it("assigned by me: falls back to the creator when the row has no assignedById", async () => {
    const id = await newTask(manager, publicProject, "Legacy hand-off", [peer.user.id]);
    await prisma.taskAssignee.updateMany({ where: { taskId: id }, data: { assignedById: null } });
    expect(await titles(manager, "assigned-by-me")).toContain("Legacy hand-off");
    expect(await titles(owner, "assigned-by-me")).not.toContain("Legacy hand-off");
  });

  it("created by me lists what I created regardless of assignees", async () => {
    expect(await titles(manager, "created")).toEqual(expect.arrayContaining(["Handed to report", "Mine only", "Mixed"]));
    expect(await titles(peer, "created")).toEqual([]);
  });

  it("my team: direct reports' open tasks, excluding disabled reports, empty without reports", async () => {
    expect(await directReportIds(manager)).toEqual([report.user.id]);
    await newTask(owner, publicProject, "Report job", [report.user.id]);
    await assignRaw(await newTask(owner, publicProject, "Disabled job"), disabledReport.user.id, owner.user.id);
    await newTask(owner, publicProject, "Peer job", [peer.user.id]);
    const team = await titles(manager, "team");
    expect(team).toEqual(expect.arrayContaining(["Report job", "Handed to report"]));
    expect(team).not.toContain("Disabled job");
    expect(team).not.toContain("Peer job");
    expect(await directReportIds(peer)).toEqual([]);
    expect(await titles(peer, "team")).toEqual([]);
  });

  it("my team: leaves out tasks in projects the manager cannot see", async () => {
    await assignRaw(await newTask(owner, privateProject, "Secret report job"), report.user.id, owner.user.id);
    expect(await titles(manager, "team")).not.toContain("Secret report job");
  });

  it("assigned tab is unchanged: only tasks assigned to me, with my rights", async () => {
    const rows = await listMyTasks(peer, new Date(), "assigned");
    expect(rows.map((row) => row.title).sort()).toEqual(["Legacy hand-off", "Mixed", "Peer job"]);
    expect(rows.every((row) => row.isAssignedToMe)).toBe(true);
    expect(await titles(stranger, "assigned")).toEqual([]);
  });
});
