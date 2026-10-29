import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.resolve("scripts/test-vps-install.sh"), "utf8").replace(/\r\n/g, "\n");
const helper = source.slice(source.indexOf("as_root() {"), source.indexOf("\nmkdir -m 700"));
const windowsBash = "C:/Program Files/Git/bin/bash.exe";
const bash = process.platform === "win32" && existsSync(windowsBash) ? windowsBash : "bash";

describe("installer smoke privilege boundary", () => {
  it("forwards only nonsecret fixture coordinates when sudo discards its environment", () => {
    const result = spawnSync(bash, ["-euo", "pipefail", "-c", `
id() { printf '1000\\n'; }
sudo() { env -i PATH="$PATH" "$@"; }
${helper}
as_root "$PROBE_NODE" -e '
  const assert = require("node:assert/strict");
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.SWW_CONFIG_DIR, process.argv[1]);
  assert.ok(process.argv[1].endsWith("synthetic fixture"));
  assert.equal(process.env.SWW_PROJECT_NAME, "sww-smoke-sudo-fixture");
  assert.equal(process.env.UNRELATED_CREDENTIAL, undefined);
  console.log("explicit fixture environment survived");
' "$SWW_CONFIG_DIR"`], { encoding: "utf8", env: { ...process.env, PROBE_NODE: process.execPath.replaceAll("\\", "/"),
      SWW_CONFIG_DIR: "/tmp/synthetic fixture", SWW_PROJECT_NAME: "sww-smoke-sudo-fixture", UNRELATED_CREDENTIAL: "synthetic-do-not-forward" } });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("explicit fixture environment survived");
  });

  it("uses the original command directly when already root", () => {
    const result = spawnSync(bash, ["-euo", "pipefail", "-c", `
id() { printf '0\\n'; }
sudo() { exit 88; }
${helper}
as_root printf 'root command ran\\n'`], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("root command ran\n");
  });
});
