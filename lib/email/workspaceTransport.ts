import "server-only";

import net from "node:net";
import nodemailer, { type Transporter } from "nodemailer";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { getEmailSettings } from "@/lib/instanceSettings";
import { privateTargetsEnabled, resolveTarget, STRICT_POLICY, type NetworkPolicy } from "@/lib/monitor/ssrf";
import { getEmailTransport } from "./transporter";

/**
 * Per-workspace outbound SMTP for workspace-scoped mail (notification,
 * invoice, campaign). Account mail (reset, verification, invite, admin) must
 * keep using `getEmailTransport()` from ./transporter.
 *
 * `getEmailTransportFor(workspaceId)` returns the workspace's pooled transport
 * when its settings are enabled and complete, otherwise the instance transport
 * (null in development without SMTP, like `getEmailTransport`).
 */

export type WorkspaceSmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  password: string | null;
  fromEmail: string;
  fromName: string | null;
  replyTo: string | null;
  updatedAt: Date;
};

export class WorkspaceEmailError extends Error {
  override name = "WorkspaceEmailError";
}

/** Ports a workspace may use for SMTP; anything else needs the instance's private-targets switch. */
export const SMTP_PORTS = [25, 465, 587, 2525] as const;

export function isSmtpPortAllowed(port: number) {
  return privateTargetsEnabled() || (SMTP_PORTS as readonly number[]).includes(port);
}

/** How long a pooled transport keeps the address it resolved before DNS is checked again. */
const PIN_TTL_MS = 60_000;

export type SmtpPin = { address: string; hostname: string };

/**
 * Validate the port, resolve the host and return the one address to connect to.
 * Every connection uses this address, so a name that later resolves to an
 * internal address (DNS rebinding) is never dialled.
 */
export async function pinSmtpHost(host: string, port: number): Promise<SmtpPin> {
  if (!isSmtpPortAllowed(port)) throw new WorkspaceEmailError("Use SMTP port 25, 465, 587 or 2525.");
  const policy: NetworkPolicy = privateTargetsEnabled() ? { allowPrivate: true, allowlist: [host.trim().toLowerCase(), "0.0.0.0/0", "::/0"] } : STRICT_POLICY;
  const target = await resolveTarget(host, policy);
  if (!target.ok) throw new WorkspaceEmailError(target.message);
  return { address: target.addresses[0]!.address, hostname: target.hostname };
}

/** A short, fixed description of an SMTP failure. The server's own text is never passed on. */
export function describeSmtpFailure(error: unknown): string {
  if (error instanceof WorkspaceEmailError) return error.message;
  if ((error as { name?: unknown } | null)?.name === "EmailRecipientRejectedError") return "The SMTP server rejected the recipient.";
  const e = (error ?? {}) as { code?: unknown; responseCode?: unknown; message?: unknown };
  const code = typeof e.code === "string" ? e.code : "";
  const message = typeof e.message === "string" ? e.message : "";
  if (code === "EAUTH" || e.responseCode === 535) return "Sign-in to the SMTP server failed. Check the username and password.";
  if (code === "ECONNREFUSED") return "The SMTP server refused the connection.";
  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT" || code === "ECONNECTION" && /time/i.test(message)) return "The SMTP server did not answer in time.";
  if (/^(ERR_TLS|ERR_SSL|CERT_|DEPTH_ZERO|UNABLE_TO|SELF_SIGNED|ERR_OSSL)/.test(code) || /\b(tls|ssl|certificate)\b/i.test(message)) return "The secure connection to the SMTP server failed.";
  return "Couldn't reach the SMTP server. Check the host, port and security setting.";
}

type Cached = { stamp: number; address: string; at: number; transporter: Transporter };
const CACHE_KEY = Symbol.for("sww.workspaceSmtpTransports");
type GlobalWithCache = typeof globalThis & { [CACHE_KEY]?: Map<string, Cached> };

function cache(): Map<string, Cached> {
  const g = globalThis as GlobalWithCache;
  return (g[CACHE_KEY] ??= new Map());
}

