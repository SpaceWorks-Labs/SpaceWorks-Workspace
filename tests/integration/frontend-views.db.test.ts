import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const session = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: session.id } }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
import { createNote } from "@/lib/notepad/service";
import { prisma } from "@/lib/db";
import { loadNotepadPage } from "@/lib/views/generated/w-workspaceSlug-notepad-page-loadNotepadPage";
import { loadFinanceOverviewPage } from "@/lib/views/generated/w-workspaceSlug-finance-page-loadFinanceOverviewPage";
import { loadAdminOverviewPage } from "@/lib/views/generated/admin-page-loadAdminOverviewPage";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";
const suffix = uniqueSuffix(), domain = `@gateway-${suffix}.test`, slug = `gateway-${suffix}`, otherSlug = `gateway-other-${suffix}`;
let ownerId: string, guestId: string, workspaceId: string;
beforeAll(async () => {
  const owner = await createUser(`owner${domain}`), guest = await createUser(`guest${domain}`), outsider = await createUser(`outsider${domain}`);
  ownerId = owner.id; guestId = guest.id;
  const workspace = await createWorkspace(slug, owner.id); workspaceId = workspace.id;
  await createWorkspace(otherSlug, outsider.id); await addMember(workspace.id, guest.id, "GUEST");
  await createNote({ workspace, user: owner, membership: { role: "OWNER" } }, { title: "Private owner note" });
  await createNote({ workspace, user: guest, membership: { role: "GUEST" } }, { title: "Private guest note" });
});
afterAll(async () => { vi.unstubAllEnvs(); await cleanup([slug, otherSlug], domain); });
const noteView = (workspaceSlug: string) => loadNotepadPage({ params: Promise.resolve({ workspaceSlug }), searchParams: Promise.resolve({}) });
describe("guarded frontend view contracts", () => {
  it("derives membership on the backend and never reveals another tenant", async () => {
    session.id = ownerId;
    await expect(noteView(otherSlug)).rejects.toThrow("NOT_FOUND");
    await expect(noteView(`missing-${suffix}`)).rejects.toThrow("NOT_FOUND");
    const own = await noteView(slug);
    expect(own.data.notes.map(note => note.title)).toEqual(["Private owner note"]);
  });
  it("keeps personal data private to its author and refuses guest finance", async () => {
    session.id = guestId;
    expect((await noteView(slug)).data.notes.map(note => note.title)).toEqual(["Private guest note"]);
    await expect(loadFinanceOverviewPage({ params: Promise.resolve({ workspaceSlug: slug }), searchParams: Promise.resolve({}) })).rejects.toThrow("NOT_FOUND");
  });
  it("checks suspended membership on every view request", async () => {
    session.id = guestId;
    await prisma.membership.update({ where: { userId_workspaceId: { userId: guestId, workspaceId } }, data: { status: "SUSPENDED" } });
    await expect(noteView(slug)).rejects.toThrow("NOT_FOUND");
  });
  it("requires the independent fresh admin MFA proof", async () => {
    session.id = ownerId; vi.stubEnv("SUPER_ADMIN_EMAIL", `owner${domain}`);
    await expect(loadAdminOverviewPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/admin-mfa");
  });
});
