import { test, expect, login, createDoc, downloadBytes, expectDeniedPage } from "./core-work-fixtures";

// No demo-account or split-layout skip: these journeys own all their test data.
test.describe("core work and private knowledge browser journeys", () => {
  test.describe.configure({ timeout: 120_000 });

  test("creates and updates a project and task, with mobile board controls and persisted completion", async ({ page, core }, testInfo) => {
    await login(page, core);
    const name = `Build ${core.tag}`;
    const key = `QA${core.tag.toUpperCase()}`;
    await page.getByRole("button", { name: "New project", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: "Start a project", exact: true });
    await dialog.getByLabel("Name", { exact: true }).fill(name);
    await dialog.getByLabel("Key", { exact: true }).fill(key);
    await dialog.getByRole("button", { name: "Start project", exact: true }).click();
    await expect(page).toHaveURL(url => url.pathname === `/w/${core.slug}/projects/${key}`);
    await page.getByRole("button", { name: "Add task", exact: true }).first().click();
    const title = `Calibrate ${core.tag}`;
    await page.getByLabel("New task title", { exact: true }).fill(title);
    await page.getByLabel("New task title", { exact: true }).press("Enter");
    await expect.poll(() => core.prisma.task.count({ where: { workspaceId: core.workspaceId, title } })).toBe(1);
    const task = await core.prisma.task.findFirstOrThrow({ where: { workspaceId: core.workspaceId, title } });
    const reference = `${key}-${task.number}`;
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole("button", { name: `Move ${reference}`, exact: true }).click();
    await page.getByRole("menuitem", { name: "In progress", exact: true }).click();
    await expect.poll(async () => (await core.prisma.task.findUnique({ where: { id: task.id }, include: { column: true } }))?.column?.name).toBe("In progress");
    await page.getByRole("article", { name: `${reference} ${title}`, exact: true }).getByRole("button").first().click();
    const renamed = `${title} safely`;
    await page.getByLabel("Task title", { exact: true }).fill(renamed);
    await page.getByLabel("Task title", { exact: true }).press("Enter");
    await expect.poll(async () => (await core.prisma.task.findUnique({ where: { id: task.id } }))?.title).toBe(renamed);
    await page.getByRole("button", { name: "Mark done", exact: true }).click();
    await expect.poll(async () => Boolean((await core.prisma.task.findUnique({ where: { id: task.id } }))?.completedAt)).toBe(true);
    await page.goto(`/w/${core.slug}/projects/${key}/${task.number}`);
    await expect(page.getByLabel("Task title", { exact: true })).toHaveValue(renamed);
    await page.getByRole("button", { name: "Reopen", exact: true }).click();
    await expect.poll(async () => (await core.prisma.task.findUnique({ where: { id: task.id } }))?.completedAt).toBeNull();
    await page.screenshot({ path: testInfo.outputPath("task-mobile.png"), fullPage: true });
    await page.goto(`/w/${core.slug}/projects/${key}/settings`);
    await page.getByLabel("Name", { exact: true }).fill(`${name} revised`);
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByText("Project saved.", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(`${name} revised`);
  });

  test("sends durable channel messages through desktop and mobile composers in either layout", async ({ page, core }, testInfo) => {
    await login(page, core, "owner", "chat/general");
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 812 });
      const message = `Core message ${core.tag} at ${width}`;
      await page.getByRole("combobox", { name: "Message #general", exact: true }).fill(message);
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await expect.poll(() => core.prisma.message.count({ where: { workspaceId: core.workspaceId, authorId: core.owner.id, body: message } })).toBe(1);
      await page.reload();
      await expect(page.getByText(message, { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`chat-${width}.png`), fullPage: true });
    }
  });

  test("creates, autosaves, renames and exports a document, retaining its content on mobile", async ({ page, core }, testInfo) => {
    await login(page, core);
    const title = `Workshop guide ${core.tag}`;
    const body = `Disconnect power before calibration. Fixture ${core.tag}.`;
    const presence = page.waitForResponse(response => new URL(response.url()).pathname.startsWith(`/w/${core.slug}/docs/`)
      && new URL(response.url()).pathname.endsWith("/presence") && response.request().method() === "POST");
    const doc = await createDoc(page, core, title, body);
    const presenceResponse = await presence;
    expect(presenceResponse.status()).toBe(200);
    expect(await presenceResponse.json()).toEqual({ ok: true });
    const renamed = `${title} revised`;
    await page.getByLabel("Page title", { exact: true }).fill(renamed);
    await page.getByLabel("Page title", { exact: true }).press("Tab");
    await expect.poll(async () => (await core.prisma.doc.findUnique({ where: { id: doc.id } }))?.title).toBe(renamed);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Page actions", exact: true }).click();
    const pending = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Export as Markdown", exact: true }).click();
    const markdown = (await downloadBytes(await pending)).toString("utf8");
    expect(markdown).toContain(renamed);
    expect(markdown).toContain(body);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload();
    await expect(page.getByLabel("Page title", { exact: true })).toHaveValue(renamed);
    await expect(page.getByLabel("Page content", { exact: true })).toHaveText(body);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("document-mobile.png"), fullPage: true });
  });

  test("uploads and downloads file versions, then revokes member access with an admin-only page", async ({ page, browser, request, core }, testInfo) => {
    await login(page, core);
    await page.setViewportSize({ width: 375, height: 812 });
    const title = `Private instructions ${core.tag}`;
    const doc = await createDoc(page, core, title, `Restricted procedure ${core.tag}.`);
    await page.goto(`/w/${core.slug}/files`);
    const filename = `calibration-${core.tag}.txt`;
    const original = Buffer.from(`Original calibration ${core.tag}\n`);
    const upload = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Upload files", exact: true }).first().click();
    await (await upload).setFiles({ name: filename, mimeType: "text/plain", buffer: original });
    await expect.poll(() => core.prisma.fileObject.count({ where: { workspaceId: core.workspaceId, filename } })).toBe(1);
    const file = await core.prisma.fileObject.findFirstOrThrow({ where: { workspaceId: core.workspaceId, filename } });
    await page.getByRole("link", { name: filename, exact: true }).click();
    const firstDownload = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download", exact: true }).click();
    expect(await downloadBytes(await firstDownload)).toEqual(original);
    const updated = Buffer.from(`Revised calibration ${core.tag}\n`);
    const replace = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Upload new version", exact: true }).click();
    await (await replace).setFiles({ name: filename, mimeType: "text/plain", buffer: updated });
    await page.getByRole("dialog", { name: "Upload a new version", exact: true }).getByRole("button", { name: "Upload version", exact: true }).click();
    await expect.poll(async () => (await core.prisma.fileObject.findUnique({ where: { id: file.id } }))?.currentVersion).toBe(2);
    await page.reload();
    const secondDownload = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download", exact: true }).click();
    expect(await downloadBytes(await secondDownload)).toEqual(updated);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("file-mobile.png"), fullPage: true });
    const versionUrl = `/w/${core.slug}/files/${file.id}/versions/1`;
    expect(await (await page.request.get(versionUrl)).body()).toEqual(original);
    await page.getByRole("button", { name: "More file actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Link to a page or task…", exact: true }).click();
    const linkDialog = page.getByRole("dialog", { name: "Link to a page or task", exact: true });
    await linkDialog.getByLabel("Find a page or task", { exact: true }).fill(title);
    await linkDialog.getByRole("button", { name: `${title} Page`, exact: true }).click();
    await linkDialog.getByRole("button", { name: "Save links", exact: true }).click();
    await expect.poll(async () => (await core.prisma.fileObject.findUnique({ where: { id: file.id } }))?.docId).toBe(doc.id);
    const memberContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL, extraHTTPHeaders: testInfo.project.use.extraHTTPHeaders });
    const outsiderContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL, extraHTTPHeaders: testInfo.project.use.extraHTTPHeaders });
    try {
      const memberPage = await memberContext.newPage();
      await login(memberPage, core, "member", `docs/${doc.id}`);
      await expect(memberPage.getByLabel("Page title", { exact: true })).toHaveValue(title);
      const fileUrl = `/api/files/${file.id}?download=1`;
      const memberDownload = await memberPage.request.get(fileUrl);
      expect(memberDownload.status()).toBe(200);
      expect(await memberDownload.body()).toEqual(updated);
      expect(memberDownload.headers()["cache-control"]).toContain("private");
      await page.goto(`/w/${core.slug}/docs/${doc.id}`);
      await page.getByRole("button", { name: "Page actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "Make admin-only…", exact: true }).click();
      await page.getByRole("button", { name: "Make admin-only", exact: true }).click();
      await expect(page.getByText("Page is now admin-only.", { exact: true })).toBeVisible();
      const exportUrl = `/w/${core.slug}/docs/${doc.id}/export?format=md`;
      await expectDeniedPage(memberPage, `/w/${core.slug}/docs/${doc.id}`, title);
      for (const url of [fileUrl, versionUrl, exportUrl]) expect((await memberPage.request.get(url)).status()).toBe(404);
      const presenceDenied = await memberPage.request.post(`/w/${core.slug}/docs/${doc.id}/presence`, {
        headers: { origin: new URL(testInfo.project.use.baseURL!).origin, "x-sw-client": "1" }, data: { state: "viewing" },
      });
      expect(presenceDenied.status()).toBe(404);
      await expectDeniedPage(page, `/w/${core.foreignSlug}/docs/${doc.id}`, title);
      const outsiderPage = await outsiderContext.newPage();
      await login(outsiderPage, core, "outsider");
      for (const route of [`docs/${doc.id}`, `files/${file.id}`]) await expectDeniedPage(outsiderPage, `/w/${core.slug}/${route}`, title);
      // The outsider owns this other tenant: its valid slug must not resolve our IDs.
      for (const route of [`docs/${doc.id}`, `files/${file.id}`]) await expectDeniedPage(outsiderPage, `/w/${core.foreignSlug}/${route}`, title);
      expect((await outsiderPage.request.get(`/w/${core.foreignSlug}/files/${file.id}/versions/1`)).status()).toBe(404);
      for (const url of [fileUrl, versionUrl, exportUrl]) expect((await outsiderPage.request.get(url)).status()).toBe(404);
      expect((await request.get(fileUrl)).status()).toBe(404);
    } finally {
      await memberContext.close();
      await outsiderContext.close();
    }
  });
});
