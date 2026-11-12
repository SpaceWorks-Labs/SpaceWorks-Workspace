import { test, expect, type Page } from "./browser-fixtures";

/**
 * Each workspace role sees only its own shell (docs/ROLES.md): the sidebar,
 * the settings tabs and the pages behind them. Needs the seeded demo
 * (`npm run db:seed:demo`) and its password in PLATFORM_SHELL_E2E_PASSWORD.
 */
test.skip(!process.env.PLATFORM_SHELL_E2E_PASSWORD, "Set PLATFORM_SHELL_E2E_PASSWORD after seeding the local demo.");
test.describe.configure({ timeout: 900_000 }); // opens every visible page; a cold dev server compiles each one

const BASE = "/w/tinkerspace-kochi";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.waitForLoadState("networkidle"); // a cold dev server hydrates late; a pre-hydration click reloads the form
  await page.getByLabel("Username or email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(process.env.PLATFORM_SHELL_E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(`**${BASE}`, { timeout: 90_000 });
}

async function sidebar(page: Page) {
  const nav = page.locator('aside nav[aria-label="Workspace"]');
  await expect(nav).toBeVisible();
  return nav.locator("a").evaluateAll((links) => links.map((link) => ({ label: link.textContent!.trim(), href: link.getAttribute("href")! })));
}

async function settingsTabs(page: Page) {
  await page.goto(`${BASE}/settings`);
  return page.locator('nav[aria-label="Workspace settings"] a').allTextContents();
}

/** Every visible link must open: a role never sees a link that 404s for it. */
async function expectAllOpen(page: Page, hrefs: string[]) {
  for (const href of [...new Set(hrefs.map((h) => h.split("#")[0]!))]) {
    // Some index pages (chat) move on to a child route at once, which aborts a "load" wait.
    const response = await page.goto(href, { waitUntil: "commit", timeout: 120_000 }).catch(() => null);
    await page.waitForLoadState("load");
    if (response) expect(response.status(), href).toBeLessThan(400);
    await expect(async () => {
      await page.waitForLoadState("load");
      expect(await page.getByRole("heading", { name: "There's nothing here." }).count(), href).toBe(0);
      expect(await page.locator("main").count(), href).toBeGreaterThan(0);
    }).toPass({ timeout: 60_000 });
  }
}

/** notFound() under a loading.tsx boundary streams with status 200, so check the rendered not-found page. */
async function expectHidden(page: Page, paths: string[]) {
  for (const path of paths) {
    await page.goto(`${BASE}${path}`);
    await expect(page.getByRole("heading", { name: "There's nothing here." }), path).toBeVisible({ timeout: 60_000 });
  }
}

test("owner sees administration, the plan and every settings tab", async ({ page }) => {
  await signIn(page, "owner@tinkerspace.test");
  const labels = (await sidebar(page)).map((link) => link.label);
  expect(labels).toEqual(expect.arrayContaining(["Workspace", "Plan & limits", "Governance", "Money controls"]));
  const tabs = await settingsTabs(page);
  expect(tabs).toEqual(expect.arrayContaining(["General", "Members", "Payments", "Email sending", "Plan & limits", "Audit log"]));
  await expect(page.getByText("Owner", { exact: true }).first()).toBeVisible();
});

test("admin sees administration but not the owner's plan", async ({ page }) => {
  await signIn(page, "admin@tinkerspace.test");
  const links = await sidebar(page);
  const labels = links.map((link) => link.label);
  expect(labels).toContain("Workspace");
  expect(labels).not.toContain("Plan & limits");
  const tabs = await settingsTabs(page);
  expect(tabs).toContain("Members");
  expect(tabs).not.toContain("Plan & limits");
  await expectAllOpen(page, links.filter((link) => link.href.startsWith(BASE)).map((link) => link.href));
  await expectHidden(page, ["/settings/plan"]);
});

test("member sees work areas and no administration", async ({ page }) => {
  await signIn(page, "meera@tinkerspace.test");
  const links = await sidebar(page);
  const labels = links.map((link) => link.label);
  expect(labels).toEqual(expect.arrayContaining(["My tasks", "Direct messages", "Assistant", "Vault"]));
  for (const hidden of ["Workspace", "Governance", "Hiring", "Money controls", "Official documents", "SEO", "Plan & limits"]) expect(labels).not.toContain(hidden);
  await expectAllOpen(page, links.filter((link) => link.href.startsWith(BASE)).map((link) => link.href));
  await expectHidden(page, ["/settings", "/settings/members", "/governance", "/hiring"]);
});

test("guest sees only guest areas", async ({ page }) => {
  await signIn(page, "guest@tinkerspace.test");
  const links = await sidebar(page);
  const labels = links.map((link) => link.label);
  expect(labels).toEqual(expect.arrayContaining(["Home", "Calendar", "Projects", "Channels", "Docs"]));
  for (const hidden of ["My tasks", "Direct messages", "Assistant", "Vault", "Finance", "Workspace", "Contacts", "Services"]) expect(labels).not.toContain(hidden);
  await expect(page.getByRole("button", { name: "Create task" })).toHaveCount(0);
  await expectAllOpen(page, links.filter((link) => link.href.startsWith(BASE)).map((link) => link.href));
  await expectHidden(page, ["/settings", "/my-tasks", "/dm", "/vault", "/finance"]);
});
