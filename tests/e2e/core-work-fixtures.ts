import { test as base, expect, type Download, type Page } from "./browser-fixtures";
import { PrismaClient } from "@prisma/client";
import { DeleteObjectsCommand, S3Client } from "@aws-sdk/client-s3";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";

type Account = { id: string; email: string };
export type CoreFixture = {
  prisma: PrismaClient;
  tag: string;
  slug: string;
  foreignSlug: string;
  workspaceId: string;
  password: string;
  owner: Account;
  member: Account;
  outsider: Account;
};

/** Only keys belonging to these disposable tenants are eligible for removal. */
async function cleanup(prisma: PrismaClient, slugs: string[], emails: string[]) {
  try {
    const workspaces = await prisma.workspace.findMany({ where: { slug: { in: slugs } }, select: { id: true } });
    const ids = workspaces.map(({ id }) => id);
    const files = await prisma.fileObject.findMany({
      where: { workspaceId: { in: ids } },
      select: { storageKey: true, versions: { select: { storageKey: true } } },
    });
    const keys = [...new Set(files.flatMap(file => [file.storageKey, ...file.versions.map(version => version.storageKey)]))];
    if (keys.some(key => !ids.some(id => key.startsWith(`workspaces/${id}/files/`)) || key.split("/").includes(".."))) {
      throw new Error("Refusing cleanup outside the core browser fixture tenants.");
    }
    try {
      if (keys.length && process.env.S3_BUCKET && process.env.S3_REGION) {
        const accessKeyId = process.env.S3_ACCESS_KEY_ID;
        const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
        const storage = new S3Client({
          region: process.env.S3_REGION,
          ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
          forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "1",
          ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
        });
        try {
          const result = await storage.send(new DeleteObjectsCommand({
            Bucket: process.env.S3_BUCKET,
            Delete: { Objects: keys.map(Key => ({ Key })), Quiet: true },
          }));
          if (result.Errors?.length) throw new Error("Core browser fixture object cleanup failed.");
        } finally { storage.destroy(); }
      } else {
        const root = path.resolve(".data/storage");
        for (const key of keys) {
          const target = path.resolve(root, key);
          if (!target.startsWith(root + path.sep)) throw new Error("Invalid fixture object path.");
          await rm(target, { force: true });
        }
      }
    } finally {
      await prisma.workspace.deleteMany({ where: { id: { in: ids }, slug: { in: slugs } } });
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
    }
  } finally { await prisma.$disconnect(); }
}

async function createFixture(): Promise<{ core: CoreFixture; dispose: () => Promise<void> }> {
  const prisma = new PrismaClient();
  const tag = randomUUID().replaceAll("-", "").slice(0, 8);
  const slug = `core-browser-${tag}`;
  const foreignSlug = `core-foreign-${tag}`;
  const password = randomUUID();
  const names = ["owner", "member", "outsider"] as const;
  const emails = names.map(name => `${name}@core-browser-${tag}.test`);
  const dispose = () => cleanup(prisma, [slug, foreignSlug], emails);
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const [owner, member, outsider] = await Promise.all(names.map((name, index) => prisma.user.create({
      data: { email: emails[index], name: `Core ${name} ${tag}`, passwordHash, emailVerified: new Date() },
    })));
    const workspace = await prisma.workspace.create({ data: {
      slug, name: `Core browser ${tag}`,
      memberships: { create: [{ userId: owner.id, role: "OWNER" }, { userId: member.id, role: "MEMBER" }] },
    } });
    await prisma.workspace.create({ data: {
      slug: foreignSlug, name: `Foreign browser ${tag}`, memberships: { create: { userId: outsider.id, role: "OWNER" } },
    } });
    await prisma.channel.create({ data: {
      workspaceId: workspace.id, name: "general", slug: "general", kind: "PUBLIC", createdById: owner.id,
      members: { create: [{ userId: owner.id }, { userId: member.id }] },
    } });
    return { core: { prisma, tag, slug, foreignSlug, workspaceId: workspace.id, password, owner, member, outsider }, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}

export const test = base.extend<{ core: CoreFixture }>({
  core: async ({}, provideFixture) => {
    const { core, dispose } = await createFixture();
    try { await provideFixture(core); } finally { await dispose(); }
  },
});
export { expect };

export async function login(page: Page, core: CoreFixture, who: "owner" | "member" | "outsider" = "owner", route = "projects") {
  const slug = who === "outsider" ? core.foreignSlug : core.slug;
  const destination = `/w/${slug}/${route}`;
  await page.goto(`/login?callbackUrl=${encodeURIComponent(destination)}`);
  await page.getByLabel("Email", { exact: true }).fill(core[who].email);
  await page.getByLabel("Password", { exact: true }).fill(core.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(url => url.pathname === destination);
}

export async function createDoc(page: Page, core: CoreFixture, title: string, body: string) {
  await page.goto(`/w/${core.slug}/docs`);
  await page.getByRole("button", { name: "New page", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "New page", exact: true });
  await dialog.getByLabel(/^Title(?:\s*Optional)?$/).fill(title);
  await dialog.getByRole("button", { name: "Create page", exact: true }).click();
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue(title);
  await page.locator('[contenteditable="true"][aria-label="Page content"]').fill(body);
  await expect.poll(async () => (await core.prisma.doc.findFirst({ where: { workspaceId: core.workspaceId, title } }))?.contentText).toBe(body);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  return core.prisma.doc.findFirstOrThrow({ where: { workspaceId: core.workspaceId, title } });
}

export async function downloadBytes(download: Download) {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Expected a readable browser download.");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function expectDeniedPage(page: Page, url: string, secret: string) {
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "There's nothing here.", exact: true })).toBeVisible();
  await expect(page.getByText(secret, { exact: true })).toHaveCount(0);
}
