import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { expect, test } from "./browser-fixtures";

test.skip(process.env.PLAYWRIGHT_SPLIT !== "1", "The split-hosting harness supplies isolated production servers.");
const prisma = new PrismaClient();
const suffix = randomUUID().slice(0, 8), slug = `gateway-browser-${suffix}`, email = `gateway-browser-${suffix}@example.test`, password = randomUUID();
let userId: string, workspaceId: string;
test.beforeAll(async () => {
  const user = await prisma.user.create({ data: { email, name: "Gateway reviewer", passwordHash: await bcrypt.hash(password, 10), emailVerified: new Date() } });
  userId = user.id;
  const workspace = await prisma.workspace.create({ data: { slug, name: "Gateway browser workspace", memberships: { create: { userId, role: "OWNER" } } } });
  workspaceId = workspace.id;
  await prisma.channel.create({ data: { workspaceId, name: "general", slug: "general", kind: "PUBLIC", createdById: userId, members: { create: { userId } } } });
});
test.afterAll(async () => {
  if (workspaceId) await prisma.workspace.deleteMany({ where: { id: workspaceId, slug } });
  if (userId) await prisma.user.deleteMany({ where: { id: userId, email } });
  await prisma.$disconnect();
});
test("renders shared UI, writes through thin actions and consumes direct stream tickets", async ({ page, request, baseURL }) => {
  test.setTimeout(120_000);
  await page.goto(`/login?callbackUrl=/w/${slug}/chat/general`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(`/w/${slug}/chat/general`);
  // Mention/channel autocomplete gives the textarea an explicit combobox role.
  const composer = page.getByRole("combobox", { name: "Message #general", exact: true });
  await expect(composer).toBeVisible();
  const message = `A message through the gateway ${suffix}`;
  await composer.fill(message);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  // The composer shows the message while it is still saving; wait for the stored copy.
  await expect.poll(() => prisma.message.count({ where: { workspaceId, authorId: userId, body: message } }), { timeout: 15_000 }).toBe(1);

  const ticket = await page.request.post(`/api/realtime/${slug}/ticket`);
  expect(ticket.ok()).toBeTruthy();
  const { token } = await ticket.json();
  const backend = process.env.BACKEND_ORIGIN!;
  const controller = new AbortController();
  const stream = await fetch(`${backend}/api/realtime/${slug}?ticket=${encodeURIComponent(token)}`, { headers: { Origin: baseURL! }, signal: controller.signal });
  try {
    expect(stream.status).toBe(200);
    expect(stream.headers.get("access-control-allow-origin")).toBe(baseURL);
    const first = await stream.body!.getReader().read();
    expect(new TextDecoder().decode(first.value)).toContain("event: ready");
  } finally { controller.abort(); }
  const replay = await fetch(`${backend}/api/realtime/${slug}?ticket=${encodeURIComponent(token)}`, { headers: { Origin: baseURL! } });
  expect(replay.status).toBe(404); await replay.body?.cancel();
  expect((await fetch(`${backend}/w/${slug}`, { redirect: "manual" })).status).toBe(404);
  expect((await request.post("/api/internal/jobs")).status()).toBe(404);
  expect((await request.post("/api/frontend/view/private")).status()).toBe(404);
  const mcp = await request.post("/api/mcp", { data: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  expect(mcp.status()).toBe(401); expect(mcp.headers()["www-authenticate"]).toContain("Bearer");
});
