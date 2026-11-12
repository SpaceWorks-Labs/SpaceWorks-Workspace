import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ path: "/w/kochi/settings", disabled: ["finance", "vault", "helpdesk"] as string[] }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-sw-path": state.path }), cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/frontend/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/redis", () => ({ getRedis: () => null }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: vi.fn() }));
vi.mock("@/lib/limits/modules", () => ({ getWorkspaceModules: async () => ({ disabledModules: state.disabled, enabledModules: [] }) }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));
vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: async () => ({ id: "u1", name: "M", email: "m@example.com", image: null, disabledAt: null }) },
    workspace: { findUnique: async () => ({ id: "w1", slug: "kochi", status: "ACTIVE", archivedAt: null }) },
    membership: { findUnique: async () => ({ role: "MEMBER", status: "ACTIVE" }) },
  },
}));

import { getWorkspaceForAction } from "@/lib/permissions";
import { runAction } from "@/lib/approvals/action";
import { moduleForArea } from "@/lib/modules";

beforeEach(() => { state.path = "/w/kochi/settings"; });

describe("server action module gate", () => {
  it("refuses an action of a switched-off module even when posted from a core path", async () => {
    expect(await getWorkspaceForAction("kochi", "MEMBER")).not.toBeNull(); // path-derived: core, the old bypass
    expect(await getWorkspaceForAction("kochi", "MEMBER", { module: "finance" })).toBeNull();
    expect(await getWorkspaceForAction("kochi", "MEMBER", { module: "core" })).not.toBeNull();
  });
  it("gates the shared action helpers by their area", async () => {
    const work = vi.fn(async () => "ok");
    expect((await runAction("kochi", "vault", work)).ok).toBe(false);
    expect((await runAction("kochi", "requests", work)).ok).toBe(false);
    expect(work).not.toHaveBeenCalled();
    expect((await runAction("kochi", "forms", work)).ok).toBe(true);
  });
  it("maps areas to modules and defaults to core", () => {
    expect(moduleForArea("subscriptions")).toBe("finance");
    expect(moduleForArea("stock")).toBe("services");
    expect(moduleForArea("calendar")).toBe("core");
    expect(moduleForArea("")).toBe("core");
  });
});
