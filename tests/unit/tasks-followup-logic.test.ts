import { describe, expect, it } from "vitest";
import { dueQuickPicks } from "@/lib/tasks/due";
import { ariaSort, EMPTY_FILTERS, matchesFilters, nextHeaderSort, parseTaskQuery, sortTasks, taskQueryToParams } from "@/lib/tasks/filters";
import { DESCRIPTION_GROUP_MS, groupHistory, historyText } from "@/lib/tasks/historyGroups";
import { deserializeQuery, serializeQuery, urlHasQuery } from "@/lib/tasks/rememberedQuery";
import { wipState } from "@/lib/tasks/wip";
import type { ActivityDTO, BoardTask, ColumnDTO, PersonRef } from "@/lib/tasks/types";

const IST = "Asia/Kolkata";
const task = (over: Partial<BoardTask> & { number: number }): BoardTask => ({
  id: `t${over.number}`,
  title: `Task ${over.number}`,
  priority: "NONE",
  dueAt: null,
  completedAt: null,
  columnId: "todo",
  typeId: null,
  position: over.number,
  assigneeIds: [],
  labelIds: [],
  canEdit: true,
  canClaim: false,
  canUnclaim: false,
  isAssignedToMe: false,
  subtaskCount: 0,
  subtaskDone: 0,
  commentCount: 0,
  attachmentCount: 0,
  blocked: false,
  recurring: false,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...over,
});
const columns: ColumnDTO[] = [
  { id: "todo", name: "To do", position: 0, category: "TODO" },
  { id: "doing", name: "Doing", position: 1, category: "IN_PROGRESS", color: "INFO", wipLimit: 2 },
  { id: "done", name: "Done", position: 2, category: "DONE" },
];
const members: PersonRef[] = [
  { id: "u-zed", name: "Zed", image: null },
  { id: "u-amy", name: "Amy", image: null },
];

describe("creator filter", () => {
  const context = { userId: "me-id", now: new Date("2026-10-19T10:00:00+05:30"), timeZone: IST };
  const filters = (creators: string[]) => ({ ...EMPTY_FILTERS, creators });
  it("matches 'me' and explicit ids, and ignores tasks with another creator", () => {
    const mine = task({ number: 1, creatorId: "me-id" });
    const theirs = task({ number: 2, creatorId: "someone" });
    const unknown = task({ number: 3, creatorId: null });
    expect(matchesFilters(mine, filters(["me"]), context)).toBe(true);
    expect(matchesFilters(theirs, filters(["me"]), context)).toBe(false);
    expect(matchesFilters(unknown, filters(["me"]), context)).toBe(false);
    expect(matchesFilters(theirs, filters(["someone", "other"]), context)).toBe(true);
    expect(matchesFilters(theirs, filters([]), context)).toBe(true);
  });
  it("round-trips through the URL, the remembered query and the saved-view state", () => {
    const query = parseTaskQuery(new URLSearchParams("creator=me,u-amy&sort=assignee&dir=desc&view=list&group=priority"));
    expect(query.filters.creators).toEqual(["me", "u-amy"]);
    expect(query).toMatchObject({ sort: "assignee", dir: "desc", group: "priority", view: "list" });
    expect(taskQueryToParams(query).toString()).toBe("view=list&creator=me%2Cu-amy&sort=assignee&dir=desc&group=priority");
    expect(deserializeQuery(serializeQuery(query))).toEqual(query);
    expect(urlHasQuery(new URLSearchParams("creator=me"))).toBe(true);
    expect(urlHasQuery(new URLSearchParams("dir=desc"))).toBe(true);
  });
  it("only keeps dir with an explicit sort", () => {
    expect(taskQueryToParams(parseTaskQuery(new URLSearchParams("dir=desc"))).toString()).toBe("");
  });
});

describe("sorting by status, assignee and created", () => {
  const rows = [
    task({ number: 1, columnId: "done", assigneeIds: ["u-zed"], createdAt: "2026-10-03T00:00:00.000Z" }),
    task({ number: 2, columnId: "todo", assigneeIds: [], createdAt: "2026-10-01T00:00:00.000Z" }),
    task({ number: 3, columnId: "doing", assigneeIds: ["u-amy"], createdAt: "2026-10-02T00:00:00.000Z" }),
    task({ number: 4, columnId: "todo", assigneeIds: ["u-amy", "u-zed"], createdAt: "2026-10-04T00:00:00.000Z", position: 0 }),
  ];
  const order = (sort: Parameters<typeof sortTasks>[1], dir: "asc" | "desc" = "asc") => sortTasks(rows, sort, { dir, columns, members }).map((row) => row.number);
  it("follows the board's column order for status, then manual position", () => {
    expect(order("status")).toEqual([4, 2, 3, 1]);
    expect(order("status", "desc")).toEqual([1, 3, 2, 4]);
  });
  it("sorts by the first assignee's name with unassigned last", () => {
    expect(order("assignee")).toEqual([3, 4, 1, 2]);
  });
  it("sorts by creation time, oldest first, and reverses on desc", () => {
    expect(order("created")).toEqual([2, 3, 1, 4]);
    expect(order("created", "desc")).toEqual([4, 1, 3, 2]);
  });
  it("leaves board order alone for manual", () => {
    expect(order("manual", "desc")).toEqual([4, 1, 2, 3]);
  });
});

