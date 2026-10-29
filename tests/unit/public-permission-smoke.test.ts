import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const windowsBash = "C:/Program Files/Git/bin/bash.exe";
const bash = process.platform === "win32" && existsSync(windowsBash) ? windowsBash : "bash";
const helper = path.resolve("scripts/smoke-public-permissions.sh").replaceAll("\\", "/");

function fixture(ci: string, body: string) {
  const root = mkdtempSync(path.join(tmpdir(), "sww-public-permissions-"));
  try {
    mkdirSync(path.join(root, "public"));
    writeFileSync(path.join(root, "public/existing.txt"), "existing asset");
    const result = spawnSync(bash, ["-euo", "pipefail", "-c", `source "$HELPER"\n${body}`], {
      encoding: "utf8", env: { ...process.env, root: root.replaceAll("\\", "/"), HELPER: helper, CI: ci },
    });
    return { result, entries: readdirSync(path.join(root, "public")), existing: readFileSync(path.join(root, "public/existing.txt"), "utf8") };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

describe("restrictive public permission image fixture", () => {
  it("leaves existing checkout assets untouched outside CI", () => {
    const { result, entries, existing } = fixture("false", 'prepare_public_permission_probe; test -z "$SWW_PERMISSION_PROBE"; remove_public_permission_probe');
    expect(result.status, result.stderr).toBe(0);
    expect(entries).toEqual(["existing.txt"]);
    expect(existing).toBe("existing asset");
  });

  it.skipIf(process.platform === "win32")("creates actual700/600 inputs and removes only its own fixture", () => {
    const { result, entries, existing } = fixture("true", `prepare_public_permission_probe
      test "$(stat -c %a "$SWW_PERMISSION_PROBE")" = 700
      test "$(stat -c %a "$SWW_PERMISSION_PROBE/readable.txt")" = 600
      test "$(cat "$SWW_PERMISSION_PROBE/readable.txt")" = 'private-mode public asset'
      remove_public_permission_probe`);
    expect(result.status, result.stderr).toBe(0);
    expect(entries).toEqual(["existing.txt"]);
    expect(existing).toBe("existing asset");
  });

  it("refuses to remove an unrelated public path", () => {
    const { result, entries, existing } = fixture("true", 'SWW_PERMISSION_PROBE="$root/public"; remove_public_permission_probe');
    expect(result.status).toBe(1);
    expect(entries).toEqual(["existing.txt"]);
    expect(existing).toBe("existing asset");
  });
});
