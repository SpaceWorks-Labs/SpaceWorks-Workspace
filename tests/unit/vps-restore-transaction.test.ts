import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const source = readFileSync(path.join(root, "scripts/vps-restore.sh"), "utf8");
const block = source.slice(source.indexOf("# Materialize the complete restore"), source.indexOf("\nif [[ $has_objects = 1 ]]; then\n  compose run"));
const windowsBash = "C:/Program Files/Git/bin/bash.exe";
const bash = process.platform === "win32" && existsSync(windowsBash) ? windowsBash : "bash";

function execute(failGeneration = false) {
  const directory = mkdtempSync(path.join(tmpdir(), "sww-restore-transaction-"));
  try {
    writeFileSync(path.join(directory, "database.dump"), "synthetic custom archive");
    const result = spawnSync(bash, ["-c", `set -euo pipefail
work="$RESTORE_FIXTURE_DIR"
backup="$RESTORE_FIXTURE_DIR"
stopped=0
serving=(app worker beat)
pg_restore() {
  if [[ "$1" == --list ]]; then
    printf '3; 2615 2200 SCHEMA - public sww\\n4; 0 0 COMMENT - SCHEMA public sww\\n5; 0 0 ACL - SCHEMA public sww\\n6; 1259 1 TABLE public recovered sww\\n'
    return
  fi
  printf 'generate\\n' >> "$RESTORE_FIXTURE_DIR/trace"
  local list
  for argument in "$@"; do
    case "$argument" in --use-list=*) list="$argument" ;; esac
  done
  list="$(printf '%s' "$list" | cut -d= -f2-)"
  if grep -q '^3;' "$list"; then printf 'CREATE SCHEMA public;\\n'; fi
  if grep -q '^4;' "$list"; then printf "COMMENT ON SCHEMA public IS 'Recovered schema comment';\\n"; fi
  if grep -q '^5;' "$list"; then printf 'GRANT USAGE ON SCHEMA public TO synthetic_reader;\\n'; fi
  printf 'CREATE TABLE public.recovered (id integer);\\n'
  [[ "$FAIL_GENERATION" != 1 ]] || return 7
}
export -f pg_restore
compose() {
  if [[ "$1:$2:$3" == exec:postgres:sh ]]; then
    shift 3
    bash "$@"
  elif [[ "$1:$2:$3" == exec:postgres:psql ]]; then
    printf 'execute %s\\n' "$*" >> "$RESTORE_FIXTURE_DIR/trace"
    cat > "$RESTORE_FIXTURE_DIR/applied.sql"
  elif [[ "$1" == stop ]]; then
    printf 'stop\\n' >> "$RESTORE_FIXTURE_DIR/trace"
  else
    return 99
  fi
}
${block}`], { cwd: root, env: { ...process.env, RESTORE_FIXTURE_DIR: directory.replaceAll("\\", "/"), FAIL_GENERATION: failGeneration ? "1" : "0" }, encoding: "utf8" });
    return { ...result, trace: readFileSync(path.join(directory, "trace"), "utf8"), applied: existsSync(path.join(directory, "applied.sql")) ? readFileSync(path.join(directory, "applied.sql"), "utf8") : null };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

describe("VPS custom archive restore transaction", () => {
  it("prepares a complete schema replacement before stopping or applying it", () => {
    const result = execute();
    expect(result.status, result.stderr).toBe(0);
    const [generation, stopped, applied] = result.trace.trim().split("\n");
    expect(generation).toBe("generate");
    expect(stopped).toBe("stop");
    expect(applied).toContain("psql -X -U sww -d sww --single-transaction --set ON_ERROR_STOP=1 --file=-");
    expect(result.applied).toContain("DROP SCHEMA IF EXISTS public CASCADE;\nCREATE SCHEMA public AUTHORIZATION sww;");
    expect(result.applied).not.toContain("CREATE SCHEMA public;");
    expect(result.applied).toContain("CREATE TABLE public.recovered");
    expect(result.applied).toContain("COMMENT ON SCHEMA public IS 'Recovered schema comment';");
    expect(result.applied).toContain("GRANT USAGE ON SCHEMA public TO synthetic_reader;");
    expect(result.applied).toContain("REVOKE ALL ON SCHEMA public FROM PUBLIC, sww_app;");
    expect(result.applied).toContain("GRANT USAGE ON SCHEMA public TO sww_app;");
    expect(result.applied).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sww_app;");
    expect(result.applied).toContain("GRANT USAGE, SELECT ON SEQUENCES TO sww_app;");
    expect(result.applied).not.toContain("GRANT ALL");
  });

  it("does not stop services or execute a valid partial SQL prefix when archive generation fails", () => {
    const result = execute(true);
    expect(result.status).toBe(7);
    expect(result.trace).toBe("generate\n");
    expect(result.applied).toBeNull();
  });
});