describe("sortable headers", () => {
  it("starts ascending, flips on a second click and resets on another column", () => {
    expect(nextHeaderSort({ sort: "manual", dir: "asc" }, "due")).toEqual({ sort: "due", dir: "asc" });
    expect(nextHeaderSort({ sort: "due", dir: "asc" }, "due")).toEqual({ sort: "due", dir: "desc" });
    expect(nextHeaderSort({ sort: "due", dir: "desc" }, "due")).toEqual({ sort: "due", dir: "asc" });
    expect(nextHeaderSort({ sort: "due", dir: "desc" }, "status")).toEqual({ sort: "status", dir: "asc" });
  });
  it("reports aria-sort for the active column only", () => {
    expect(ariaSort({ sort: "due", dir: "asc" }, "due")).toBe("ascending");
    expect(ariaSort({ sort: "due", dir: "desc" }, "due")).toBe("descending");
    expect(ariaSort({ sort: "due", dir: "desc" }, "title")).toBe("none");
    expect(ariaSort({ sort: "manual", dir: "asc" }, "title")).toBe("none");
  });
});

describe("due-date quick picks", () => {
  it("offers today, tomorrow, next Monday and clear in the workspace zone", () => {
    // Wednesday 21 Oct 2026, 23:30 IST (still the 21st locally, already the 22nd in UTC+8).
    const picks = dueQuickPicks(new Date("2026-10-21T23:30:00+05:30"), IST);
    expect(picks.map((pick) => [pick.key, pick.value])).toEqual([
      ["today", "2026-10-21"],
      ["tomorrow", "2026-10-22"],
      ["next-week", "2026-10-26"],
      ["clear", ""],
    ]);
    expect(picks.map((pick) => pick.label)).toEqual(["Today", "Tomorrow", "Next week", "Clear"]);
  });
  it("moves 'next week' to the following Monday when today is Monday or Sunday", () => {
    expect(dueQuickPicks(new Date("2026-10-19T10:00:00+05:30"), IST)[2]!.value).toBe("2026-10-26");
    expect(dueQuickPicks(new Date("2026-10-25T10:00:00+05:30"), IST)[2]!.value).toBe("2026-10-26");
  });
});

describe("WIP limits", () => {
  it("is quiet without a limit", () => {
    expect(wipState(5, null)).toMatchObject({ over: false, label: "5", hint: "" });
    expect(wipState(5, 0)).toMatchObject({ limit: null });
  });
  it("shows n/limit and flags only counts above the limit", () => {
    expect(wipState(2, 3)).toMatchObject({ over: false, label: "2/3", hint: "Limit 3." });
    expect(wipState(3, 3)).toMatchObject({ over: false, label: "3/3", hint: "Limit 3, reached." });
    expect(wipState(5, 3)).toMatchObject({ over: true, label: "5/3", hint: "Over the limit of 3 by 2." });
  });
});

describe("description history grouping", () => {
  const at = (minutes: number) => new Date(Date.parse("2026-10-19T10:00:00Z") - minutes * 60_000).toISOString();
  const item = (id: string, kind: string, minutesAgo: number, actor = "a"): ActivityDTO => ({ id, kind, text: kind === "description" ? "updated the description" : kind, actor: { id: actor, name: actor, image: null }, createdAt: at(minutesAgo) });
  it("collapses consecutive description saves by the same person", () => {
    const rows = groupHistory([item("1", "description", 0), item("2", "description", 3), item("3", "description", 8), item("4", "created", 30)]);
    expect(rows.map((row) => [row.id, row.count])).toEqual([["1", 3], ["4", 1]]);
    expect(historyText(rows[0]!)).toBe("updated the description (3 saves)");
    expect(historyText(rows[1]!)).toBe("created");
  });
  it("keeps saves apart across other events, other people and gaps over ten minutes", () => {
    const rows = groupHistory([item("1", "description", 0), item("2", "priority", 2), item("3", "description", 4), item("4", "description", 5, "b"), item("5", "description", 5 + DESCRIPTION_GROUP_MS / 60_000 + 1, "b")]);
    expect(rows.map((row) => [row.id, row.count])).toEqual([["1", 1], ["2", 1], ["3", 1], ["4", 1], ["5", 1]]);
  });
  it("chains saves so a long editing session stays one row, and never mutates its input", () => {
    const input = [item("1", "description", 0), item("2", "description", 9), item("3", "description", 18)];
    const copy = JSON.stringify(input);
    expect(groupHistory(input).map((row) => row.count)).toEqual([3]);
    expect(JSON.stringify(input)).toBe(copy);
  });
});
