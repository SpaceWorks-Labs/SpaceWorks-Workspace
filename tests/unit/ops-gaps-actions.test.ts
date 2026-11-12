import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ getWorkspaceForAction: vi.fn() }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: vi.fn() }));
import { revalidatePath } from "next/cache";
import { getWorkspaceForAction } from "@/lib/permissions";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { action, instant } from "@/lib/opsGaps/action";
import { OperationsError, type OpsActor } from "@/lib/opsGaps/context";
const actor = { user: { id: "user", name: "Operator" }, workspace: { id: "tenant", slug: "staff", name: "Staff", timezone: "Asia/Kolkata" }, membership: { role: "MEMBER" } } as OpsActor;
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getWorkspaceForAction).mockResolvedValue(actor as Awaited<ReturnType<typeof getWorkspaceForAction>>); vi.mocked(isActionRateLimited).mockResolvedValue(false); });
describe("internal operations action boundary", () => {
  it("resolves tenant from slug and invalidates only its guarded area", async () => {
    const work = vi.fn(async a => { expect(a.workspace.id).toBe("tenant"); return "Saved."; });
    expect((await action("staff","helpdesk",false,work)).ok).toBe(true);
    expect(getWorkspaceForAction).toHaveBeenCalledWith("staff","MEMBER",{ module: "helpdesk" });
    expect(isActionRateLimited).toHaveBeenCalledWith("apiWrite","user");
    expect(revalidatePath).toHaveBeenCalledWith("/w/staff/helpdesk","layout");
  });
  it("does not invoke writes without membership", async () => {
    vi.mocked(getWorkspaceForAction).mockResolvedValue(null); const work = vi.fn();
    expect((await action("foreign","safety",false,work)).ok).toBe(false); expect(work).not.toHaveBeenCalled(); expect(isActionRateLimited).not.toHaveBeenCalled();
  });
  it("enforces the capability even if a resolver returns a lesser role", async () => {
    const work = vi.fn(); expect((await action("staff","access-reviews",true,work)).ok).toBe(false); expect(work).not.toHaveBeenCalled();
  });
  it("fails closed on a rate limit", async () => {
    vi.mocked(isActionRateLimited).mockResolvedValue(true); const work = vi.fn(); expect((await action("staff","helpdesk",false,work)).ok).toBe(false); expect(work).not.toHaveBeenCalled();
  });
  it("returns field errors but withholds database/provider errors", async () => {
    const a = await action("staff","helpdesk",false,async () => { throw new OperationsError("Enter a title.",{ title: ["Enter a title."] }); });
    expect(a).toEqual({ ok: false, error: "Enter a title.", fieldErrors: { title: ["Enter a title."] } });
    const b = await action("staff","helpdesk",false,async () => { throw new Error("Private database connection detail"); });
    expect(JSON.stringify(b)).not.toContain("Private database");
  });
  it("interprets local forms in the workspace time zone and rejects invalid times", () => {
    const form = new FormData(); form.set("when","2026-10-20T09:00"); expect(instant(form,"when",actor)).toBe("2026-10-20T03:30:00.000Z");
    form.set("when","2026-02-30T09:00"); expect(() => instant(form,"when",actor)).toThrow("valid date");
  });
});
