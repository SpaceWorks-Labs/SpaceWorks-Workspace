import { test, expect, type Page } from "./browser-fixtures";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

const prisma = new PrismaClient();
const suffix = randomUUID().slice(0, 8);
const slug = `people-browser-${suffix}`;
const domain = `@people-browser-${suffix}.test`;
const password = randomUUID();
let workspaceId: string;
let memberId: string;
let privateTeamSlug: string;
async function login(page: Page, who: string) {
  await page.goto(`/login?callbackUrl=/w/${slug}/members`);
  await page.getByLabel("Email", { exact: true }).fill(`${who}${domain}`);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Members", exact: true })).toBeVisible();
}

test.describe("people and relationships browser flows", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });
  test.beforeAll(async () => {
    const passwordHash = await bcrypt.hash(password, 10);
    const users = await Promise.all(["owner", "member", "guest"].map(name => prisma.user.create({ data: { email: `${name}${domain}`, name: `Browser ${name}`, passwordHash, emailVerified: new Date() } })));
    const workspace = await prisma.workspace.create({ data: { slug, name: "People browser workspace", memberships: { create: users.map((u, i) => ({ userId: u.id, role: i === 0 ? "OWNER" : i === 1 ? "MEMBER" : "GUEST" })) } } });
    workspaceId = workspace.id; memberId = users[1].id;
    const privateTeam = await prisma.team.create({ data: { workspaceId, name: "Private browser crew", slug: "private-browser-crew", visibility: "PRIVATE", members: { create: { userId: users[0].id, role: "LEAD" } } } });
    privateTeamSlug = privateTeam.slug;
    await prisma.memberProfile.create({ data: { workspaceId, userId: memberId, skills: { create: { workspaceId, skill: "soldering", level: 3 } } } });
    const org = await prisma.organisation.create({ data: { workspaceId, name: "Browser partner", ownerId: users[0].id } });
    await prisma.contact.create({ data: { workspaceId, displayName: "Browser mentor", ownerId: users[0].id, orgRoles: { create: { organisationId: org.id } } } });
    await prisma.deal.create({ data: { workspaceId, organisationId: org.id, title: "Browser workshop", type: "SPONSORSHIP", stage: "Proposal", amountMinor: 125050, ownerId: users[0].id } });
  });
  test.afterAll(async () => {
    await prisma.workspace.deleteMany({ where: { slug } });
    await prisma.user.deleteMany({ where: { email: { endsWith: domain } } });
    await prisma.$disconnect();
  });
  test("renders all area pages at 375px in both colour modes without page overflow", async ({ page }, testInfo) => {
    await login(page, "owner");
    await page.setViewportSize({ width: 375, height: 812 });
    const pages = [["members", "Members"], ["teams", "Teams"], ["members/availability", "Availability"], ["rota", "Volunteer rota"], ["onboarding", "Onboarding and handovers"], ["settings/onboarding", "Onboarding templates"], ["contacts", "Contacts"], ["contacts/organisations", "Organisations"], ["contacts/pipeline", "Community pipeline"]];
    for (const mode of ["light", "dark"]) {
      await page.context().addCookies([{ name: "sww.color-mode", value: mode, url: testInfo.project.use.baseURL! }]);
      for (const [route, heading] of pages) {
        await page.goto(`/w/${slug}/${route}`);
        await expect(page.locator("#main-content").getByRole("heading", { name: heading, exact: true })).toBeVisible({ timeout: 15_000 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`${mode}-${route.replaceAll("/", "-")}.png`), fullPage: true });
      }
    }
  });
  test("filters the directory and saves a member's own profile", async ({ page }) => {
    await login(page, "member");
    await page.getByLabel("Search members").fill("Browser member");
    await page.getByRole("button", { name: "Find members" }).click();
    await page.getByRole("link", { name: "Browser member", exact: true }).click();
    await page.getByRole("link", { name: "Edit your profile" }).click();
    await page.getByLabel("Bio", { exact: true }).fill("Teaching soldering at build night.");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByText("Changes saved", { exact: true })).toBeVisible();
    await page.goto(`/w/${slug}/members/${memberId}`);
    // Streamed content briefly exists in a hidden node outside <main>; assert the rendered copy.
    await expect(page.locator("#main-content").getByText("Teaching soldering at build night.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "View emergency contact" })).toBeVisible();
    await page.getByRole("button", { name: "View emergency contact" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("No emergency contact saved.")).toBeVisible();
  });
  test("hides private teams and CRM from guests", async ({ page }) => {
    await login(page, "guest");
    await page.goto(`/w/${slug}/teams`);
    await expect(page.getByText("Private browser crew", { exact: true })).toHaveCount(0);
    await page.goto(`/w/${slug}/teams/${privateTeamSlug}`);
    await expect(page.getByRole("heading", { name: "There's nothing here." })).toBeVisible();
    await page.goto(`/w/${slug}/contacts`);
    await expect(page.getByRole("heading", { name: "There's nothing here." })).toBeVisible();
    await expect(page.getByText("Browser mentor", { exact: true })).toHaveCount(0);
  });
});
