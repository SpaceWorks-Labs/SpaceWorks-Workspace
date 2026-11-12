import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createProject } from "@/lib/projects/service";
import { searchDocuments } from "@/lib/search/query";
import type { TaskActor } from "@/lib/tasks/access";
import { parseTaskQuery } from "@/lib/tasks/filters";
import { serializeQuery } from "@/lib/tasks/rememberedQuery";
import { createTask } from "@/lib/tasks/service";
import { deleteTaskView, listTaskViews, saveTaskView } from "@/lib/tasks/views";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@tview-${suffix}.test`;
const slug = `tview-${suffix}`;
let workspaceId: string;
const who: Record<string, TaskActor> = {};
const state = (search: string) => serializeQuery(parseTaskQuery(new URLSearchParams(search)));

async function actorFor(userId: string, role: WorkspaceRole): Promise<TaskActor> {
  const [user, workspace] = await Promise.all([prisma.user.findUniqueOrThrow({ where: { id: userId } }), prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })]);
  return { user: { id: user.id, name: user.name }, workspace, membership: { role } };
}

describe.sequential("saved task views and exact-key search ranking", () => {
  beforeAll(async () => {
    const [owner, member, guest] = await Promise.all(["owner", "member", "guest"].map((name) => createUser(`${name}${domain}`, name)));
    workspaceId = (await createWorkspace(slug, owner!.id)).id;
    await addMember(workspaceId, member!.id, "MEMBER");
    await addMember(workspaceId, guest!.id, "GUEST");
    who.owner = await actorFor(owner!.id, "OWNER");
    who.member = await actorFor(member!.id, "MEMBER");
    who.guest = await actorFor(guest!.id, "GUEST");
    const project = await createProject(who.owner!, { name: "Views", key: "VIEW", template: "standard" });
    if (!project.ok || !project.data) throw new Error("project failed");
    for (let index = 0; index < 12; index += 1) await createTask(who.owner!, { projectId: project.data.id, title: `Wire harness ${index}` });
  });
  afterAll(async () => {
    await cleanup([slug], domain);
    await prisma.$disconnect();
  });

  it("saves private and shared views per project and keeps the filter state", async () => {
    const mine = await saveTaskView(who.member!, { projectKey: "VIEW", name: "My urgent", state: state("view=list&priority=URGENT&creator=me&sort=due&dir=desc&group=assignee"), shared: false });
    const shared = await saveTaskView(who.owner!, { projectKey: "view", name: "Team triage", state: state("assignee=none"), shared: true });
    expect(mine.ok && shared.ok).toBe(true);
    const seen = await listTaskViews(who.member!, "VIEW");
    expect(seen.map((view) => [view.name, view.mine, view.shared])).toEqual([["My urgent", true, false], ["Team triage", false, true]]);
    const restored = JSON.parse(seen[0]!.state) as { view: string; filters: { priorities: string[]; creators: string[] }; sort: string; dir: string; group: string };
    expect(restored).toMatchObject({ view: "list", sort: "due", dir: "desc", group: "assignee", filters: { priorities: ["URGENT"], creators: ["me"] } });
    // The owner never sees the member's private view; guests see only shared ones.
    expect((await listTaskViews(who.owner!, "VIEW")).map((view) => view.name)).toEqual(["Team triage"]);
    expect((await listTaskViews(who.guest!, "VIEW")).map((view) => view.name)).toEqual(["Team triage"]);
    expect(await listTaskViews(who.member!, "NOPE")).toEqual([]);
  });

  it("updates a view of the same name in place, limits sharing to members and rejects junk state", async () => {
    const again = await saveTaskView(who.member!, { projectKey: "VIEW", name: "my URGENT", state: state("priority=HIGH"), shared: false });
    expect(again.ok).toBe(true);
    expect((await listTaskViews(who.member!, "VIEW")).filter((view) => view.mine)).toHaveLength(1);
    expect(await saveTaskView(who.guest!, { projectKey: "VIEW", name: "Guest shared", state: state(""), shared: true })).toMatchObject({ ok: false });
    expect((await saveTaskView(who.guest!, { projectKey: "VIEW", name: "Guest own", state: state(""), shared: false })).ok).toBe(true);
    expect(await saveTaskView(who.member!, { projectKey: "VIEW", name: "Bad", state: "not json", shared: false })).toMatchObject({ ok: false });
    expect(await saveTaskView(who.member!, { projectKey: "VIEW", name: "", state: state(""), shared: false })).toMatchObject({ ok: false });
  });

  it("lets only the owner (or an admin for shared views) remove a view", async () => {
    const views = await listTaskViews(who.member!, "VIEW");
    const shared = views.find((view) => view.shared)!;
    const mine = views.find((view) => view.mine)!;
    expect(await deleteTaskView(who.member!, shared.id)).toMatchObject({ ok: false });
    expect(await deleteTaskView(who.guest!, mine.id)).toMatchObject({ ok: false });
    expect(await deleteTaskView(who.member!, mine.id)).toEqual({ ok: true });
    expect(await deleteTaskView(who.owner!, shared.id)).toEqual({ ok: true });
    expect(await listTaskViews(who.member!, "VIEW")).toEqual([]);
  });

  it("ranks a task typed by its full key above longer keys that merely contain it", async () => {
    const search = { workspaceId, userId: who.member!.user.id, role: "MEMBER" as const };
    const numbers = (await prisma.task.findMany({ where: { workspaceId, title: { startsWith: "Wire harness" } }, orderBy: { number: "asc" }, select: { number: true } })).map((row) => row.number);
    const target = numbers[0]!;
    const longer = numbers.find((number) => String(number).startsWith(String(target)) && number !== target);
    const hits = await searchDocuments(search, `VIEW-${target}`);
    expect(hits[0]?.title.startsWith(`VIEW-${target} `)).toBe(true);
    if (longer) expect(hits.findIndex((hit) => hit.title.startsWith(`VIEW-${longer} `))).toBeGreaterThan(0);
    const lower = await searchDocuments(search, `view-${target}`);
    expect(lower[0]?.title.startsWith(`VIEW-${target} `)).toBe(true);
  });
});
