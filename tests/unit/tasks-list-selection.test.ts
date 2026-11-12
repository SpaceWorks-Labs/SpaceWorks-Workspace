import { describe, expect, it } from "vitest";
import { MAX_BULK } from "@/lib/tasks/bulkSchemas";
import { parseMyTasksTab, visibleMyTaskTabs } from "@/lib/tasks/myTasks";
import { EMPTY_FILTERS, type TaskQuery } from "@/lib/tasks/filters";
import { deserializeQuery, sameQuery, serializeQuery, storageKey, urlHasQuery } from "@/lib/tasks/rememberedQuery";
import { prune, rangeBetween, setMany, toggleAll, toggleOne, triState } from "@/lib/tasks/selection";

const ids = Array.from({ length: 60 }, (_, index) => `t${index}`);

describe("selection logic", () => {
  it("triState reflects none, some and all", () => {
    expect(triState(new Set(), ids.slice(0, 3))).toBe(false);
    expect(triState(new Set(["t0"]), ids.slice(0, 3))).toBe("indeterminate");
    expect(triState(new Set(["t0", "t1", "t2"]), ids.slice(0, 3))).toBe(true);
    expect(triState(new Set(["t0"]), [])).toBe(false);
  });

  it("toggleOne adds and removes", () => {
    const added = toggleOne(new Set(), ids, "t1");
    expect([...added.next]).toEqual(["t1"]);
    expect(toggleOne(added.next, ids, "t1").next.size).toBe(0);
  });

  it("shift range selects from the anchor in visible order, either direction", () => {
    expect(rangeBetween(ids, "t2", "t5")).toEqual(["t2", "t3", "t4", "t5"]);
    expect(rangeBetween(ids, "t5", "t3")).toEqual(["t3", "t4", "t5"]);
    expect(rangeBetween(ids, null, "t3")).toEqual(["t3"]);
    expect(rangeBetween(ids, "gone", "t3")).toEqual(["t3"]);
    expect([...toggleOne(new Set(["t2"]), ids, "t4", { range: true, anchor: "t2" }).next]).toEqual(["t2", "t3", "t4"]);
  });

  it("never selects more than the limit and says so", () => {
    const all = toggleAll(new Set(), ids);
    expect(all.next.size).toBe(MAX_BULK);
    expect(all.limited).toBe(true);
    const ok = toggleAll(new Set(), ids.slice(0, 5));
    expect(ok).toMatchObject({ limited: false });
    expect(ok.next.size).toBe(5);
    expect(toggleAll(ok.next, ids.slice(0, 5)).next.size).toBe(0);
  });

  it("select-all from a partial selection selects the rest; setMany(false) removes", () => {
    expect(toggleAll(new Set(["t0"]), ids.slice(0, 3)).next.size).toBe(3);
    expect([...setMany(new Set(["t0", "t1"]), ["t0"], false).next]).toEqual(["t1"]);
  });

  it("prune drops ids that are no longer visible", () => {
    expect([...prune(new Set(["a", "b"]), new Set(["b"]))]).toEqual(["b"]);
  });
});

describe("remembered task query", () => {
  const query: TaskQuery = { view: "list", sort: "due", group: "assignee", filters: { ...EMPTY_FILTERS, assignees: ["me"], priorities: ["HIGH"], due: "overdue", q: "motor" } };

  it("round-trips through storage", () => {
    const back = deserializeQuery(serializeQuery(query));
    expect(back && sameQuery(back, query)).toBe(true);
  });

  it("ignores malformed or hostile stored values", () => {
    expect(deserializeQuery(null)).toBeNull();
    expect(deserializeQuery("not json")).toBeNull();
    expect(deserializeQuery("42")).toBeNull();
    const odd = deserializeQuery(JSON.stringify({ view: "evil", sort: "nope", group: 3, filters: { assignees: "x", priorities: ["HIGH", "BOGUS"], due: "soon" } }));
    expect(odd).toMatchObject({ view: "board", sort: "manual", group: "column", filters: { assignees: [], priorities: ["HIGH"], due: null } });
  });

  it("detects URL parameters (the URL wins) and keys per project", () => {
    expect(urlHasQuery(new URLSearchParams("task=4"))).toBe(false);
    expect(urlHasQuery(new URLSearchParams("view=list"))).toBe(true);
    expect(urlHasQuery(new URLSearchParams("q=a&task=4"))).toBe(true);
    expect(storageKey("ws", "BOT")).toBe("sww.tasks.view.ws.BOT");
  });
});

describe("my tasks tabs", () => {
  it("defaults unknown tabs to assigned and hides team without reports", () => {
    expect(parseMyTasksTab("team")).toBe("team");
    expect(parseMyTasksTab("nope")).toBe("assigned");
    expect(parseMyTasksTab(undefined)).toBe("assigned");
    expect(visibleMyTaskTabs(false).map((tab) => tab.value)).toEqual(["assigned", "assigned-by-me", "created"]);
    expect(visibleMyTaskTabs(true)).toHaveLength(4);
  });
});

describe("weighted bulk rate limit", () => {
  it("spends one unit per task so 50-task calls cannot bypass the limit", async () => {
    const { checkRateLimitById } = await import("@/lib/rateLimit");
    const subject = `user:weight-${Math.random()}`;
    const results: boolean[] = [];
    for (let call = 0; call < 5; call += 1) results.push(await checkRateLimitById("bulk", subject, MAX_BULK));
    expect(results).toEqual([true, true, true, true, false]);
  });
});
