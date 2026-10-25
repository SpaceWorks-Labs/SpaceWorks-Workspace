import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { root, scripts, lib } from "./vps-installer-fixtures";

describe("VPS installer", () => {
  it("validates bootstrap arguments before checking or changing the host", () => {
    const help = execFileSync("bash", ["install.sh", "--help"], { cwd: root, encoding: "utf8" });
    expect(help).toContain("--update");
    expect(help).toContain("Silo object storage");
    for (const [args, message] of [
      [["--ref", "../../bad"], "Invalid source reference"],
      [["--release", "main"], "Invalid release tag"],
      [["--release", "v0.1.0-main.1.0123456789ab", "--ref", "main"], "Choose either --release or --ref"],
      [["--dir", "relative/path"], "absolute installation directory"],
      [["--dir", "/"], "absolute installation directory"],
      [["--unknown"], "Usage: install.sh"],
    ] as const) {
      const result = spawnSync("bash", ["install.sh", ...args], { cwd: root, encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(message);
    }
    execFileSync("bash", ["-n", ...scripts], { cwd: root });
  });

  it("installs the latest release by default, pinned to its commit and images", () => {
    const installer = readFileSync(path.join(root, "install.sh"), "utf8");
    expect(installer).toContain("/releases/latest");
    expect(installer).toContain("application/vnd.github.sha");
    expect(installer).toContain("codeload.github.com/$repository/tar.gz/$revision");
    expect(installer).toContain('"$STAGE/source/.release-version"');
  });

  it("pulls published release images and builds everything else", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "sww-release-test-"));
    const dir = directory.replaceAll("\\", "/");
    const commit = "0123456789abcdef0123456789abcdef01234567";
    try {
      expect(lib(`is_published_version 0.1.0-main.42.0123456789ab`).status).toBe(0);
      expect(lib(`is_published_version 0.1.0-feat-x.3.0123456789ab`).status).toBe(0);
      expect(lib(`is_published_version vps-0123456789ab`).status).not.toBe(0);
      expect(lib(`source_version '${dir}' ${commit}`).stdout).toBe("vps-0123456789ab");
      writeFileSync(path.join(directory, ".release-version"), "0.1.0-main.42.0123456789ab\n");
      expect(lib(`source_version '${dir}' ${commit}`).stdout).toBe("0.1.0-main.42.0123456789ab");
      expect(lib(`source_version '${dir}' ffffffffffff${commit.slice(12)}`).status).not.toBe(0);
      const settings = (version: string) => lib(
        `set_image_settings '${dir}/compose.env' ${version} SpaceWorks-Labs/SpaceWorks-Workspace; cat '${dir}/compose.env'`,
      ).stdout;
      // A 0.9.0 installation's separate migrator/ops image settings are dropped.
      writeFileSync(path.join(directory, "compose.env"), "SWW_VERSION='0.9.0-main.1.0123456789ab'\nSWW_APP_IMAGE='x'\nSWW_MIGRATOR_IMAGE='y'\nSWW_OPS_IMAGE='z'\n");
      expect(settings("0.1.0-main.42.0123456789ab")).toBe([
        "SWW_VERSION='0.9.0-main.1.0123456789ab'",
        "SWW_BACKEND_IMAGE='ghcr.io/spaceworks-labs/spaceworks-workspace-backend'",
        "SWW_FRONTEND_IMAGE='ghcr.io/spaceworks-labs/spaceworks-workspace-frontend'", "",
      ].join("\n"));
      expect(settings("vps-0123456789ab")).toBe("SWW_VERSION='0.9.0-main.1.0123456789ab'\nSWW_BACKEND_IMAGE=''\nSWW_FRONTEND_IMAGE=''\n");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("publishes generic multi-platform images and releases only when VERSION changes", () => {
    const workflow = readFileSync(path.join(root, ".github/workflows/release.yml"), "utf8");
    expect(readFileSync(path.join(root, "VERSION"), "utf8").trim()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(workflow).toContain("NEXT_PUBLIC_BASE_URL=https://spaceworks-workspace-origin.invalid");
    expect(workflow).toContain("ubuntu-24.04-arm");
    expect(workflow).toContain("matching-refs/tags/v$base-main.");
    expect(workflow).not.toContain("TEMPORARY");
    for (const image of ["spaceworks-workspace-backend", "spaceworks-workspace-frontend"]) expect(workflow).toContain(image);
    expect(workflow).not.toMatch(/spaceworks-workspace-(migrator|ops)\b/);
    expect(workflow).toContain("NEXT_PUBLIC_BACKEND_ORIGIN=https://spaceworks-workspace-backend.invalid");
    expect(workflow).not.toMatch(/secrets\.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY|vars\.NEXT_PUBLIC_BASE_URL/);
    const entrypoint = readFileSync(path.join(root, "scripts/docker-entrypoint.sh"), "utf8");
    expect(entrypoint).toContain("spaceworks-workspace-origin.invalid");
    expect(entrypoint).toContain("spaceworks-workspace-backend.invalid");
  });
  it("picks the official runner build only with one published checksum", () => {
    const python = spawnSync("python3", ["--version"]).status === 0 ? "python3" : "python";
    if (spawnSync(python, ["--version"]).status !== 0) return;
    const sha = "a".repeat(64);
    const release = (body: string, digest = "") => JSON.stringify({
      tag_name: "v2.330.0", draft: false, prerelease: false, published_at: "2026-10-01T00:00:00Z", body,
      assets: [{ name: "actions-runner-linux-x64-2.330.0.tar.gz", digest, browser_download_url: "https://github.com/actions/runner/releases/download/v2.330.0/actions-runner-linux-x64-2.330.0.tar.gz" }],
    });
    const pick = (input: string) => spawnSync(python, ["scripts/runner-release.py", "x64"], { cwd: root, input, encoding: "utf8" });
    const ok = pick(release(`actions-runner-linux-x64-2.330.0.tar.gz <!-- BEGIN SHA linux-x64 -->${sha}<!-- END SHA linux-x64 -->`));
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout.trim().split(/\r?\n/)).toEqual([
      "https://github.com/actions/runner/releases/download/v2.330.0/actions-runner-linux-x64-2.330.0.tar.gz", sha,
    ]);
    expect(pick(release("no checksum here")).status).not.toBe(0);
    expect(pick(release(`actions-runner-linux-x64-2.330.0.tar.gz ${sha}`, `sha256:${"b".repeat(64)}`)).status).not.toBe(0);
  });
});
