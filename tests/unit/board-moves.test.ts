import { describe, expect, it } from "vitest";
import { activityText } from "@/lib/tasks/activityText";
import { announce, applyOptimisticMove, buildLayout, columnDropId, findContainer, moveAcross, positionIn, relativeAfterId, settleDrop } from "@/lib/tasks/boardMoves";
import { canonicalTaskRedirect } from "@/lib/tasks/links";
import { effectiveType } from "@/lib/tasks/taskTypes";
import type { BoardTask, ColumnDTO } from "@/lib/tasks/types";

const columns: ColumnDTO[] = [
  { id: "todo", name: "To do", position: 0, category: "TODO" },
  { id: "doing", name: "In progress", position: 1, category: "IN_PROGRESS" },
  { id: "done", name: "Done", position: 2, category: "DONE" },
];
const card = (id: string, columnId: string, position: number): BoardTask => ({ id, number: Number(id.slice(1)), title: id, columnId, position }) as BoardTask;
const tasks = [card("a1", "todo", 10), card("a2", "todo", 20), card("a3", "todo", 30), card("b1", "doing", 10)];

describe("board layout and drops", () => {
  const layout = buildLayout(columns, tasks);
  it("orders each column by position and keeps empty columns", () => {
    expect(layout).toEqual({ todo: ["a1", "a2", "a3"], doing: ["b1"], done: [] });
    expect(findContainer(layout, "b1")).toBe("doing");
    expect(findContainer(layout, columnDropId("done"))).toBe("done");
    expect(findContainer(layout, "zzz")).toBeNull();
  });
  it("moves a card into an empty column", () => {
    const next = moveAcross(layout, "a2", columnDropId("done"), false);
    expect(next).toEqual({ todo: ["a1", "a3"], doing: ["b1"], done: ["a2"] });
    expect(settleDrop(next, "a2", columnDropId("done"))).toMatchObject({ columnId: "done", afterTaskId: null });
  });
  it("lands before or after the hovered card", () => {
    expect(moveAcross(layout, "a1", "b1", false).doing).toEqual(["a1", "b1"]);
    expect(moveAcross(layout, "a1", "b1", true).doing).toEqual(["b1", "a1"]);
    expect(settleDrop(moveAcross(layout, "a1", "b1", true), "a1", "a1")).toMatchObject({ columnId: "doing", afterTaskId: "b1" });
  });
  it("reorders within a column and reports the card above", () => {
    expect(settleDrop(layout, "a3", "a1")).toMatchObject({ columnId: "todo", afterTaskId: null });
    expect(settleDrop(layout, "a1", "a3")?.layout.todo).toEqual(["a2", "a3", "a1"]);
    expect(settleDrop(layout, "a1", "a3")?.afterTaskId).toBe("a3");
  });
  it("resolves the Move menu choices", () => {
    const list = ["a1", "a2", "a3"];
    expect(relativeAfterId(list, "a3", "up")).toBe("a1");
    expect(relativeAfterId(list, "a2", "up")).toBeNull();
    expect(relativeAfterId(list, "a1", "down")).toBe("a2");
    expect(relativeAfterId(list, "a3", "down")).toBe("a2");
    expect(relativeAfterId(list, "a2", "top")).toBeNull();
    expect(relativeAfterId(list, "a1", "bottom")).toBe("a3");
  });
  it("shows an optimistic move with a position between neighbours and syncs completion", () => {
    const moved = applyOptimisticMove(tasks, columns, "a1", "todo", "a2");
    expect(moved.find((t) => t.id === "a1")!.position).toBe(25);
    const done = applyOptimisticMove(tasks, columns, "a1", "done", null, new Date("2026-11-01T00:00:00Z"));
    expect(done.find((t) => t.id === "a1")).toMatchObject({ columnId: "done", completedAt: "2026-11-01T00:00:00.000Z" });
    expect(applyOptimisticMove(done, columns, "a1", "doing", null).find((t) => t.id === "a1")!.completedAt).toBeNull();
  });
});

describe("announcements", () => {
  it("speaks pick up, position, drop and cancel", () => {
    expect(announce.pickedUp("BOT-12", "Wire the sensor")).toBe("Picked up BOT-12 Wire the sensor.");
    expect(announce.over("BOT-12", "In progress", 3, 7)).toBe("BOT-12 moved to In progress, position 3 of 7.");
    expect(announce.dropped("BOT-12", "In progress")).toBe("Dropped BOT-12 in In progress.");
    expect(announce.cancelled()).toBe("Move cancelled.");
  });
  it("computes the 1-based position of a card", () => {
    expect(positionIn({ a: ["x", "y"] }, "a", "y")).toEqual({ position: 2, count: 2 });
    expect(positionIn({ a: ["x", "y"] }, "a", "new")).toEqual({ position: 3, count: 3 });
  });
});

describe("history text and links for types and transfers", () => {
  const context = { nameOf: (id: string) => ({ u1: "Asha", u2: "Bilal" })[id] ?? "someone", timeZone: "Asia/Kolkata" };
  it("describes type_changed", () => {
    expect(activityText("type_changed", { from: "Task", to: "Bug" }, context)).toBe("changed the type from Task to Bug");
    expect(activityText("type_changed", { to: "Bug" }, context)).toBe("set the type to Bug");
  });
  it("describes transferred with dropped assignees and provenance", () => {
    const data = { from: { key: "BOT", name: "Robots" }, to: { key: "OPS", name: "Operations" }, droppedAssignees: ["u1", "u2"] };
    expect(activityText("transferred", data, context)).toBe("moved this from Robots (BOT) to Operations (OPS); unassigned Asha and Bilal");
    expect(activityText("transferred", { ...data, droppedAssignees: [], source: "mcp" }, context)).toBe("moved this from Robots (BOT) to Operations (OPS) via MCP");
  });
  it("resolves the effective type and canonical redirects", () => {
    const types = [{ id: "t", isDefault: true }, { id: "b", isDefault: false }];
    expect(effectiveType(types, "b")?.id).toBe("b");
    expect(effectiveType(types, null)?.id).toBe("t");
    expect(effectiveType(types, "gone")?.id).toBe("t");
    expect(canonicalTaskRedirect("ws", "BOT", { number: 12, projectKey: "OPS" })).toBe("/w/ws/projects/OPS/12");
    expect(canonicalTaskRedirect("ws", "ops", { number: 12, projectKey: "OPS" })).toBeNull();
    expect(canonicalTaskRedirect("ws", "BOT", { number: 12, projectKey: null })).toBe("/w/ws/t/12");
  });
});
