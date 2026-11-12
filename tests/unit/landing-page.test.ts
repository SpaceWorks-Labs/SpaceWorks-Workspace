import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  setupOpen: false,
  user: null as null | { id: string; name: string | null; email: string; image: string | null },
  workspaces: [] as { slug: string; status: string }[],
  lastWorkspace: undefined as string | undefined,
  allowSelfSignup: false,
  requests: [] as { kind: string; status: string; requestedName: string | null; decisionNote: string | null }[],
}));

vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (state.lastWorkspace ? { value: state.lastWorkspace } : undefined) }) }));
vi.mock("@/lib/setup", () => ({ isSetupOpen: async () => state.setupOpen }));
vi.mock("@/lib/permissions", () => ({ getCurrentUser: async () => state.user, isSuperAdminEmail: (email: string) => email === "root@example.org" }));
vi.mock("@/lib/workspaces", () => ({ listUserWorkspaces: async () => state.workspaces }));
vi.mock("@/lib/instanceSettings", () => ({ getInstanceSettings: async () => ({}) }));
vi.mock("@/lib/authSettings", () => ({ getAuthSettings: async () => ({ allowSelfSignup: state.allowSelfSignup }) }));
vi.mock("@/lib/orgRequests/service", () => ({ listRequestsForUser: async () => state.requests }));
vi.mock("@/components/chrome/ColorModeToggle", () => ({ ColorModeToggle: () => null }));

const { default: HomeRedirect } = await import("@/app/page");
const { LandingPage } = await import("@/components/landing/LandingPage");
const { NoWorkspaceHome } = await import("@/components/home/NoWorkspaceHome");
const { RELEASE } = await import("@/components/landing/content");

const render = () => HomeRedirect() as Promise<ReactElement<Record<string, unknown>>>;
const member = { id: "u1", name: "Meera", email: "meera@example.org", image: null };

beforeEach(() => {
  Object.assign(state, { setupOpen: false, user: null, workspaces: [], lastWorkspace: undefined, allowSelfSignup: false, requests: [] });
});

describe("home page entry", () => {
  it("sends a fresh instance to setup first", async () => {
    state.setupOpen = true;
    await expect(render()).rejects.toThrow("redirect:/setup");
  });

  it.each([false, true])("shows signed-out visitors the landing page (self sign-up %s)", async (allowSelfSignup) => {
    state.allowSelfSignup = allowSelfSignup;
    const element = await render();
    expect(element.type).toBe(LandingPage);
    expect(element.props).toEqual({ allowSignup: allowSelfSignup });
  });

  it("keeps sending signed-in members straight to their last workspace", async () => {
    Object.assign(state, { user: member, workspaces: [{ slug: "first", status: "ACTIVE" }, { slug: "last", status: "ACTIVE" }], lastWorkspace: "last" });
    await expect(render()).rejects.toThrow("redirect:/w/last");
    state.lastWorkspace = "gone";
    await expect(render()).rejects.toThrow("redirect:/w/first");
  });

  it("sends the instance super admin to the /admin console", async () => {
    Object.assign(state, { user: { ...member, email: "root@example.org" }, workspaces: [{ slug: "open", status: "ACTIVE" }] });
    await expect(render()).rejects.toThrow("redirect:/admin");
  });

  it("prefers an active workspace and sends admins of a suspended one to its plan page", async () => {
    Object.assign(state, { user: member, workspaces: [{ slug: "paused", status: "SUSPENDED" }, { slug: "open", status: "ACTIVE" }], lastWorkspace: "paused" });
    await expect(render()).rejects.toThrow("redirect:/w/open");
    state.workspaces = [{ slug: "paused", status: "SUSPENDED" }];
    await expect(render()).rejects.toThrow("redirect:/w/paused/settings/plan");
  });

  it("shows a signed-in person without a workspace their requests, never the landing page", async () => {
    state.user = member;
    state.requests = [{ kind: "NEW_ORG", status: "PENDING", requestedName: "Build Club", decisionNote: null }];
    const element = await render();
    expect(element.type).toBe(NoWorkspaceHome);
    expect(element.props).toMatchObject({ email: member.email, superAdmin: false, pendingRequest: { requestedName: "Build Club" }, rejectedRequest: null });
  });
});

describe("landing page", () => {
  const html = (allowSignup: boolean) => renderToStaticMarkup(createElement(LandingPage, { allowSignup }));

  it("offers Sign in always and Create account only when self sign-up is on", () => {
    expect(html(false)).toContain('href="/login"');
    expect(html(false)).not.toContain('href="/signup"');
    expect(html(true)).toContain('href="/signup"');
  });

  it("opens every external link safely and keeps one h1", () => {
    const page = html(true);
    const blank = page.match(/<a\b[^>]*target="_blank"[^>]*>/g) ?? [];
    expect(blank.length).toBeGreaterThan(0);
    for (const link of blank) expect(link).toContain('rel="noopener noreferrer"');
    expect(page.match(/<h1\b/g)).toHaveLength(1);
    expect(page).toContain('id="main-content"');
  });

  it("states the current release", () => {
    expect(RELEASE.version).toBe(JSON.parse(readFileSync("package.json", "utf8")).version);
    expect(readFileSync("CHANGELOG.md", "utf8")).toContain(`## [${RELEASE.version}]`);
  });

  it("stays pure rendering: no server-only, database or loader imports", () => {
    const dir = "components/landing";
    for (const file of readdirSync(dir).filter((name) => /\.tsx?$/.test(name))) {
      const source = readFileSync(path.join(dir, file), "utf8");
      expect(source, file).not.toMatch(/from ["'](?:server-only|@\/lib\/(?:db|permissions|views|authSettings|setup)\b[^"']*)["']|import ["']server-only["']/);
    }
  });
});
