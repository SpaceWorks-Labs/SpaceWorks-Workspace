import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pages(path);
    return name === "page.tsx" ? [path] : [];
  });
}

describe("admin pages", () => {
  // Layout checks do not re-run on client navigation, so each page must
  // verify super-admin + fresh MFA itself.
  it.each(pages("app/admin"))("%s calls requireSuperAdminMfa itself", (file) => {
    expect(readFileSync(file, "utf8")).toMatch(/await requireSuperAdminMfa\(\)/);
  });
});

describe("workspace pages", () => {
  it.each(pages("app/w/[workspaceSlug]"))("%s resolves membership with requireWorkspace", (file) => {
    expect(readFileSync(file, "utf8")).toMatch(/await requireWorkspace\(workspaceSlug/);
  });
});

describe("public home page", () => {
  // `/` is public: signed-out visitors get the landing page; everyone signed
  // in is still redirected to a workspace (or sees "no workspace yet").
  it("renders the landing page only when there is no session", () => {
    const source = readFileSync("app/page.tsx", "utf8");
    expect(source).toMatch(/const user = await getCurrentUser\(\);/);
    expect(source).toMatch(/if \(!user\) return <LandingPage /);
    expect(source).toContain("if (home) redirect(home);");
    expect(source.indexOf("if (home) redirect")).toBeLessThan(source.indexOf("if (!user) return <LandingPage"));
  });
});
