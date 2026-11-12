import "server-only";

import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { clip, htmlToText, projectWhere, taskWhere, userNames } from "@/lib/assistant/tools/access";
import { defineTool, plural, ToolError, type ToolContext } from "@/lib/assistant/tools/types";
import { visibleTaskWhere } from "@/lib/tasks/access";
import { activityText, HIDDEN_ACTIVITY_KINDS } from "@/lib/tasks/activityText";
import { listTaskTypesFor } from "@/lib/tasks/service/types";
import { actorFromPrincipal } from "./actor";
import { taskRef, taskSelect, taskDto, findVisibleTask } from "./records";

/** "me", a member id or a member's email (active members of this workspace only) as a user id. */
async function resolvePerson(ctx: ToolContext, value: string): Promise<string> {
  if (value === "me") return ctx.principal.userId;
  if (!value.includes("@")) return value;
  const member = await prisma.membership.findFirst({
    where: { workspaceId: ctx.principal.workspace.id, status: "ACTIVE", user: { email: { equals: value.toLowerCase(), mode: "insensitive" }, disabledAt: null } },
    select: { userId: true },
  });
  if (!member) throw new ToolError(`No member of this workspace has the email ${value}.`, "not_found");
  return member.userId;
}

export const listTasks = defineTool({
  name: "sw_list_tasks",
  title: "Tasks",
  description:
    "List tasks in the workspace the caller can see. Filter by project key, assignee or creator (\"me\", a member id from sw_list_members or a member's email), status, due window or a title search. Archived tasks are left out unless includeArchived is true. Returns at most `limit` tasks plus `nextCursor` for the next page.",
  input: z.object({
    project: z.string().trim().max(10).optional().describe("Project key, e.g. BOT."),
    assignee: z.string().trim().max(120).optional().describe('"me", a member id or a member email.'),
    creator: z.string().trim().max(120).optional().describe('Who created the task: "me", a member id or a member email.'),
    includeArchived: z.union([z.boolean(), z.enum(["true", "false"]).transform((value) => value === "true")]).default(false).describe("Also return archived tasks (each has archived: true). Not available to scheduled jobs."),
    status: z.enum(["open", "done", "all"]).default("open"),
    dueWithinDays: z.number().int().min(0).max(365).optional().describe("Only tasks due within this many days (includes overdue)."),
    query: z.string().trim().max(100).optional().describe("Words in the task title."),
    limit: z.number().int().min(1).max(50).default(20),
    cursor: z.string().trim().max(64).optional(),
  }),
  write: false,
  scope: "read:tasks",
  minRole: "GUEST",
  async run(ctx, input) {
    const { principal } = ctx;
    const archived = input.includeArchived && principal.kind !== "job";
    const and: Prisma.TaskWhereInput[] = [archived ? await visibleTaskWhere(actorFromPrincipal(principal)) : await taskWhere(principal)];
    if (input.project) and.push({ project: { key: input.project.toUpperCase() } });
    if (input.assignee) and.push({ assignees: { some: { userId: await resolvePerson(ctx, input.assignee) } } });
    if (input.creator) and.push({ creatorId: await resolvePerson(ctx, input.creator) });
    if (input.status === "open") and.push({ completedAt: null, NOT: { column: { category: "DONE" } } });
    if (input.status === "done") and.push({ OR: [{ completedAt: { not: null } }, { column: { category: "DONE" } }] });
    if (input.dueWithinDays !== undefined) and.push({ dueAt: { lte: new Date(ctx.now.getTime() + input.dueWithinDays * 86_400_000) } });
    if (input.query) and.push({ title: { contains: input.query, mode: "insensitive" } });
    const rows = await prisma.task.findMany({
      where: { AND: and },
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { number: "desc" }],
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      select: taskSelect,
    });
    const page = rows.slice(0, input.limit);
    return {
      summary: `Looked up ${plural(page.length, "task")}`,
      data: { tasks: page.map((task) => taskDto(principal.workspace.slug, task)), nextCursor: rows.length > input.limit ? page[page.length - 1]!.id : null },
    };
  },
});

