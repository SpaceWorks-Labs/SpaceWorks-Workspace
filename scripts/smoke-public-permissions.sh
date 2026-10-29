#!/usr/bin/env bash
# Sourced by the isolated installer smoke; existing public assets are unchanged.
# shellcheck disable=SC2154 # The caller supplies its canonical source root.
prepare_public_permission_probe() {
  SWW_PERMISSION_PROBE=''
  [[ ${CI:-} = true ]] || return 0
  SWW_PERMISSION_PROBE=$(mktemp -d "$root/public/sww-permission-smoke.XXXXXX")
  printf 'private-mode public asset\n' > "$SWW_PERMISSION_PROBE/readable.txt"
  chmod 700 "$SWW_PERMISSION_PROBE"
  chmod 600 "$SWW_PERMISSION_PROBE/readable.txt"
}

check_public_permission_probe() {
  [[ -n ${SWW_PERMISSION_PROBE:-} ]] || return 0
  docker run --rm --network none --entrypoint node sww-backend:smoke -e '
    const fs = require("node:fs"), assert = require("node:assert/strict");
    const directory = "/app/public/" + process.argv[1], file = directory + "/readable.txt";
    assert.notEqual(process.getuid(), 0, "use the actual non-root image user");
    for (const path of [directory, file]) assert.equal(fs.statSync(path).uid, process.getuid());
    assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(fs.readdirSync(directory), ["readable.txt"]);
    assert.equal(fs.readFileSync(file, "utf8"), "private-mode public asset\n");
    console.log("Non-root backend reads public directory700 and asset600.");
  ' "$(basename "$SWW_PERMISSION_PROBE")"
}

remove_public_permission_probe() {
  [[ -n ${SWW_PERMISSION_PROBE:-} ]] || return 0
  case "$SWW_PERMISSION_PROBE" in "$root/public/sww-permission-smoke."*) ;; *) return 1 ;; esac
  rm -f -- "$SWW_PERMISSION_PROBE/readable.txt"
  rmdir -- "$SWW_PERMISSION_PROBE"
}

check_runtime_source_permissions() {
  [[ ${CI:-} = true ]] || return 0
  docker run --rm --network none --entrypoint node sww-backend:smoke -e '
    const fs = require("node:fs"), assert = require("node:assert/strict");
    assert.notEqual(process.getuid(), 0, "use the actual non-root image user");
    for (const directory of ["/app/scripts", "/app/docker/vps"]) {
      for (const name of fs.readdirSync(directory).filter(name => name.endsWith(".mjs"))) {
        const file = directory + "/" + name;
        assert.equal(fs.statSync(file).uid, process.getuid(), file);
        fs.readFileSync(file);
      }
    }
    console.log("Non-root backend reads every direct-source operator and crypto helper.");
  '
}
