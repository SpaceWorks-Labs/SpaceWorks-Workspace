import { describe, expect, it } from "vitest";
import type { WorkspaceRole } from "@prisma/client";
import { canPerformTaskAction, taskCapabilities, type TaskCapabilityInput } from "@/lib/tasks/capabilities";
import { activityText } from "@/lib/tasks/activityText";

const base = (over: Partial<TaskCapabilityInput> = {}): TaskCapabilityInput => ({
  role: "MEMBER" as WorkspaceRole,
  userId: "me",
  restrictTaskEdits: false,
  projectOwnerId: "boss",
  creatorId: "someone",
  assigneeIds: [],
  ...over,
});

describe("task capabilities", () => {
  it("open projects: every member edits and claims; guests do nothing", () => {
    expect(taskCapabilities(base())).toEqual({ canEdit: true, canClaim: true, canUnclaim: false, isAssignedToMe: false });
    expect(taskCapabilities(base({ assigneeIds: ["x"] })).canClaim).toBe(true);
    expect(taskCapabilities(base({ role: "GUEST" }))).toEqual({ canEdit: false, canClaim: false, canUnclaim: false, isAssignedToMe: false });
  });

  it("restricted: edit needs creator, assignee, project owner or admin", () => {
    const r = (over: Partial<TaskCapabilityInput>) => base({ restrictTaskEdits: true, ...over });
    expect(canPerformTaskAction("edit", r({}))).toBe(false);
    expect(canPerformTaskAction("edit", r({ creatorId: "me" }))).toBe(true);
    expect(canPerformTaskAction("edit", r({ assigneeIds: ["me"] }))).toBe(true);
    expect(canPerformTaskAction("edit", r({ projectOwnerId: "me" }))).toBe(true);
    expect(canPerformTaskAction("edit", r({ role: "ADMIN" }))).toBe(true);
    expect(canPerformTaskAction("edit", r({ role: "OWNER" }))).toBe(true);
  });

  it("restricted: claim only while unassigned; unclaim only as assignee; contribute always for members", () => {
    const r = (over: Partial<TaskCapabilityInput>) => base({ restrictTaskEdits: true, ...over });
    expect(canPerformTaskAction("claim", r({}))).toBe(true);
    expect(canPerformTaskAction("claim", r({ assigneeIds: ["x"] }))).toBe(false);
    expect(taskCapabilities(r({ assigneeIds: ["x"] })).canClaim).toBe(false);
    expect(taskCapabilities(r({ assigneeIds: ["x"], creatorId: "me" })).canClaim).toBe(true);
    expect(canPerformTaskAction("unclaim", r({ assigneeIds: ["me"] }))).toBe(true);
    expect(canPerformTaskAction("unclaim", r({}))).toBe(false);
    expect(canPerformTaskAction("contribute", r({}))).toBe(true);
    expect(canPerformTaskAction("contribute", r({ role: "GUEST" }))).toBe(false);
  });
});

describe("assignment history text", () => {
  const ctx = { nameOf: (id: string) => ({ u1: "Asha", u2: "Bilal" })[id] ?? "someone", timeZone: "UTC" };
  it("renders assignments, claims and unassignments", () => {
    expect(activityText("assigned", { userIds: ["u2"], by: "u1" }, ctx)).toBe("assigned Bilal");
    expect(activityText("assigned", { userIds: ["u1"], by: "u1", claimed: true }, ctx)).toBe("took this task");
    expect(activityText("assigned", { userIds: ["u1"], by: "u1" }, ctx)).toBe("assigned themselves");
    expect(activityText("unassigned", { userIds: ["u1"], by: "u1" }, ctx)).toBe("unassigned themselves");
    expect(activityText("unassigned", { userIds: ["u1", "u2"], by: "u3" }, ctx)).toBe("unassigned Asha and Bilal");
  });
  it("adds a source suffix off the web", () => {
    expect(activityText("assigned", { userIds: ["u2"], by: "u1", source: "web" }, ctx)).toBe("assigned Bilal");
    expect(activityText("assigned", { userIds: ["u2"], by: "u1", source: "assistant" }, ctx)).toBe("assigned Bilal via Assistant");
    expect(activityText("assigned", { userIds: ["u2"], by: "u1", source: "mcp", client: "Cursor" }, ctx)).toBe("assigned Bilal via MCP · Cursor");
    expect(activityText("unassigned", { userIds: ["u2"], by: "u1", source: "api" }, ctx)).toBe("unassigned Bilal via API");
  });
});
