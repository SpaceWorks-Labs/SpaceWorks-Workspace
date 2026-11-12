import { describe, expect, it } from "vitest";
import { patchKind } from "@/components/tasks/patchKind";

describe("patchKind", () => {
  it("maps each field group to its call", () => {
    expect(patchKind({ columnId: "c1", completedAt: null })).toBe("move");
    expect(patchKind({ priority: "HIGH" })).toBe("priority");
    expect(patchKind({ dueAt: null })).toBe("due");
    expect(patchKind({ assigneeIds: [] })).toBe("assignees");
  });

  it("throws instead of wiping assignees on an unknown or empty patch", () => {
    expect(() => patchKind({})).toThrow();
    expect(() => patchKind({ columnId: null })).toThrow();
    expect(() => patchKind({ completedAt: null })).toThrow();
  });
});
