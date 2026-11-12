import { describe, expect, it } from "vitest";
import { activityText } from "@/lib/tasks/activityText";
import { isBlocked, wouldCreateCycle } from "@/lib/tasks/dependencies";
import { dueBucket, reminderDue } from "@/lib/tasks/due";
import { activeFilterCount, groupTasks, matchesFilters, parseTaskQuery, sortTasks, taskQueryToParams } from "@/lib/tasks/filters";
import { parseTaskReference, taskReference, taskUrl } from "@/lib/tasks/links";
import { fromDateInputValue, toDateInputValue } from "@/lib/tasks/localDate";
import { decodeMentions, encodeMentions, extractMentionIds, splitMentions } from "@/lib/tasks/mentions";
import { isValidProjectKey, suggestProjectKey } from "@/lib/projects/keys";
import type { BoardTask } from "@/lib/tasks/types";

const IST = "Asia/Kolkata";

describe("dependency cycles", () => {
  const edges = [
    { blockingTaskId: "a", blockedTaskId: "b" },
    { blockingTaskId: "b", blockedTaskId: "c" },
  ];
  it("rejects self links and direct or transitive loops", () => {
    expect(wouldCreateCycle(edges, "a", "a")).toBe(true);
    expect(wouldCreateCycle(edges, "b", "a")).toBe(true);
    expect(wouldCreateCycle(edges, "c", "a")).toBe(true);
  });
  it("allows new branches and parallel paths", () => {
    expect(wouldCreateCycle(edges, "a", "c")).toBe(false);
    expect(wouldCreateCycle(edges, "d", "a")).toBe(false);
    expect(wouldCreateCycle(edges, "c", "d")).toBe(false);
  });
  it("handles diamonds without false positives", () => {
    const diamond = [
      { blockingTaskId: "a", blockedTaskId: "b" },
      { blockingTaskId: "a", blockedTaskId: "c" },
      { blockingTaskId: "b", blockedTaskId: "d" },
      { blockingTaskId: "c", blockedTaskId: "d" },
    ];
    expect(wouldCreateCycle(diamond, "a", "d")).toBe(false);
    expect(wouldCreateCycle(diamond, "d", "a")).toBe(true);
  });
  it("counts only open blockers", () => {
    expect(isBlocked([{ completedAt: null, archivedAt: null }])).toBe(true);
    expect(isBlocked([{ completedAt: "2026-01-01", archivedAt: null }, { completedAt: null, archivedAt: "2026-01-01" }])).toBe(false);
  });
});

describe("due dates", () => {
  // Monday 19 Oct 2026, 10:00 IST.
  const now = new Date("2026-10-19T10:00:00+05:30");
  const day = (date: string) => fromDateInputValue(date, IST)!;
  it("buckets by local day and week", () => {
    expect(dueBucket(null, now, IST)).toBe("none");
    expect(dueBucket(day("2026-10-18"), now, IST)).toBe("overdue");
    expect(dueBucket(day("2026-10-19"), now, IST)).toBe("today");
    expect(dueBucket(day("2026-10-25"), now, IST)).toBe("week");
    expect(dueBucket(day("2026-10-26"), now, IST)).toBe("later");
  });
  it("round-trips date inputs in the workspace zone", () => {
    expect(day("2026-10-19").toISOString()).toBe("2026-10-18T18:30:00.000Z");
    expect(toDateInputValue(day("2026-10-19"), IST)).toBe("2026-10-19");
    expect(fromDateInputValue("2026-02-30", IST)).toBeNull();
  });
  it("schedules due and overdue reminders at 9 AM local", () => {
    const due = day("2026-10-19");
    expect(reminderDue(due, new Date("2026-10-19T08:59:00+05:30"), IST)).toBeNull();
    expect(reminderDue(due, new Date("2026-10-19T09:00:00+05:30"), IST)).toBe("due");
    expect(reminderDue(due, new Date("2026-10-20T09:00:00+05:30"), IST)).toBe("overdue");
    expect(reminderDue(due, new Date("2026-11-20T09:00:00+05:30"), IST)).toBeNull();
  });
});

const task = (overrides: Partial<BoardTask>): BoardTask => ({
  id: "t",
  number: 1,
  title: "Task",
  priority: "NONE",
  dueAt: null,
  completedAt: null,
  columnId: "c1",
  position: 1,
  assigneeIds: [],
  labelIds: [],
  subtaskCount: 0,
  subtaskDone: 0,
  commentCount: 0,
  attachmentCount: 0,
  blocked: false,
  recurring: false,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  typeId: null,
  canEdit: true,
  canClaim: true,
  canUnclaim: false,
  isAssignedToMe: false,
  ...overrides,
});

