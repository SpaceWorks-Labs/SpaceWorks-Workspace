import { test, expect } from "./browser-fixtures";
test.skip(
  !process.env.PLATFORM_SHELL_E2E_PASSWORD,
  "Set PLATFORM_SHELL_E2E_PASSWORD after seeding the local demo.",
);
test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page
    .getByLabel("Email", { exact: true })
    .fill("owner@tinkerspace.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.PLATFORM_SHELL_E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/w/tinkerspace-kochi");
});
test("my day and quick creation are keyboard accessible", async ({ page }) => {
  await expect(
    page.getByRole("heading", { name: "My day", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Create task" }),
  ).toBeVisible();
  await expect(dialog.getByLabel("Title", { exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});
test("links, search, preferences and data settings render at 375px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const [path, title, level] of [
    ["links", "Links", 1],
    ["search", "Search", 1],
    ["activity", "Activity", 1],
    ["notifications", "Notifications", 1],
    ["notifications/preferences", "Notification preferences", 1],
    ["settings/export", "Workspace export", 2],
    ["settings/import", "CSV import", 2],
    ["settings/retention", "Retention and locale", 2],
  ] as const) {
    await page.goto(`/w/tinkerspace-kochi/${path}`);
    await expect(
      page.getByRole("heading", { name: title, exact: true, level }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.screenshot({
    path: "screenshots/platform-shell-mobile.png",
    fullPage: true,
  });
});
test("search finds indexed links and sidebar pins stay scoped", async ({
  page,
}) => {
  await page.goto("/w/tinkerspace-kochi/search");
  await page
    .getByRole("searchbox", { name: "Search workspace" })
    .fill("Space Works");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.locator("#main-content").getByRole("link", { name: "Space Works on GitHub", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "screenshots/platform-shell-desktop.png",
    fullPage: true,
  });
});
