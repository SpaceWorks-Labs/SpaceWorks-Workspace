import "server-only";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { renderNotificationEmail } from "./templates";
import { assertEmailAccepted } from "./transporter";
import { createSmtpTransport, describeSmtpFailure, invalidateWorkspaceTransport, isSmtpPortAllowed, loadWorkspaceSmtp, pinSmtpHost, WorkspaceEmailError } from "./workspaceTransport";

export { WorkspaceEmailError };

/** Settings shape sent to the page: never includes the password, only whether one is saved. */
export type WorkspaceEmailSettingsView = {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  hasPassword: boolean;
  fromEmail: string;
  fromName: string;
  replyTo: string;
  lastVerifiedAt: string | null;
  lastError: string | null;
};

const email = z.string().trim().email().max(254);
export const emailSettingsInput = z.object({
  enabled: z.boolean(),
  host: z.string().trim().min(1, "Enter the SMTP host.").max(255),
  port: z.coerce.number().int().min(1).max(65_535).refine(isSmtpPortAllowed, "Use SMTP port 25, 465, 587 or 2525."),
  secure: z.boolean(),
  username: z.string().trim().max(255).optional().default(""),
  /** Blank keeps the saved password. */
  password: z.string().max(1024).optional().default(""),
  fromEmail: email,
  fromName: z.string().trim().max(120).optional().default(""),
  replyTo: z.union([email, z.literal("")]).optional().default(""),
});

export async function getWorkspaceEmailSettingsView(workspaceId: string): Promise<WorkspaceEmailSettingsView | null> {
  const row = await prisma.workspaceEmailSettings.findUnique({ where: { workspaceId } });
  if (!row) return null;
  return {
    enabled: row.enabled,
    host: row.host,
    port: row.port,
    secure: row.secure,
    username: row.username ?? "",
    hasPassword: Boolean(row.passwordEnc),
    fromEmail: row.fromEmail,
    fromName: row.fromName ?? "",
    replyTo: row.replyTo ?? "",
    lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
    lastError: row.lastError,
  };
}

export async function saveWorkspaceEmailSettings(workspaceId: string, actorId: string, raw: unknown) {
  const input = emailSettingsInput.parse(raw);
  await pinSmtpHost(input.host, input.port);
  const existing = await prisma.workspaceEmailSettings.findUnique({ where: { workspaceId }, select: { passwordEnc: true } });
  const passwordEnc = input.password ? encryptSecret("workspace-smtp", input.password) : input.username ? existing?.passwordEnc ?? null : null;
  const data = {
    enabled: input.enabled,
    host: input.host,
    port: input.port,
    secure: input.secure,
    username: input.username || null,
    passwordEnc,
    fromEmail: input.fromEmail,
    fromName: input.fromName || null,
    replyTo: input.replyTo || null,
    lastVerifiedAt: null,
    lastError: null,
    updatedById: actorId,
  };
  await prisma.workspaceEmailSettings.upsert({ where: { workspaceId }, create: { workspaceId, ...data }, update: data });
  invalidateWorkspaceTransport(workspaceId);
}

const VERIFY_TIMEOUT_MS = 15_000;

async function withTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })), VERIFY_TIMEOUT_MS); })]);
  } finally {
    clearTimeout(timer);
  }
}

/** Connect and authenticate with the saved settings (even while disabled). Records the outcome. */
export async function verifyWorkspaceEmailSettings(workspaceId: string) {
  const config = await loadWorkspaceSmtp(workspaceId, { includeDisabled: true });
  if (!config) throw new WorkspaceEmailError("Save your SMTP settings first.");
  let transporter: ReturnType<typeof createSmtpTransport> | undefined;
  try {
    transporter = createSmtpTransport(config, { pooled: false, pin: await pinSmtpHost(config.host, config.port) });
    await withTimeout(transporter.verify());
    await prisma.workspaceEmailSettings.updateMany({ where: { workspaceId }, data: { lastVerifiedAt: new Date(), lastError: null } });
  } catch (error) {
    const message = describeSmtpFailure(error);
    await prisma.workspaceEmailSettings.updateMany({ where: { workspaceId }, data: { lastVerifiedAt: null, lastError: message } });
    throw new WorkspaceEmailError(message);
  } finally {
    transporter?.close();
  }
}

/** Send a short test message through the saved settings (even while disabled) to `to`. */
export async function sendWorkspaceTestEmail(workspaceId: string, to: string, workspaceName: string) {
  const config = await loadWorkspaceSmtp(workspaceId, { includeDisabled: true });
  if (!config) throw new WorkspaceEmailError("Save your SMTP settings first.");
  let transporter: ReturnType<typeof createSmtpTransport> | undefined;
  try {
    transporter = createSmtpTransport(config, { pooled: false, pin: await pinSmtpHost(config.host, config.port) });
    const rendered = renderNotificationEmail({ title: "Test email from Space Works", bodyHtml: `This message was sent through the outgoing email settings of ${workspaceName.replace(/[<>&"']/g, "")}.` });
    const from = config.fromName?.trim() ? `"${config.fromName.trim().replace(/["\\\r\n]/g, "")}" <${config.fromEmail}>` : config.fromEmail;
    const result = await withTimeout(transporter.sendMail({ from, ...(config.replyTo ? { replyTo: config.replyTo } : {}), to, subject: rendered.subject, text: rendered.text, html: rendered.html }));
    assertEmailAccepted(result);
  } catch (error) {
    throw new WorkspaceEmailError(describeSmtpFailure(error));
  } finally {
    transporter?.close();
  }
}
