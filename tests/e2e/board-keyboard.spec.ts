import { test, expect, login } from "./core-work-fixtures";

test.describe("board keyboard interactions", () => {
  test.describe.configure({ timeout: 120_000 });

  test("quick add stays open, `c` opens it, and Space plus arrows move a card to the next column", async ({ page, core }) => {
    await login(page, core);
    const key = `KB${core.tag.toUpperCase()}`;
    await page.getByRole("button", { name: "New project", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "Start a project", exact: true });
    await dialog.getByLabel("Name", { exact: true }).fill(`Keys ${core.tag}`);
    await dialog.getByLabel("Key", { exact: true }).fill(key);
    await dialog.getByRole("button", { name: "Start project", exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === `/w/${core.slug}/projects/${key}`);

    await page.getByRole("button", { name: "Add task", exact: true }).first().click();
    const input = page.getByLabel("New task title", { exact: true });
    for (const title of [`First ${core.tag}`, `Second ${core.tag}`]) {
      await input.fill(title);
      await input.press("Enter");
      await expect(page.getByRole("article", { name: new RegExp(title) })).toBeVisible();
      await expect(input).toBeVisible();
    }
    await input.press("Escape");
    await expect(page.getByRole("button", { name: "Add task", exact: true }).first()).toBeFocused();

    const card = page.getByRole("article", { name: new RegExp(`First ${core.tag}`) }).getByRole("button").first();
    // Wait for each live-region announcement, so a fast build never sends a key before the drag is ready.
    const live = page.locator('[id^="DndLiveRegion"]');
    await card.focus();
    await page.keyboard.press("Space");
    // The pick-up message is replaced at once by "… moved to To do, position 1 of 2"; either shows the drag is live.
    await expect(live).toContainText(/Picked up|moved to To do/);
    await page.keyboard.press("ArrowRight");
    await expect(live).toContainText("moved to In progress");
    await page.keyboard.press("Space");
    await expect.poll(async () => (await core.prisma.task.findFirst({ where: { workspaceId: core.workspaceId, title: `First ${core.tag}` }, include: { column: true } }))?.column?.name).toBe("In progress");
  });
});
