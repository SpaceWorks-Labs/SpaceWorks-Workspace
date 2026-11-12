import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { prisma } from "@/lib/db";
import { invalidateLimits } from "@/lib/limits";
import { createProject, setProjectArchived } from "@/lib/projects/service";
import { cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@prj-restore-${suffix}.test`;
const slug = `prj-restore-${suffix}`;
let workspaceId: string;
let actor: Parameters<typeof createProject>[0];

beforeAll(async () => {
  const owner = await createUser(`owner${domain}`, "Owner");
  const workspace = await createWorkspace(slug, owner.id);
  workspaceId = workspace.id;
  const membership = await prisma.membership.findFirstOrThrow({ where: { workspaceId, userId: owner.id } });
  actor = { user: { id: owner.id, name: "Owner" }, workspace: { id: workspaceId, slug, name: workspace.name, timezone: "UTC" }, membership };
}, 60_000);

afterAll(async () => {
  await cleanup([slug], domain);
  await prisma.$disconnect();
});

describe.sequential("restoring an archived project", () => {
  it("respects the projects limit like creating one", async () => {
    await prisma.workspaceLimits.upsert({ where: { workspaceId }, create: { workspaceId, maxProjects: 1 }, update: { maxProjects: 1 } });
    invalidateLimits(workspaceId);
    const first = await createProject(actor, { name: "Loom", key: "LOOM" });
    expect(first.ok).toBe(true);
    const firstId = (first as { ok: true; data: { id: string } }).data.id;
    expect((await setProjectArchived(actor, { projectId: firstId }, true)).ok).toBe(true);
    expect((await createProject(actor, { name: "Press", key: "PRESS" })).ok).toBe(true);

    const blocked = await setProjectArchived(actor, { projectId: firstId }, false);
    expect(blocked).toMatchObject({ ok: false });
    expect(JSON.stringify(blocked)).toContain("project limit");
    expect((await prisma.project.findUniqueOrThrow({ where: { id: firstId } })).status).toBe("ARCHIVED");

    await prisma.workspaceLimits.update({ where: { workspaceId }, data: { maxProjects: 2 } });
    invalidateLimits(workspaceId);
    expect((await setProjectArchived(actor, { projectId: firstId }, false)).ok).toBe(true);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: firstId } })).status).toBe("ACTIVE");
  });
});
