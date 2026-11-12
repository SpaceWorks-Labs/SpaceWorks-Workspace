import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const sent: { host: string; message: Record<string, unknown> }[] = [];
vi.mock("nodemailer", () => ({
  default: {
    createTransport: (options: { host: string }) => ({
      options,
      close: () => undefined,
      verify: async () => true,
      sendMail: async (message: Record<string, unknown>) => { sent.push({ host: options.host, message }); return { accepted: [String(message.to)], rejected: [] }; },
    }),
  },
}));

import { prisma } from "@/lib/db";
import { enqueueEmail, enqueueInviteEmail, deliverOutboxBatch } from "@/lib/outbox";
import { getWorkspaceEmailSettingsView, saveWorkspaceEmailSettings, verifyWorkspaceEmailSettings } from "@/lib/email/workspaceSettings";
import { processNotifyDelivery } from "@/lib/notify/deliver";
import { dispatch } from "@/lib/notify/dispatch";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@emailws-${suffix}.test`;
const slug = `emailws-${suffix}`;
let workspaceId: string;
let owner: string;
let admin: string;

describe.sequential("workspace email", () => {
  beforeAll(async () => {
    owner = (await createUser(`owner${domain}`)).id;
    admin = (await createUser(`admin${domain}`)).id;
    workspaceId = (await createWorkspace(slug, owner)).id;
    await addMember(workspaceId, admin, "ADMIN");
  });
  afterAll(async () => {
    await cleanup([slug], domain);
  });

  it("round-trips settings encrypted and never exposes the password", async () => {
    await saveWorkspaceEmailSettings(workspaceId, owner, { enabled: true, host: "8.8.8.8", port: 587, secure: false, username: "mailer", password: "hunter2-secret", fromEmail: `hi${domain}`, fromName: "Makers", replyTo: "" });
    const row = await prisma.workspaceEmailSettings.findUniqueOrThrow({ where: { workspaceId } });
    expect(row.passwordEnc).toBeTruthy();
    expect(row.passwordEnc).not.toContain("hunter2");
    const view = await getWorkspaceEmailSettingsView(workspaceId);
    expect(view).toMatchObject({ host: "8.8.8.8", hasPassword: true, username: "mailer" });
    expect(JSON.stringify(view)).not.toMatch(/hunter2|passwordEnc/);
    // Blank password keeps the saved secret.
    await saveWorkspaceEmailSettings(workspaceId, owner, { enabled: true, host: "8.8.8.8", port: 587, secure: false, username: "mailer", password: "", fromEmail: `hi${domain}`, fromName: "Makers", replyTo: "" });
    expect((await prisma.workspaceEmailSettings.findUniqueOrThrow({ where: { workspaceId } })).passwordEnc).toBe(row.passwordEnc);
    await verifyWorkspaceEmailSettings(workspaceId);
    expect((await prisma.workspaceEmailSettings.findUniqueOrThrow({ where: { workspaceId } })).lastVerifiedAt).not.toBeNull();
  });

  it("blocks private SMTP hosts unless the instance allows private targets", async () => {
    await expect(saveWorkspaceEmailSettings(workspaceId, owner, { enabled: true, host: "10.0.0.5", port: 25, secure: false, username: "", password: "", fromEmail: `hi${domain}`, fromName: "", replyTo: "" })).rejects.toThrow(/private/i);
  });

  it("sends workspace-scoped outbox mail through the workspace transport and account mail through the instance", async () => {
    sent.length = 0;
    const invoice = await enqueueEmail(prisma, { workspaceId, to: `client${domain}`, subject: "Invoice 1", html: "<p>Pay</p>", text: "Pay" });
    const invite = await enqueueInviteEmail(prisma, { workspaceId, to: `new${domain}`, workspaceName: "W", role: "MEMBER", inviteUrl: "https://example.com/invite/x", expiresAt: new Date(Date.now() + 3_600_000) });
    await deliverOutboxBatch(10, { ids: [invoice.id, invite.id] });
    const viaWorkspace = sent.filter((s) => s.host === "8.8.8.8");
    expect(viaWorkspace).toHaveLength(1);
    expect(viaWorkspace[0]!.message).toMatchObject({ to: `client${domain}`, from: `"Makers" <hi${domain}>` });
    expect(sent.filter((s) => s.message.to === `new${domain}` && s.host === "8.8.8.8")).toHaveLength(0);
  });

  it("alerts admins once when a destination flips to ERROR, not on later failures", async () => {
    const destination = await prisma.notificationDestination.create({ data: { workspaceId, name: "Ops Slack", kind: "SLACK", config: { channelId: "C1" }, createdById: owner } });
    const make = async () => {
      const result = await dispatch(workspaceId, { type: "notification.test", title: "ping", data: { destinationId: destination.id } }, { onlyDestinationIds: [destination.id] });
      return result.deliveries.find((d) => d.target === `destination:${destination.id}`)!.id!;
    };
    await prisma.notificationDelivery.updateMany({ where: { workspaceId }, data: { isTest: false } });
    for (let i = 0; i < 2; i++) {
      const id = await make();
      await prisma.notificationDelivery.update({ where: { id }, data: { isTest: false } });
      expect((await processNotifyDelivery(id)).status).toBe("failed");
    }
    expect(await prisma.notificationDestination.findUniqueOrThrow({ where: { id: destination.id } })).toMatchObject({ health: "ERROR" });
    const alerts = await prisma.notification.findMany({ where: { userId: admin, kind: "system.destination_failed" } });
    expect(alerts).toHaveLength(1);
  });
});
