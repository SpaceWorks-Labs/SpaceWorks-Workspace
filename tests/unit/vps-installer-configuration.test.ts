import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { root, lib } from "./vps-installer-fixtures";

describe("VPS installer configuration", () => {
  it("accepts only well-formed answers", () => {
    const check = (fn: string, value: string) => lib(`${fn} '${value}'`).status === 0;
    expect(check("is_hostname", "workspace.example.com")).toBe(true);
    expect(check("is_hostname", "localhost")).toBe(false);
    expect(check("is_hostname", "bad host.example.com")).toBe(false);
    expect(check("is_email", "admin@example.com")).toBe(true);
    expect(check("is_email", "admin@example")).toBe(false);
    expect(lib(`is_env_value "Space Works <workspace@example.com>"`).status).toBe(0);
    expect(lib(`is_env_value "it's"`).status).not.toBe(0);
    expect(lib(`is_env_value 'trailing\\'`).status).not.toBe(0);
    expect(lib(`is_env_value '   '`).status).not.toBe(0);
    expect(check("is_port", "2525")).toBe(true);
    expect(check("is_port", "0")).toBe(false);
    expect(check("is_port", "65536")).toBe(false);
    expect(check("is_safe_path", "/etc/spaceworks-workspace")).toBe(true);
    expect(check("is_safe_path", "/etc/space works")).toBe(false);
    expect(check("is_safe_path", "relative")).toBe(false);
    expect(check("is_repository", "SpaceWorks-Labs/SpaceWorks-Workspace")).toBe(true);
    expect(check("is_repository", "owner/..")).toBe(false);
    expect(lib("release_version 0123456789abcdef0123456789abcdef01234567").stdout).toBe("vps-0123456789ab");
  });

  it("updates one setting in place and reads it back unquoted", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "sww-conf-test-"));
    const file = path.join(directory, "compose.env").replaceAll("\\", "/");
    try {
      const result = lib(
        `printf "%s\\n" "PUBLIC_HOST='workspace.example.com'" "SWW_VERSION='vps-old'" > '${file}'; ` +
        `conf_set '${file}' SWW_VERSION vps-new; conf_get '${file}' SWW_VERSION; printf ' '; conf_get '${file}' PUBLIC_HOST`,
      );
      expect(result.stdout, result.stderr).toBe("vps-new workspace.example.com");
      expect(readFileSync(file, "utf8").match(/^SWW_VERSION=/gm)).toHaveLength(1);
      if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("generates separate frontend credentials, refuses replacement and renews only certificates", { timeout: 30_000 }, () => {
    const directory = mkdtempSync(path.join(tmpdir(), "sww-config-test-"));
    const run = (...args: string[]) => spawnSync(process.execPath, ["docker/vps/setup.mjs", ...args], { cwd: root, env: { ...process.env, SWW_SETUP_CONFIG_DIR: directory }, encoding: "utf8" });
    try {
      const result = run("api.workspace.example.com", "admin@example.com", "test-release", "workspace.example.com");
      expect(result.status, result.stderr).toBe(0);
      const frontend = readFileSync(path.join(directory, "frontend.env"), "utf8");
      const app = readFileSync(path.join(directory, "app.env"), "utf8");
      expect(frontend).toContain("NEXT_PUBLIC_BASE_URL='https://workspace.example.com'");
      expect(frontend).toContain("BACKEND_ORIGIN='https://api.workspace.example.com'");
      expect(frontend).not.toMatch(/DATABASE_URL|AUTH_SECRET|SMTP_PASSWORD|REDIS_URL|MFA_ENCRYPTION_KEY|S3_SECRET/);
      const gateway = frontend.match(/^FRONTEND_GATEWAY_SECRET='([a-f0-9]{64})'/m)![1];
      expect(app.includes(`FRONTEND_GATEWAY_SECRET='${gateway}'`)).toBe(true);
      expect(app).toContain("DEPLOYMENT_MODE='backend'");
      expect(app).toContain("AUTH_URL='https://workspace.example.com'");
      for (const name of readdirSync(directory).filter((name) => name.endsWith(".env") || name === "actions-key")) expect(statSync(path.join(directory, name)).mode & 0o777).toBe(0o600);
      expect(run("api.workspace.example.com", "admin@example.com", "replace").status).not.toBe(0);
      const ca = readFileSync(path.join(directory, "tls/ca.key"));
      expect(run("renew-certificates").status).toBe(0);
      expect(readFileSync(path.join(directory, "tls/ca.key")).equals(ca)).toBe(true);
      expect(readFileSync(path.join(directory, "app.env"), "utf8") === app).toBe(true);
      expect(readFileSync(path.join(directory, "compose.env"), "utf8")).toContain("SWW_LAYOUT='netlify'");
      expect(frontend).toContain("FRONTEND_TRUSTED_IP_HEADER='x-nf-client-connection-ip'");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("records the split and single layouts for Compose and Caddy", { timeout: 30_000 }, () => {
    for (const [args, expected] of [
      [["api.workspace.example.com", "admin@example.com", "v1", "workspace.example.com", "split"],
        ["SWW_LAYOUT='split'", "SITE_HOST='workspace.example.com'", "SWW_CADDYFILE='Caddyfile.split'", "PUBLIC_ORIGIN='https://workspace.example.com'"]],
      [["workspace.example.com", "admin@example.com", "v1"], ["SWW_LAYOUT='single'", "PUBLIC_ORIGIN='https://workspace.example.com'"]],
    ] as const) {
      const directory = mkdtempSync(path.join(tmpdir(), "sww-layout-test-"));
      try {
        const result = spawnSync(process.execPath, ["docker/vps/setup.mjs", ...args], { cwd: root, env: { ...process.env, SWW_SETUP_CONFIG_DIR: directory }, encoding: "utf8" });
        expect(result.status, result.stderr).toBe(0);
        const compose = readFileSync(path.join(directory, "compose.env"), "utf8");
        for (const line of expected) expect(compose).toContain(line);
        if (args[4] === "split") expect(readFileSync(path.join(directory, "frontend.env"), "utf8")).toContain("FRONTEND_TRUSTED_IP_HEADER='x-real-ip'");
        else expect(compose).not.toContain("SWW_CADDYFILE");
      } finally { rmSync(directory, { recursive: true, force: true }); }
    }
  });

  it("stores an external bucket's settings and rejects unsafe ones", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "sww-storage-test-"));
    const good = { S3_ENDPOINT: "https://abc.r2.cloudflarestorage.com", S3_REGION: "auto", S3_BUCKET: "workspace-files", S3_ACCESS_KEY_ID: "key-id", S3_SECRET_ACCESS_KEY: "secret-value" };
    const run = (values: Record<string, string>) => spawnSync(process.execPath, ["docker/vps/configure-storage.mjs"], {
      cwd: root, encoding: "utf8", env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", SWW_SETUP_CONFIG_DIR: directory, ...values },
    });
    try {
      writeFileSync(path.join(directory, "app.env"), "AUTH_SECRET='x'\nS3_BUCKET='spaceworks-workspace'\nS3_ENDPOINT='https://storage:9000'\n");
      const result = run(good);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).not.toContain("secret-value");
      const app = readFileSync(path.join(directory, "app.env"), "utf8");
      expect(app).toContain("AUTH_SECRET='x'");
      expect(app).toContain("S3_ENDPOINT='https://abc.r2.cloudflarestorage.com'");
      expect(app).toContain("S3_SECRET_ACCESS_KEY='secret-value'");
      expect(app).toContain("S3_FORCE_PATH_STYLE='1'");
      expect(app.match(/^S3_BUCKET=/gm)).toHaveLength(1);
      for (const bad of [{ S3_ENDPOINT: "http://abc.example.com" }, { S3_ENDPOINT: "https://abc.example.com/path" }, { S3_BUCKET: "Bad_Bucket" }, { S3_SECRET_ACCESS_KEY: "it's" }]) {
        expect(run({ ...good, ...bad }).status, JSON.stringify(bad)).not.toBe(0);
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
