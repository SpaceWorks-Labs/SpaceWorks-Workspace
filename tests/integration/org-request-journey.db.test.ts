import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import { prisma } from "@/lib/db";
import { findWorkspaceForUser } from "@/lib/permissions";
import { addressProblem, applyNewOrgApproval, applyRequestDecision, createOrgRequest, updateOrgRequest } from "@/lib/orgRequests/service";
import { listUserWorkspaces } from "@/lib/workspaces";
import { cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@orj-${suffix}.test`;
const slugs = [`orj-a-${suffix}`, `orj-b-${suffix}`, `orj-c-${suffix}`, `orj-auto-${suffix}`, `orj-auto2-${suffix}`, `orj-taken-${suffix}`];
let requesterId: string;
let otherId: string;
let adminId: string;
let requestId: string;

async function setSetting(key: string, value: string | null) {
  if (value === null) await prisma.instanceSetting.deleteMany({ where: { key } });
  else await prisma.instanceSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

const mailTo = (to: string) => prisma.outboxMessage.findMany({ where: { kind: "email", payload: { path: ["to"], equals: to } }, orderBy: { createdAt: "asc" } });

describe.sequential("organisation request journey: request, edit, approve, land", () => {
  beforeAll(async () => {
    process.env.SUPER_ADMIN_EMAIL = `root${domain}`;
    requesterId = (await createUser(`req${domain}`)).id;
    otherId = (await createUser(`other${domain}`)).id;
    adminId = (await createUser(`root${domain}`)).id;
    await createWorkspace(slugs[5]!, otherId);
  });

  afterAll(async () => {
    await setSetting("workspaces.requireApproval", null);
    await setSetting("limits.maxWorkspacesPerOwner", null);
    await prisma.orgRequest.deleteMany({ where: { requestedBy: { email: { endsWith: domain } } } });
    await cleanup(slugs, domain);
    await prisma.$disconnect();
  });

  it("a user with no workspace sends a request; requester and super admin both get an email", async () => {
    expect(await listUserWorkspaces(requesterId)).toEqual([]);
    const result = await createOrgRequest(requesterId, { kind: "NEW_ORG", name: "Maker Club", slug: slugs[0]!, message: "Weekly build nights" });
    expect(result).toMatchObject({ ok: true, data: { status: "PENDING", workspaceSlug: null } });
    requestId = result.ok ? result.data.requestId : "";
    const received = JSON.stringify((await mailTo(`req${domain}`)).map((row) => row.payload));
    expect(received).toContain("We received your request");
    expect(received).toContain("/account/organisations");
    expect(JSON.stringify((await mailTo(`root${domain}`)).map((row) => row.payload))).toContain("/admin/requests");
  });

  it("checks address availability, keeping the request's own address free for it", async () => {
    expect(await addressProblem(slugs[1]!)).toBeNull();
    expect(await addressProblem(slugs[5]!)).toMatch(/taken/);
    expect(await addressProblem(slugs[0]!)).toMatch(/taken/);
    expect(await addressProblem(slugs[0]!, requestId)).toBeNull();
    expect(await addressProblem("admin")).toMatch(/reserved/);
  });

  it("lets only the requester edit a pending request, with the same address rules", async () => {
    expect(await updateOrgRequest(otherId, requestId, { name: "Hijack", slug: slugs[2]!, message: null })).toMatchObject({ ok: false });
    expect(await updateOrgRequest(requesterId, requestId, { name: "Maker Club", slug: slugs[5]!, message: null })).toMatchObject({ ok: false, fieldErrors: { slug: [expect.any(String)] } });
    expect(await updateOrgRequest(requesterId, requestId, { name: "Kochi Makers", slug: slugs[1]!, message: "Build nights and workshops" })).toEqual({ ok: true, data: null });
    const row = await prisma.orgRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(row).toMatchObject({ requestedName: "Kochi Makers", requestedSlug: slugs[1], message: "Build nights and workshops", status: "PENDING" });
  });

  it("approval creates the organisation, emails a link to it, and the requester lands in it as owner", async () => {
    const decided = await applyNewOrgApproval(requestId, adminId, null);
    expect(decided).toMatchObject({ ok: true, data: { workspaceSlug: slugs[1] } });
    const workspaces = await listUserWorkspaces(requesterId);
    expect(workspaces).toEqual([expect.objectContaining({ slug: slugs[1], name: "Kochi Makers", role: "OWNER" })]);
    const context = await findWorkspaceForUser(slugs[1]!, requesterId);
    expect(context?.membership).toMatchObject({ role: "OWNER", status: "ACTIVE" });
    const mails = JSON.stringify((await mailTo(`req${domain}`)).map((row) => row.payload));
    expect(mails).toContain("was approved");
    expect(mails).toContain(`/w/${slugs[1]}`);
  });

  it("refuses edits and second decisions once decided", async () => {
    expect(await updateOrgRequest(requesterId, requestId, { name: "Late change", slug: slugs[2]!, message: null })).toMatchObject({ ok: false });
    expect(await applyRequestDecision(requestId, "REJECTED", adminId, "Too late")).toMatchObject({ ok: false });
  });

  it("with approval off, creates the organisation at once and respects limits.maxWorkspacesPerOwner", async () => {
    await setSetting("workspaces.requireApproval", "false");
    await setSetting("limits.maxWorkspacesPerOwner", "2");
    // The requester already owns one organisation, so one more fits and the next does not.
    const first = await createOrgRequest(requesterId, { kind: "NEW_ORG", name: "Second", slug: slugs[3]! });
    expect(first).toMatchObject({ ok: true, data: { status: "APPROVED", workspaceSlug: slugs[3] } });
    expect((await listUserWorkspaces(requesterId)).map((w) => w.slug).sort()).toEqual([slugs[1], slugs[3]].sort());
    const over = await createOrgRequest(requesterId, { kind: "NEW_ORG", name: "Third", slug: slugs[4]! });
    expect(over).toMatchObject({ ok: false, error: expect.stringMatching(/up to 2 organisations/) });
    expect(await prisma.workspace.findUnique({ where: { slug: slugs[4]! } })).toBeNull();
  });
});
