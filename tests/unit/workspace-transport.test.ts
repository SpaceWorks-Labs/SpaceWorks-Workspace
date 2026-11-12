import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique, instance, created } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  instance: { transporter: { id: "instance" }, from: "Instance <noreply@instance.test>" },
  created: [] as { options: Record<string, unknown>; close: () => void }[],
}));

vi.mock("@/lib/db", () => ({ prisma: { workspaceEmailSettings: { findUnique } } }));
vi.mock("@/lib/instanceSettings", () => ({ getEmailSettings: async () => ({ from: instance.from }) }));
vi.mock("@/lib/email/transporter", () => ({ getEmailTransport: async () => instance }));
const { resolve } = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("@/lib/monitor/ssrf", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/monitor/ssrf")>()), resolveTarget: resolve }));
vi.mock("nodemailer", () => ({
  default: {
    createTransport: (options: Record<string, unknown>) => {
      const transport = { options, close: vi.fn() };
      created.push(transport);
      return transport;
    },
  },
}));

import { encryptSecret } from "@/lib/crypto";
import { describeSmtpFailure, getEmailTransportFor, getFromFor, invalidateWorkspaceTransport, isSmtpPortAllowed } from "@/lib/email/workspaceTransport";

const row = (over: Record<string, unknown> = {}) => ({
  workspaceId: "w1", enabled: true, host: "smtp.ws.test", port: 587, secure: false, username: "u",
  passwordEnc: encryptSecret("workspace-smtp", "s3cret"), fromEmail: "hello@ws.test", fromName: 'Ws "Team"', replyTo: "help@ws.test",
  updatedAt: new Date("2026-01-01T00:00:00Z"), ...over,
});

describe("workspace email transport selection", () => {
  beforeEach(() => {
    findUnique.mockReset();
    resolve.mockReset();
    resolve.mockImplementation(async (host: string) => ({ ok: true, hostname: host, addresses: [{ address: "203.0.113.10", family: 4 }] }));
    created.length = 0;
    invalidateWorkspaceTransport("w1");
    created.length = 0;
  });

  it("uses the instance transport without a workspace id, without settings, or when disabled", async () => {
    expect(await getEmailTransportFor(null)).toBe(instance.transporter);
    findUnique.mockResolvedValue(null);
    expect(await getEmailTransportFor("w1")).toBe(instance.transporter);
    findUnique.mockResolvedValue(row({ enabled: false }));
    expect(await getEmailTransportFor("w1")).toBe(instance.transporter);
    expect(await getFromFor("w1")).toEqual({ from: instance.from });
  });

  it("uses a decrypted, pooled workspace transport when enabled and caches it per updatedAt", async () => {
    findUnique.mockResolvedValue(row());
    const first = await getEmailTransportFor("w1");
    expect(first).not.toBe(instance.transporter);
    expect(created).toHaveLength(1);
    expect(created[0]!.options).toMatchObject({ host: "203.0.113.10", name: "smtp.ws.test", tls: { servername: "smtp.ws.test" }, pool: true, auth: { user: "u", pass: "s3cret" } });
    expect(await getEmailTransportFor("w1")).toBe(first);
    expect(created).toHaveLength(1);
    findUnique.mockResolvedValue(row({ updatedAt: new Date("2026-02-01T00:00:00Z") }));
    expect(await getEmailTransportFor("w1")).not.toBe(first);
    expect(created).toHaveLength(2);
    expect(created[0]!.close).toHaveBeenCalled();
  });

  it("falls back to the instance when the secret cannot be decrypted, and invalidates on demand", async () => {
    findUnique.mockResolvedValue(row({ passwordEnc: "not-a-ciphertext" }));
    expect(await getEmailTransportFor("w1")).toBe(instance.transporter);
    findUnique.mockResolvedValue(row());
    const first = await getEmailTransportFor("w1");
    invalidateWorkspaceTransport("w1");
    expect(await getEmailTransportFor("w1")).not.toBe(first);
  });

  it("builds the workspace From and Reply-To", async () => {
    findUnique.mockResolvedValue(row());
    expect(await getFromFor("w1")).toEqual({ from: '"Ws Team" <hello@ws.test>', replyTo: "help@ws.test" });
  });

  it("connects to the validated address, reuses the pool while it holds and rebuilds when the address changes", async () => {
    vi.useFakeTimers();
    try {
      findUnique.mockResolvedValue(row());
      const first = await getEmailTransportFor("w1");
      vi.advanceTimersByTime(10_000);
      expect(await getEmailTransportFor("w1")).toBe(first);
      expect(resolve).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(61_000);
      expect(await getEmailTransportFor("w1")).toBe(first);
      expect(resolve).toHaveBeenCalledTimes(2);
      resolve.mockResolvedValue({ ok: true, hostname: "smtp.ws.test", addresses: [{ address: "203.0.113.99", family: 4 }] });
      vi.advanceTimersByTime(61_000);
      const rebuilt = await getEmailTransportFor("w1");
      expect(rebuilt).not.toBe(first);
      expect(created.at(-1)!.options).toMatchObject({ host: "203.0.113.99", tls: { servername: "smtp.ws.test" } });
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses to send when the host now resolves to a blocked address or the port is not an SMTP port", async () => {
    findUnique.mockResolvedValue(row());
    expect(await getEmailTransportFor("w1")).not.toBe(instance.transporter);
    resolve.mockResolvedValue({ ok: false, error: "SSRF_BLOCKED", message: "smtp.ws.test resolves to a blocked address." });
    invalidateWorkspaceTransport("w1");
    await expect(getEmailTransportFor("w1")).rejects.toThrow(/blocked/);
    resolve.mockResolvedValue({ ok: true, hostname: "smtp.ws.test", addresses: [{ address: "203.0.113.10", family: 4 }] });
    findUnique.mockResolvedValue(row({ port: 6379 }));
    await expect(getEmailTransportFor("w1")).rejects.toThrow(/port/i);
  });

  it("allows only the SMTP ports unless private targets are enabled", () => {
    expect([25, 465, 587, 2525, 22, 6379, 5432].map(isSmtpPortAllowed)).toEqual([true, true, true, true, false, false, false]);
    vi.stubEnv("MONITOR_ALLOW_PRIVATE_TARGETS", "true");
    expect(isSmtpPortAllowed(6379)).toBe(true);
    vi.unstubAllEnvs();
  });

  it("describes failures by category without server text", () => {
    expect(describeSmtpFailure({ code: "EAUTH", message: "535 secret@host" })).toMatch(/Sign-in/);
    expect(describeSmtpFailure({ code: "ECONNREFUSED" })).toMatch(/refused/);
    expect(describeSmtpFailure({ code: "ETIMEDOUT" })).toMatch(/in time/);
    expect(describeSmtpFailure({ code: "ESOCKET", message: "self-signed certificate" })).toMatch(/secure connection/);
    expect(describeSmtpFailure({ message: "550 internal 10.0.0.5 said no" })).not.toMatch(/10\.0\.0\.5/);
  });
});
