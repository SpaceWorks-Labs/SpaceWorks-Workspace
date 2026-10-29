import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.resolve(import.meta.dirname, "../../scripts/vps-backup.sh"), "utf8").replace(/\r\n/g, "\n");
const writers = source.slice(source.indexOf("pause_writers() {"), source.indexOf("\n# status.json"));
const cleanup = source.slice(source.indexOf("on_exit() {"), source.indexOf("\ntrap on_exit EXIT"));
const windowsBash = "C:/Program Files/Git/bin/bash.exe";
const bash = process.platform === "win32" && existsSync(windowsBash) ? windowsBash : "bash";

function execute({ objects = 1, failure = "", running = "app\nfrontend\nworker\nbeat\npostgres" } = {}) {
  return spawnSync(bash, ["-c", `set -euo pipefail
objects=${objects}
failure=${JSON.stringify(failure)}
fixture_running=${JSON.stringify(running).replace(/\\n/g, "\n")}
paused_writers=()
target=synthetic-backup
rm() { :; }
say() { :; }
warn() { printf '%s\\n' "$*" >&2; }
write_status() { printf 'status %s\\n' "$*"; }
compose() {
  if [[ $1 = ps ]]; then
    [[ $failure != ps ]] || return 8
    printf '%s\\n' "$fixture_running"
    return
  fi
  printf 'compose %s\\n' "$*"
  [[ $1 != "$failure" ]] || return 7
}
${writers}
${cleanup}
trap on_exit EXIT
pause_writers
printf 'snapshot database and objects\\n'
[[ $failure != snapshot ]] || exit 9
resume_writers
printf 'encrypt and transfer\\n'
rm -d -- "$target"
`, "backup-quiescence-fixture"], { encoding: "utf8" });
}

describe("full backup writer quiescence", () => {
  it("stops only running writers before the snapshot and resumes before transfer", () => {
    const result = execute();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("compose stop app worker beat\nsnapshot database and objects\ncompose up -d --no-deps --wait --wait-timeout 300 app worker beat\nencrypt and transfer\n");
  });

  it("leaves PostgreSQL snapshot-only backups online", () => {
    const result = execute({ objects: 0 });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("snapshot database and objects\nencrypt and transfer\n");
  });

  it("does not start writers that were deliberately stopped before backup", () => {
    const result = execute({ running: "postgres\nredis\nfrontend" });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("compose");
  });

  it("restarts the captured writers when snapshot creation fails", () => {
    const result = execute({ failure: "snapshot" });
    expect(result.status).toBe(9);
    expect(result.stdout).toContain("status failed\ncompose up -d --no-deps --wait --wait-timeout 300 app worker beat\n");
    expect(result.stdout).not.toContain("encrypt");
  });

  it("recovers a partially failed stop without taking a snapshot", () => {
    const result = execute({ failure: "stop" });
    expect(result.status).toBe(7);
    expect(result.stdout).toContain("compose up -d --no-deps --wait --wait-timeout 300 app worker beat");
    expect(result.stdout).not.toContain("snapshot");
  });

  it("fails before mutation when running-service discovery fails", () => {
    const result = execute({ failure: "ps" });
    expect(result.status).toBe(8);
    expect(result.stdout).toBe("status failed\n");
  });

  it("reports restart failure rather than reporting a healthy backup", () => {
    const result = execute({ failure: "up" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("could not all restart");
    expect(result.stdout).not.toContain("encrypt");
  });
});