export const getTask = defineTool({
  name: "sw_get_task",
  title: "Task",
  description:
    "Get one task with its description, assignees, labels, subtasks, history (`activity`, newest first) and comments (`comments`, oldest first, paged with commentCursor and nextCommentCursor; `latestComments` is the newest five).",
  input: z.object({
    ref: taskRef,
    commentLimit: z.number().int().min(1).max(100).default(30),
    commentCursor: z.string().trim().max(64).optional(),
    activityLimit: z.number().int().min(0).max(100).default(30),
  }),
  write: false,
  scope: "read:tasks",
  minRole: "GUEST",
  async run(ctx, input) {
    const task = await findVisibleTask(ctx, input.ref);
    const detail = await prisma.task.findUniqueOrThrow({
      where: { id: task.id },
      select: {
        description: true,
        creatorId: true,
        labels: { select: { label: { select: { name: true } } } },
        comments: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 5, select: { body: true, authorId: true, createdAt: true } },
        activities: { orderBy: { createdAt: "desc" }, take: input.activityLimit, select: { kind: true, actorId: true, data: true, createdAt: true } },
        subtasks: { where: { archivedAt: null }, select: { number: true, title: true, completedAt: true }, take: 20 },
      },
    });
    const page = await prisma.taskComment.findMany({
      where: { taskId: task.id, deletedAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: input.commentLimit + 1,
      ...(input.commentCursor ? { cursor: { id: input.commentCursor }, skip: 1 } : {}),
      select: { id: true, body: true, authorId: true, createdAt: true, editedAt: true },
    });
    const commentsPage = page.slice(0, input.commentLimit);
    const activities = detail.activities.filter((a) => !HIDDEN_ACTIVITY_KINDS.has(a.kind));
    const dataIds = activities.flatMap((a) => {
      const data = a.data as { userIds?: unknown; droppedAssignees?: unknown } | null;
      return [data?.userIds, data?.droppedAssignees].flatMap((value) => (Array.isArray(value) ? (value as string[]) : []));
    });
    const names = await userNames([detail.creatorId, ...detail.comments.map((c) => c.authorId), ...commentsPage.map((c) => c.authorId), ...activities.map((a) => a.actorId), ...dataIds]);
    const nameOf = (id: string) => names.get(id) ?? "a former member";
    return {
      summary: `Opened ${taskDto(ctx.principal.workspace.slug, task).ref}`,
      data: {
        ...taskDto(ctx.principal.workspace.slug, task),
        description: clip(htmlToText(detail.description), 4000),
        createdBy: detail.creatorId ? names.get(detail.creatorId) ?? "Former member" : null,
        createdAt: task.createdAt.toISOString(),
        labels: detail.labels.map((l) => l.label.name),
        subtasks: detail.subtasks.map((s) => ({ number: s.number, title: s.title, done: Boolean(s.completedAt) })),
        comments: commentsPage.map((c) => ({
          id: c.id,
          author: c.authorId ? names.get(c.authorId) ?? "Former member" : "Former member",
          at: c.createdAt.toISOString(),
          edited: Boolean(c.editedAt),
          body: clip(htmlToText(c.body), 2000),
        })),
        nextCommentCursor: page.length > input.commentLimit ? commentsPage[commentsPage.length - 1]!.id : null,
        activity: activities.map((a) => ({
          at: a.createdAt.toISOString(),
          actor: a.actorId ? nameOf(a.actorId) : null,
          kind: a.kind,
          text: activityText(a.kind, a.data as Record<string, unknown> | null, { nameOf, timeZone: ctx.principal.workspace.timezone }),
        })),
        latestComments: detail.comments.map((c) => ({
          author: c.authorId ? names.get(c.authorId) ?? "Former member" : "Former member",
          at: c.createdAt.toISOString(),
          body: clip(htmlToText(c.body), 600),
        })),
      },
    };
  },
});

export const listProjects = defineTool({
  name: "sw_list_projects",
  title: "Projects",
  description: "List projects (key, name, status, owner, open task count) with each board's columns (name, status category, colour, optional WIP limit) and task types.",
  input: z.object({
    status: z.enum(["ACTIVE", "PAUSED", "DONE", "ARCHIVED", "any"]).default("ACTIVE"),
    limit: z.number().int().min(1).max(100).default(50),
    cursor: z.string().trim().max(64).optional(),
  }),
  write: false,
  scope: "read:tasks",
  minRole: "GUEST",
  async run(ctx, input) {
    const where: Prisma.ProjectWhereInput = { ...(await projectWhere(ctx.principal)), ...(input.status === "any" ? {} : { status: input.status }) };
    const rows = await prisma.project.findMany({
      where,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        status: true,
        dueOn: true,
        owner: { select: { name: true } },
        columns: { orderBy: { position: "asc" }, select: { name: true, category: true, color: true, wipLimit: true } },
        _count: { select: { tasks: { where: { archivedAt: null, completedAt: null } } } },
      },
    });
    const page = rows.slice(0, input.limit);
    const types = await Promise.all(page.map((p) => listTaskTypesFor(ctx.principal.workspace.id, p.id)));
    return {
      summary: `Looked up ${plural(page.length, "project")}`,
      data: {
        projects: page.map((p, index) => ({
          key: p.key,
          name: p.name,
          description: p.description ? clip(p.description, 300) : null,
          status: p.status,
          dueOn: p.dueOn?.toISOString().slice(0, 10) ?? null,
          owner: p.owner?.name ?? null,
          openTasks: p._count.tasks,
          columns: p.columns.map((c) => ({ name: c.name, category: c.category, color: c.color, wipLimit: c.wipLimit })),
          taskTypes: types[index]!.map((t) => ({ name: t.name, tone: t.tone, default: t.isDefault })),
          url: `/w/${ctx.principal.workspace.slug}/projects/${p.key}`,
        })),
        nextCursor: rows.length > input.limit ? page[page.length - 1]!.id : null,
      },
    };
  },
});
