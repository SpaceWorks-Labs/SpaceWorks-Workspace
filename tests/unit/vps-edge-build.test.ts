import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const windowsBash = "C:/Program Files/Git/bin/bash.exe";
const bash = process.platform === "win32" && existsSync(windowsBash) ? windowsBash : "bash";

function fetchImages(tls: string, published: boolean, failure: "edge" | "login" | "pull" | "build" | null = null) {
  const root = mkdtempSync(join(tmpdir(), "sww-edge-build-"));
  try {
    writeFileSync(join(root, "compose.env"), `SWW_CADDY_TLS='${tls}'\n`);
    return spawnSync(bash, ["-s"], {
      encoding: "utf8", timeout: 15_000,
      env: { NODE_ENV: "test", PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, SWW_CONFIG_DIR: root.replaceAll("\\", "/") },
      input: `set -euo pipefail
source scripts/vps-lib.sh
is_published_version() { return ${published ? 0 : 1}; }
ghcr_login() { return ${failure === "login" ? 23 : 0}; }
say() { :; }
compose() {
  printf '%s\\n' "$*"
  if [[ "$1" = "${failure}" ]]; then return 23; fi
  if [[ "$*" = 'build proxy' ]]; then return ${failure === "edge" ? 23 : 0}; fi
}
if fetch_images 0.6.7 split; then printf 'ready\\n'; else exit $?; fi
`,
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
}

describe("installer security-patched web edge", () => {
  it.each(["internal", "public", ""])("builds the edge after published app pulls for %j TLS", tls => {
    const result = fetchImages(tls, true);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim().split("\n")).toEqual(["pull --quiet app frontend", "build proxy", "ready"]);
  });

  it("builds app images and the edge from a source release", () => {
    const result = fetchImages("internal", false);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim().split("\n")).toEqual(["build app frontend", "build proxy", "ready"]);
  });

  it("skips the bundled edge behind the operator's existing reverse proxy", () => {
    const result = fetchImages("proxy", true);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim().split("\n")).toEqual(["pull --quiet app frontend", "ready"]);
  });

  it.each(["login", "pull", "build"] as const)("preserves an earlier %s failure in conditional callers", failure => {
    const result = fetchImages("internal", failure !== "build", failure);
    expect(result.status, result.stderr).toBe(23);
    expect(result.stdout).not.toContain("build proxy");
    expect(result.stdout).not.toContain("ready");
  });

  it("does not start the stack after an edge build failure", () => {
    const result = fetchImages("internal", true, "edge");
    expect(result.status, result.stderr).toBe(23);
    expect(result.stdout).not.toContain("ready");
  });
});