export function invalidateWorkspaceTransport(workspaceId: string) {
  const entry = cache().get(workspaceId);
  cache().delete(workspaceId);
  entry?.transporter.close();
}

/** Build a transport from explicit settings. Pass `pooled: false` for one-off verify/test sends. */
export function createSmtpTransport(config: Pick<WorkspaceSmtpConfig, "host" | "port" | "secure" | "username" | "password">, options: { pooled?: boolean; pin: SmtpPin }): Transporter {
  const production = process.env.NODE_ENV === "production";
  const { address, hostname } = options.pin;
  return nodemailer.createTransport({
    host: address,
    name: hostname,
    port: config.port,
    secure: config.secure,
    auth: config.username && config.password ? { user: config.username, pass: config.password } : undefined,
    disableFileAccess: true,
    disableUrlAccess: true,
    requireTLS: production && !config.secure,
    // Connect to the validated address but verify the certificate for the name the admin entered.
    tls: { ...(net.isIP(hostname) ? {} : { servername: hostname }), ...(production ? { minVersion: "TLSv1.2" as const, rejectUnauthorized: true } : {}) },
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 60_000,
    ...(options.pooled === false ? {} : { pool: true, maxConnections: 3, maxMessages: 100 }),
  });
}

/** Active workspace SMTP settings (any, with `includeDisabled`), or null when disabled, incomplete or the secret cannot be opened. */
export async function loadWorkspaceSmtp(workspaceId: string, options: { includeDisabled?: boolean } = {}): Promise<WorkspaceSmtpConfig | null> {
  const row = await prisma.workspaceEmailSettings.findUnique({ where: { workspaceId } });
  if (!row || (!row.enabled && !options.includeDisabled) || !row.host || !row.port || !row.fromEmail) return null;
  let password: string | null = null;
  if (row.passwordEnc) {
    try {
      password = decryptSecret("workspace-smtp", row.passwordEnc);
    } catch {
      return null;
    }
  }
  return { host: row.host, port: row.port, secure: row.secure, username: row.username, password, fromEmail: row.fromEmail, fromName: row.fromName, replyTo: row.replyTo, updatedAt: row.updatedAt };
}

/** Transport for workspace-scoped mail; null workspace (or no usable workspace SMTP) uses the instance transport. */
export async function getEmailTransportFor(workspaceId: string | null): Promise<Transporter | null> {
  if (workspaceId) {
    const config = await loadWorkspaceSmtp(workspaceId);
    if (config) {
      const stamp = config.updatedAt.getTime();
      const hit = cache().get(workspaceId);
      if (hit && hit.stamp === stamp && Date.now() - hit.at < PIN_TTL_MS) return hit.transporter;
      const pin = await pinSmtpHost(config.host, config.port).catch((error) => {
        invalidateWorkspaceTransport(workspaceId);
        throw error;
      });
      // Same settings and same address: keep the pooled connections, just refresh the check time.
      if (hit && hit.stamp === stamp && hit.address === pin.address) {
        hit.at = Date.now();
        return hit.transporter;
      }
      hit?.transporter.close();
      const transporter = createSmtpTransport(config, { pin });
      cache().set(workspaceId, { stamp, address: pin.address, at: Date.now(), transporter });
      return transporter;
    }
    cache().get(workspaceId)?.transporter.close();
    cache().delete(workspaceId);
  }
  return (await getEmailTransport()).transporter;
}

function formatFrom(name: string | null, email: string) {
  return name?.trim() ? `"${name.trim().replace(/["\\\r\n]/g, "")}" <${email}>` : email;
}

/** From (and optional Reply-To) matching the transport `getEmailTransportFor` picks for the same workspace. */
export async function getFromFor(workspaceId: string | null): Promise<{ from: string; replyTo?: string }> {
  if (workspaceId) {
    const config = await loadWorkspaceSmtp(workspaceId);
    if (config) return { from: formatFrom(config.fromName, config.fromEmail), ...(config.replyTo ? { replyTo: config.replyTo } : {}) };
  }
  return { from: (await getEmailSettings()).from };
}
