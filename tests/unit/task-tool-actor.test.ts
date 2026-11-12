import { describe, expect, it } from "vitest";
import { actorFromPrincipal, resolveUserIds, toDueDate, unwrap } from "@/lib/assistant/tools/tasks/actor";
import { getTool, toolsFor } from "@/lib/assistant/tools";
import type { Principal } from "@/lib/assistant/principal";
import { ToolError } from "@/lib/assistant/tools/types";

const workspace = { id: "ws1", slug: "kochi", name: "Kochi", timezone: "Asia/Kolkata", currency: "INR", financeVisibleToMembers: false };
const principal: Principal = { kind: "user", workspace, userId: "u1", userName: "Meera", role: "MEMBER" };

describe("task tool adapter", () => {
  it("builds the service actor with provenance by channel", () => {
    expect(actorFromPrincipal(principal, "mcp")).toMatchObject({ user: { id: "u1", name: "Meera" }, membership: { role: "MEMBER" }, via: { source: "mcp" }, workspace: { timezone: "Asia/Kolkata" } });
    expect(actorFromPrincipal(principal, "chat").via?.source).toBe("assistant");
    expect(actorFromPrincipal(principal, "api").via?.source).toBe("api");
  });

  it("labels history provenance with the API token name, capped at 80 chars", () => {
    expect(actorFromPrincipal({ ...principal, kind: "token", tokenName: "CI bot" }, "api").via).toEqual({ source: "api", client: "CI bot" });
    expect(actorFromPrincipal({ ...principal, kind: "token", tokenName: "x".repeat(200) }, "mcp").via?.client).toHaveLength(80);
  });

  it("keeps date-only days and maps date-times to the workspace day", () => {
    expect(toDueDate("2026-11-02", "Asia/Kolkata")).toBe("2026-11-02");
    expect(toDueDate("2026-11-02T20:00:00Z", "Asia/Kolkata")).toBe("2026-11-03");
    expect(toDueDate(null, "Asia/Kolkata")).toBeNull();
    expect(toDueDate(undefined, "Asia/Kolkata")).toBeUndefined();
  });

  it("resolves me and dedupes assignees", () => {
    expect(resolveUserIds(["me", "u1", "u2"], "u1")).toEqual(["u1", "u2"]);
  });

  it("maps service failures to tool error codes", () => {
    const code = (error: string) => { try { unwrap({ ok: false, error }); } catch (e) { return (e as ToolError).code; } };
    expect(code("You don't have access to do that.")).toBe("forbidden");
    expect(code("That task doesn't exist or you can't see it.")).toBe("not_found");
    expect(code("This project is archived. Restore it to make changes.")).toBe("conflict");
    expect(code("This is a subtask. Move the parent task instead.")).toBe("conflict");
    expect(code("This task is already in that project.")).toBe("conflict");
    expect(code("This task is the template of a repeating task. Stop the repeat before moving it.")).toBe("conflict");
    expect(code("Pick a valid date.")).toBe("invalid");
    expect(unwrap({ ok: true, data: 3 })).toBe(3);
  });

  it("registers the new write tools behind write:tasks for members", () => {
    for (const name of ["sw_add_comment", "sw_archive_task", "sw_move_task", "sw_assign_task", "sw_claim_task"]) {
      expect(getTool(name)).toMatchObject({ write: true, scope: "write:tasks", minRole: "MEMBER" });
    }
    const guest = toolsFor({ ...principal, role: "GUEST" }).map((t) => t.name);
    expect(guest).not.toContain("sw_move_task");
  });
});