describe("filters", () => {
  const context = { userId: "me-id", now: new Date("2026-10-19T10:00:00+05:30"), timeZone: IST };
  const tasks = [
    task({ id: "1", number: 1, title: "Solder the sensor bar", priority: "HIGH", assigneeIds: ["me-id"], labelIds: ["hw"], dueAt: fromDateInputValue("2026-10-18", IST)!.toISOString(), position: 3 }),
    task({ id: "2", number: 2, title: "PID tuning", priority: "URGENT", assigneeIds: ["joel"], dueAt: fromDateInputValue("2026-10-21", IST)!.toISOString(), position: 1 }),
    task({ id: "3", number: 3, title: "Write handout", priority: "LOW", position: 2, typeId: "bug", updatedAt: "2026-10-10T00:00:00.000Z" }),
  ];

  it("parses and serialises URL state", () => {
    const query = parseTaskQuery(new URLSearchParams("assignee=me,none&label=hw&priority=high,bogus&due=overdue&q=%20pid%20&view=list&sort=due&group=assignee"));
    expect(query.filters).toEqual({ assignees: ["me", "none"], creators: [], labels: ["hw"], types: [], priorities: ["HIGH"], due: "overdue", q: "pid" });
    expect(query).toMatchObject({ view: "list", sort: "due", group: "assignee" });
    expect(parseTaskQuery(taskQueryToParams(query))).toEqual(query);
    expect(activeFilterCount(query.filters)).toBe(6);
    expect(parseTaskQuery({ sort: "evil", group: "x" })).toMatchObject({ sort: "manual", group: "column", view: "board" });
  });

  it("filters by assignee, label, priority, due and text", () => {
    const pick = (search: string) => tasks.filter((t) => matchesFilters(t, parseTaskQuery(new URLSearchParams(search)).filters, context)).map((t) => t.id);
    expect(pick("assignee=me")).toEqual(["1"]);
    expect(pick("assignee=none")).toEqual(["3"]);
    expect(pick("label=hw")).toEqual(["1"]);
    expect(pick("priority=URGENT,LOW")).toEqual(["2", "3"]);
    expect(pick("due=overdue")).toEqual(["1"]);
    expect(pick("due=week")).toEqual(["2"]);
    expect(pick("due=none")).toEqual(["3"]);
    expect(pick("q=sensor")).toEqual(["1"]);
    expect(pick("q=%232")).toEqual(["2"]);
    expect(pick("type=bug")).toEqual(["3"]);
  });

  it("sorts and groups", () => {
    expect(sortTasks(tasks, "manual").map((t) => t.id)).toEqual(["2", "3", "1"]);
    expect(sortTasks(tasks, "priority").map((t) => t.id)).toEqual(["2", "1", "3"]);
    expect(sortTasks(tasks, "due").map((t) => t.id)).toEqual(["1", "2", "3"]);
    const groups = groupTasks(tasks, "assignee", { columns: [], members: [{ id: "me-id", name: "Me", image: null }, { id: "joel", name: "Joel", image: null }], labels: [], now: context.now, timeZone: IST });
    expect(groups.map((g) => [g.label, g.tasks.length])).toEqual([["Me", 1], ["Joel", 1], ["Unassigned", 1]]);
  });
});

describe("mentions", () => {
  it("encodes picked names and decodes them back", () => {
    const body = encodeMentions("Thanks @Meera Nair and @Joel, see @Nobody", [{ id: "u1", name: "Meera Nair" }, { id: "u2", name: "Joel" }]);
    expect(body).toBe("Thanks <@u1> and <@u2>, see @Nobody");
    expect(extractMentionIds(body)).toEqual(["u1", "u2"]);
    expect(splitMentions(body).filter((s) => s.type === "mention")).toHaveLength(2);
    expect(decodeMentions(body, (id) => (id === "u1" ? "Meera Nair" : "Joel")).text).toBe("Thanks @Meera Nair and @Joel, see @Nobody");
  });
});

describe("references and keys", () => {
  it("formats and parses task references", () => {
    expect(taskReference("BOT", 12)).toBe("BOT-12");
    expect(taskReference(null, 12)).toBe("#12");
    expect(taskUrl("kochi", "BOT", 12)).toBe("/w/kochi/projects/BOT/12");
    expect(taskUrl("kochi", null, 12)).toBe("/w/kochi/t/12");
    expect(parseTaskReference("bot-12")).toEqual({ key: "BOT", number: 12 });
    expect(parseTaskReference("#7")).toEqual({ key: null, number: 7 });
    expect(parseTaskReference("BOT-0")).toBeNull();
    expect(parseTaskReference("drop table")).toBeNull();
  });
  it("suggests valid project keys", () => {
    expect(suggestProjectKey("Line-follower robot")).toBe("LFR");
    expect(suggestProjectKey("Website")).toBe("WEB");
    expect(isValidProjectKey(suggestProjectKey("3D printer farm"))).toBe(true);
    expect(isValidProjectKey("B")).toBe(false);
  });
});

describe("activity text", () => {
  const context = { nameOf: (id: string) => ({ u1: "Meera", u2: "Joel" })[id] ?? "a former member", timeZone: IST };
  it("describes history in plain language", () => {
    expect(activityText("moved", { from: "To do", to: "Done" }, context)).toBe("moved this from To do to Done");
    expect(activityText("assigned", { userIds: ["u1", "u2"] }, context)).toBe("assigned Meera and Joel");
    expect(activityText("priority", { to: "URGENT" }, context)).toBe("set the priority to urgent");
    expect(activityText("due", { to: null }, context)).toBe("cleared the due date");
    expect(activityText("something-new", {}, context)).toBe("updated this task");
  });
});
