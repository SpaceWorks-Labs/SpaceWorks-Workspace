import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@o2-${suffix}.test`;
const slug = `o2-${suffix}`;
let workspaceId = "";

/** The complete, reviewed column list of every reporting view. Adding a column means reviewing it for privacy. */
const ALLOWED: Record<string, string[]> = {
  v_tasks: ["task_id", "workspace_id", "project_id", "status", "priority", "due_at", "completed_at", "created_at", "updated_at", "is_overdue"],
  v_projects: ["project_id", "workspace_id", "project_key", "status", "starts_on", "due_on", "cycles_enabled", "created_at", "updated_at"],
  v_members: ["member_id", "workspace_id", "role", "status", "joined_at"],
  v_activity_daily: ["workspace_id", "day", "entity_type", "verb", "events"],
  v_monitor_uptime_daily: ["workspace_id", "monitor_id", "day", "checks_total", "checks_up", "checks_degraded", "checks_down", "checks_maintenance", "downtime_seconds", "latency_avg_ms", "latency_p95_ms"],
};
const FORBIDDEN = /email|name|title|description|body|token|secret|password|hash|summary|message|content|ip_|phone/i;

describe.sequential("reporting views", () => {
  beforeAll(async () => {
    const owner = await createUser(`owner${domain}`, "Owner Person");
    const workspace = await createWorkspace(slug, owner.id);
    workspaceId = workspace.id;
    const project = await prisma.project.create({ data: { workspaceId, key: "RPT", name: "Secret Project Name" } });
    await prisma.task.create({ data: { workspaceId, projectId: project.id, number: 1, title: "Secret task title", description: "<p>secret body</p>", priority: "HIGH" } });
    await prisma.activityEvent.create({ data: { workspaceId, verb: "created", entityType: "task", entityId: "t1", summary: "Owner Person did a secret thing" } });
  });
  afterAll(async () => {
    await cleanup([slug], domain);
    await prisma.$disconnect();
  });

  it("exposes exactly the reviewed columns, with workspace_id everywhere", async () => {
    const rows = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
      SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'reporting' ORDER BY table_name, ordinal_position`;
    const found: Record<string, string[]> = {};
    for (const row of rows) (found[row.table_name] ??= []).push(row.column_name);
    expect(Object.keys(found).sort()).toEqual(Object.keys(ALLOWED).sort());
    for (const [view, columns] of Object.entries(found)) {
      expect(columns.sort()).toEqual([...ALLOWED[view]].sort());
      expect(columns).toContain("workspace_id");
      for (const column of columns) expect(column, `${view}.${column}`).not.toMatch(FORBIDDEN);
    }
  });

  it.each(Object.keys(ALLOWED))("selects from reporting.%s without leaking content", async (view) => {
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT * FROM reporting.${view} WHERE workspace_id = $1`, workspaceId);
    const dump = JSON.stringify(rows);
    expect(dump).not.toMatch(/Secret|secret|Owner Person|@o2-/);
    if (view !== "v_monitor_uptime_daily") expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.workspace_id).toBe(workspaceId);
  });

  it("derives task status and counts activity per day", async () => {
    const [task] = await prisma.$queryRaw<Array<{ status: string; priority: string; is_overdue: boolean }>>`SELECT status, priority, is_overdue FROM reporting.v_tasks WHERE workspace_id = ${workspaceId}`;
    expect(task).toEqual({ status: "open", priority: "HIGH", is_overdue: false });
    const [activity] = await prisma.$queryRaw<Array<{ events: number }>>`SELECT events FROM reporting.v_activity_daily WHERE workspace_id = ${workspaceId} AND verb = 'created'`;
    expect(activity.events).toBe(1);
  });

  it("excludes private-team projects, tasks and activity but keeps public ones", async () => {
    const pub = await prisma.team.create({ data: { workspaceId, name: "Open team", slug: "open", visibility: "PUBLIC" } });
    const priv = await prisma.team.create({ data: { workspaceId, name: "Closed team", slug: "closed", visibility: "PRIVATE" } });
    const pubProject = await prisma.project.create({ data: { workspaceId, key: "PUB", name: "Public one", teamId: pub.id } });
    const privProject = await prisma.project.create({ data: { workspaceId, key: "PRV", name: "Private one", teamId: priv.id } });
    const pubTask = await prisma.task.create({ data: { workspaceId, projectId: pubProject.id, number: 2, title: "t1" } });
    const privTask = await prisma.task.create({ data: { workspaceId, projectId: privProject.id, number: 3, title: "t2" } });
    await prisma.activityEvent.create({ data: { workspaceId, verb: "private_verb", entityType: "task", entityId: privTask.id, summary: "x", projectId: privProject.id, teamId: priv.id } });
    await prisma.activityEvent.create({ data: { workspaceId, verb: "public_verb", entityType: "task", entityId: pubTask.id, summary: "x", projectId: pubProject.id, teamId: pub.id } });
    const ids = async (view: string, column: string) =>
      (await prisma.$queryRawUnsafe<Array<Record<string, string>>>(`SELECT ${column} FROM reporting.${view} WHERE workspace_id = $1`, workspaceId)).map((row) => row[column]);
    const tasks = await ids("v_tasks", "task_id");
    expect(tasks).toContain(pubTask.id);
    expect(tasks).not.toContain(privTask.id);
    const projects = await ids("v_projects", "project_id");
    expect(projects).toContain(pubProject.id);
    expect(projects).not.toContain(privProject.id);
    const verbs = await ids("v_activity_daily", "verb");
    expect(verbs).toContain("public_verb");
    expect(verbs).not.toContain("private_verb");
  });
});
