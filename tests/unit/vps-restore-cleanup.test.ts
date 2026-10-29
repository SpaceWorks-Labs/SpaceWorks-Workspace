import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.resolve(import.meta.dirname, "../../scripts/vps-restore.sh"), "utf8").replace(/\r\n/g, "\n");
const cleanup = source.slice(source.indexOf("cleanup() {"), source.indexOf("\ntrap cleanup EXIT"));
const windowsBash = "C:/Program Files/Git/bin/bash.exe";
const bash = process.platform === "win32" && existsSync(windowsBash) ? windowsBash : "bash";

function execute(stopped: number, committed: number, status = 7) {
  return spawnSync(bash, ["-c", `set -euo pipefail
work='' key_file=''
stopped=${stopped}
database_committed=${committed}
serving=(app worker beat proxy frontend)
warn() { printf '%s\\n' "$*" >&2; }
compose() { printf 'compose %s\\n' "$*" >&3; }
${cleanup}
trap cleanup EXIT
exit ${status}`, "restore-cleanup-fixture"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe", "pipe"] });
}

describe("VPS restore failure phases", () => {
  it("does not change services when validation or SQL materialization fails before stopping", () => {
    const result = execute(0, 0);
    expect(result.status).toBe(7);
    expect(result.output[3]).toBe("");
  });

  it("restarts the previous deployment only after a failed uncommitted database transaction", () => {
    const result = execute(1, 0);
    expect(result.status).toBe(7);
    expect(result.output[3]).toBe("compose up -d\n");
    expect(result.stderr).toContain("did not commit");
  });

  it.each(["object restore", "migration", "readiness"])("leaves serving processes stopped after committed SQL and %s failure", () => {
    const result = execute(1, 1);
    expect(result.status).toBe(7);
    expect(result.output[3]).toBe("compose stop app worker beat proxy frontend\n");
    expect(result.output[3]).not.toContain("up");
    expect(result.stderr).toContain("rerun the complete restore");
  });

  it("leaves a successful recovered deployment running", () => {
    const result = execute(0, 1, 0);
    expect(result.status).toBe(0);
    expect(result.output[3]).toBe("");
    expect(result.stderr).toBe("");
  });
});
