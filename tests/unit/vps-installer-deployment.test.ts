import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { root } from "./vps-installer-fixtures";

describe("VPS installer deployment", () => {
  it("tears down all profiles after a layout change while normal startup follows the saved layout", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "sww-compose-profiles-"));
    const windowsBash = "C:/Program Files/Git/bin/bash.exe";
    const bash = process.platform === "win32" && existsSync(windowsBash) ? windowsBash : "bash";
    const wrapper = readFileSync(path.join(root, "scripts/vps-compose.sh"), "utf8").replace(/\r\n/g, "\n");
    // Exercise all real profile selection before replacing only process launch.
    const script = wrapper.replace(/exec docker compose[^\n]*/, 'printf "%s\\n" "$COMPOSE_PROFILES"');
    try {
      writeFileSync(path.join(directory, "compose.env"), "SWW_LAYOUT='single'\nSWW_CADDY_TLS='internal'\nSWW_STORAGE='bundled'\n");
      for (const [command, profiles] of [["up", "caddy,silo"], ["down", "*"]]) {
        const result = spawnSync(bash, ["-c", script, "sww-compose-fixture", command], {
          cwd: root, env: { ...process.env, SWW_CONFIG_DIR: directory.replaceAll("\\", "/"), SWW_BUILD_KEY: "disposable-fixture" }, encoding: "utf8",
        });
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout.trim()).toBe(profiles);
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("runs the split layout as website and API containers behind one Caddy", () => {
    const compose = readFileSync(path.join(root, "compose.production.yml"), "utf8");
    expect(compose).toMatch(/migrator:\n(?:.*\n)*?\s+command: \["migrate"\]/);
    expect(compose).toMatch(/frontend:\n(?:.*\n)*?\s+profiles: \[split\]/);
    expect(compose).toContain('aliases: ["${PUBLIC_HOST}"]');
    const split = readFileSync(path.join(root, "docker/vps/Caddyfile.split"), "utf8");
    expect(split).toContain("reverse_proxy frontend:3000");
    expect(split).toContain("reverse_proxy app:3000");
    const wrapper = readFileSync(path.join(root, "scripts/vps-compose.sh"), "utf8");
    expect(wrapper).toContain("[ \"$(setting SWW_LAYOUT)\" != split ] || profiles='split'");
    expect(wrapper).toContain("export COMPOSE_PROFILES=\"$profiles\"");
  });
  it("uses Caddy HTTPS and Silo storage unless replaced", () => {
    const wrapper = readFileSync(path.join(root, "scripts/vps-compose.sh"), "utf8");
    expect(wrapper).toContain('[ "$tls" = proxy ] || profiles=${profiles:+$profiles,}caddy');
    expect(wrapper).toContain('[ "$storage" = external ] || profiles=${profiles:+$profiles,}silo');
    const compose = readFileSync(path.join(root, "compose.production.yml"), "utf8");
    expect(compose).toMatch(/proxy:\n\s+profiles: \[caddy\]/);
    expect(compose).toMatch(/storage:\n\s+profiles: \[silo\]/);
    expect(readFileSync(path.join(root, "compose.external-proxy.yml"), "utf8")).toContain('"127.0.0.1:8080:3000"');
    expect(readFileSync(path.join(root, "compose.external-storage.yml"), "utf8")).toContain("depends_on: !override");
    const workflow = readFileSync(path.join(root, ".github/workflows/release.yml"), "utf8");
    expect(workflow).toContain("runs-on: [self-hosted, spaceworks-workspace-prod]");
    expect(workflow).toContain("vars.SWW_DEPLOY == 'true'");
    expect(workflow.slice(workflow.indexOf("\n  deploy:"), workflow.indexOf("\n  retention:"))).not.toContain("actions/checkout");
    // The runner may run only the deploy wrapper as root; a tag named main is not main.
    expect(workflow).toContain('sudo -n /usr/local/sbin/sww-deploy "v$VERSION"');
    expect(workflow).toContain('"$REF" != refs/heads/main');
    const runner = readFileSync(path.join(root, "scripts/install-runner.sh"), "utf8");
    expect(runner).not.toContain("RUNNER_ALLOW_RUNASROOT");
    expect(runner).toContain('runuser -m -u "$RUNNER_USER"');
    const deploy = readFileSync(path.join(root, "scripts/vps-deploy.sh"), "utf8");
    expect(deploy).toContain('"prerelease"[[:space:]]*:[[:space:]]*false');
    expect(deploy).toContain("compare/main...$revision");
  });
  it("runs worker and beat from the backend image with private health checks", () => {
    const compose = readFileSync(path.join(root, "compose.production.yml"), "utf8");
    expect(compose).not.toContain("node:22-alpine");
    expect(compose).not.toContain("  scheduler:");
    for (const role of ["worker", "beat"]) {
      expect(compose).toContain(`  ${role}:`);
      expect(compose).toContain(`command: ["node", "dist/${role}.js"]`);
    }
    expect(compose).toContain("http://127.0.0.1:3460/health");
    expect(compose).toContain("stop_grace_period: 10m");
    expect(compose).toContain("${SWW_CONFIG_DIR}/status:/status:ro");
    expect(compose).not.toMatch(/\$\{SWW_CONFIG_DIR\}\/backups:\/[a-z]+:ro/);
  });
});
