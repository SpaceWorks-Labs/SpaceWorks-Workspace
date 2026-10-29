import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

it("precreates excluded encryption output before GNU tar observes directory metadata", () => {
  const source = readFileSync("scripts/vps-backup.sh", "utf8");
  // Exercise the actual preparation, with a deterministic checkpoint forcing
  // output creation after tar has already observed the source directory.
  const preparation = source.match(/^\s*: > "\$target\.partial\/backup\.tar\.age"$/m)?.[0] ?? "";
  const fixture = mkdtempSync(path.join(tmpdir(), "workspace tar race "));
  const windowsBash = "C:/Program Files/Git/bin/bash.exe";
  const bash = process.platform === "win32" && existsSync(windowsBash) ? windowsBash : "bash";
  try {
    const result = spawnSync(bash, ["-c", `
set -euo pipefail
mkdir old.partial fixed.partial
head -c 200000 /dev/zero > old.partial/database.dump
cp old.partial/database.dump fixed.partial/database.dump
checkpoint='if [ ! -e "$SWW_TAR_FIXTURE/backup.tar.age" ]; then sleep 1.1; fi; touch "$SWW_TAR_FIXTURE/backup.tar.age"'
export SWW_TAR_FIXTURE="$PWD/old.partial"
set +e
tar --checkpoint=1 --checkpoint-action="exec=$checkpoint" -cf old.tar -C "$SWW_TAR_FIXTURE" --exclude=./backup.tar.age . 2>old.stderr
old_status=$?
set -e
printf 'old_status=%s\\n' "$old_status"
cat old.stderr
target="$PWD/fixed"
${preparation}
export SWW_TAR_FIXTURE="$target.partial"
tar --checkpoint=1 --checkpoint-action="exec=$checkpoint" -cf fixed.tar -C "$SWW_TAR_FIXTURE" --exclude=./backup.tar.age .
tar -tf fixed.tar
`], { cwd: fixture, encoding: "utf8", timeout: 20_000, env: { ...process.env, NODE_ENV: "test" } });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("old_status=1");
    expect(result.stdout).toContain("file changed as we read it");
    expect(result.stdout).toContain("./database.dump");
    expect(result.stdout).not.toContain("./backup.tar.age");
  } finally { rmSync(fixture, { recursive: true, force: true }); }
}, 25_000);
