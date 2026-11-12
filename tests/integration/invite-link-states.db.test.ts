import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { acceptInvitation, inviteLinkState } from "@/lib/invitations";
import { createInvitationToken, invitationExpiry } from "@/lib/invitationTokens";
import { listUserWorkspaces } from "@/lib/workspaces";
import { cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@ils-${suffix}.test`;
const slug = `ils-${suffix}`;
const closedSlug = `ils-closed-${suffix}`;
let workspaceId: string;
let closedId: string;
let ownerId: string;

async function invite(email: string, overrides: { workspaceId?: string; expiresAt?: Date; revokedAt?: Date } = {}) {
  const { token, tokenHash } = createInvitationToken();
  await prisma.invitation.create({
    data: { workspaceId: overrides.workspaceId ?? workspaceId, email, role: "MEMBER", tokenHash, expiresAt: overrides.expiresAt ?? invitationExpiry(), revokedAt: overrides.revokedAt, invitedById: ownerId },
  });
  return token;
}

describe.sequential("invitation links: every state, then landing in the workspace", () => {
  beforeAll(async () => {
    ownerId = (await createUser(`owner${domain}`, "Asha")).id;
    workspaceId = (await createWorkspace(slug, ownerId)).id;
    closedId = (await createWorkspace(closedSlug, ownerId)).id;
    await prisma.workspace.update({ where: { id: closedId }, data: { status: "SUSPENDED" } });
  });

  afterAll(async () => {
    await cleanup([slug, closedSlug], domain);
    await prisma.$disconnect();
  });

  it("a new person sees the pending invitation, creates an account and lands in the workspace", async () => {
    const token = await invite(`new${domain}`);
    const before = await inviteLinkState(token);
    expect(before).toMatchObject({ state: "PENDING", invitation: { email: `new${domain}`, existingAccount: false } });
    const accepted = await acceptInvitation(token, { kind: "new", name: "New Person", password: "a long enough password" });
    expect(accepted).toMatchObject({ ok: true, workspaceSlug: slug });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: `new${domain}` } });
    expect(user.emailVerified).not.toBeNull();
    expect((await listUserWorkspaces(user.id)).map((w) => w.slug)).toEqual([slug]);
    expect(await inviteLinkState(token)).toEqual({ state: "ACCEPTED", workspaceName: `Workspace ${slug}`, inviterName: "Asha" });
  });

  it("an existing account is flagged so the page asks it to sign in, then joins", async () => {
    const existing = await createUser(`existing${domain}`);
    const token = await invite(`existing${domain}`);
    expect(await inviteLinkState(token)).toMatchObject({ state: "PENDING", invitation: { existingAccount: true } });
    expect(await acceptInvitation(token, { kind: "existing", userId: existing.id })).toMatchObject({ ok: true, workspaceSlug: slug });
    expect((await listUserWorkspaces(existing.id)).map((w) => w.slug)).toEqual([slug]);
  });

  it("says why a link stopped working: expired or withdrawn", async () => {
    const expired = await invite(`late${domain}`, { expiresAt: new Date(Date.now() - 1000) });
    const revoked = await invite(`gone${domain}`, { revokedAt: new Date() });
    expect(await inviteLinkState(expired)).toMatchObject({ state: "EXPIRED", workspaceName: `Workspace ${slug}` });
    expect(await inviteLinkState(revoked)).toMatchObject({ state: "REVOKED" });
  });

  it("treats unknown tokens and closed organisations alike, and refuses to accept into a closed one", async () => {
    expect(await inviteLinkState("not-a-token")).toEqual({ state: "INVALID" });
    expect(await inviteLinkState(createInvitationToken().token)).toEqual({ state: "INVALID" });
    const closed = await invite(`closed${domain}`, { workspaceId: closedId });
    expect(await inviteLinkState(closed)).toEqual({ state: "INVALID" });
    expect(await acceptInvitation(closed, { kind: "new", name: "Closed", password: "a long enough password" })).toMatchObject({ ok: false });
    expect(await prisma.user.findUnique({ where: { email: `closed${domain}` } })).toBeNull();
  });
});
