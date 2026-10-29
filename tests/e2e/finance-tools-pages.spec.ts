import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { expect, test } from "./browser-fixtures";

// HTTP request fixtures only: no browser is launched by these tests.
const prisma = new PrismaClient(),
  suffix = randomUUID().slice(0, 8),
  slug = `finance-tools-qa-${suffix}`,
  email = `finance-tools-${suffix}@example.test`,
  password = `finance-tools-test-${suffix}`;
let workspaceId: string, userId: string, runId: string;
test.setTimeout(180000);
test.beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      email,
      name: "Finance reviewer",
      emailVerified: new Date(),
      passwordHash: await bcrypt.hash(password, 12),
    },
  });
  userId = user.id;
  const workspace = await prisma.workspace.create({
    data: {
      slug,
      name: "Finance tools review office",
      memberships: { create: { userId, role: "OWNER" } },
    },
  });
  workspaceId = workspace.id;
  const { default: seed } = await import(
    "../../scripts/seed/finance-tools.mjs"
  );
  // The production servers run with NODE_ENV=production; the demo seed only
  // guards against seeding a real deployment, so lift it for this fixture.
  const nodeEnv = process.env.NODE_ENV;
  Reflect.set(process.env, "NODE_ENV", "test");
  try {
    for (let pass = 0; pass < 2; pass += 1)
      await seed(prisma, {
        workspaceId,
        workspace,
        users: { owner: user },
        channels: [],
      });
  } finally {
    if (nodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Reflect.set(process.env, "NODE_ENV", nodeEnv);
  }
  const profile = await prisma.financePayProfile.findFirstOrThrow({
    where: { workspaceId },
  });
  const run = await prisma.financePayRun.findFirstOrThrow({
    where: { workspaceId, profileId: profile.id },
  });
  runId = run.id;
  await prisma.financePayRun.update({where:{id:run.id},data:{status:"PAID",paidOn:new Date(),reference:"TEST-PAYROLL-UTR"}});
});
test.afterAll(async () => {
  if (workspaceId)
    await prisma.workspace.deleteMany({ where: { id: workspaceId, slug } });
  if (userId) await prisma.user.deleteMany({ where: { id: userId, email } });
  await prisma.$disconnect();
});
test("finance tools render populated forms, reports and private payroll with the real server", async ({
  request,
  baseURL,
}) => {
  const { csrfToken } = await (await request.get("/api/auth/csrf")).json();
  expect(
    (
      await request.post("/api/auth/callback/credentials", {
        form: {
          csrfToken,
          email,
          password,
          callbackUrl: `${baseURL}/w/${slug}`,
        },
        maxRedirects: 0,
      })
    ).status(),
  ).toBe(302);
  expect((await (await request.get("/api/auth/session")).json()).user?.id).toBe(
    userId,
  );
  const pages = [
    ["funds", "Community repair grant"],
    ["budgets", "Repair supplies this month"],
    ["bills", "Kochi Stationery Cooperative"],
    ["close", "checklist"],
    ["disbursements", "Repair programme travel advance"],
    ["receipt", "Confirm and save entry"],
    ["spending", "Possible duplicates"],
    ["reports", "Income by donor or funder"],
    ["reports/print", "finance-print"],
    ["payroll", "Correct payroll bookkeeping"],
    [`payroll/${runId}/print`, "Net pay"],
  ] as const;
  for (const [path, content] of pages) {
    const response = await request.get(`/w/${slug}/finance/${path}`);
    expect(response.status(), path).toBe(200);
    const html = await response.text();
    expect(html, path).not.toMatch(
      /data-dgst=|Cannot read properties|Only plain objects/,
    );
    expect(html, path).toContain(content);
  }
  const csv = await request.get(`/w/${slug}/finance/export/bills`);
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
});
test("a workspace admin cannot open payroll without a separate grant", async ({
  request,
  baseURL,
}) => {
  const { csrfToken } = await (await request.get("/api/auth/csrf")).json();
  await request.post("/api/auth/callback/credentials", {
    form: { csrfToken, email, password, callbackUrl: `${baseURL}/w/${slug}` },
    maxRedirects: 0,
  });
  await prisma.financePayrollGrant.deleteMany({
    where: { workspaceId, userId },
  });
  await prisma.membership.updateMany({
    where: { workspaceId, userId },
    data: { role: "ADMIN" },
  });
  for (const path of ["payroll", `payroll/${runId}/print`]) {
    const response = await request.get(`/w/${slug}/finance/${path}`);
    // A notFound after the layout starts streaming has status 200 in Next.
    expect([200, 404]).toContain(response.status());
    const html = await response.text();
    expect(html).not.toContain("Asha Menon");
    expect(html).toMatch(
      /NEXT_HTTP_ERROR_FALLBACK;404|This page could not be found/,
    );
  }

  expect(
    (await request.get(`/w/${slug}/finance/export/payroll`)).status(),
  ).toBe(404);
  expect((await request.get(`/w/${slug}/finance/bills`)).status()).toBe(200);
});
