import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import path from "node:path";

// This CLI restores the application's public schema. Refuse other user schemas
// rather than silently preserving residue or dropping unrelated applications.
const otherSchemas = "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname <> 'public' AND nspname <> 'information_schema' AND nspname !~ '^pg_')";

export async function restorePublicArchive({ archive, directory, environment, run, commandOutput, fail }) {
  const contents = await commandOutput("pg_restore", ["--list", archive], environment);
  const list = contents.split(/\r?\n/).map((line) => {
    if (line.startsWith(";")) return line;
    const fields = line.trim().split(/\s+/);
    if (fields[3] !== "SCHEMA" || fields[4] !== "-") return line;
    if (fields[5] !== "public") fail("Restore supports only public-schema application backups.");
    // Preserve separate schema COMMENT entries; --no-privileges remains the
    // documented CLI policy, unlike the VPS restore's runtime-role ACL policy.
    return `;${line}`;
  }).join("\n");
  if ((await commandOutput("psql", ["-X", "-At", "--set", "ON_ERROR_STOP=1", "--command", otherSchemas], environment)).trim() !== "f") {
    fail("Restore refuses a target containing other user schemas.");
  }
  const stage = await mkdtemp(path.join(directory, ".restore-sql-"));
  try {
    const selection = path.join(stage, "restore.list");
    const payload = path.join(stage, "payload.sql");
    const complete = path.join(stage, "restore.sql");
    await writeFile(selection, list, { mode: 0o600 });
    await writeFile(payload, "", { mode: 0o600 });
    // Materialize the entire archive before psql: a failed producer must never
    // allow a valid SQL prefix to commit just because a pipe reached EOF.
    await run("pg_restore", ["--no-owner", "--no-privileges", "--exit-on-error", `--use-list=${selection}`, `--file=${payload}`, archive], environment);
    await writeFile(complete, `DO $restore_guard$ BEGIN IF (${otherSchemas}) THEN RAISE EXCEPTION 'Restore refuses other user schemas'; END IF; END $restore_guard$;\nDROP SCHEMA IF EXISTS public CASCADE;\nCREATE SCHEMA public AUTHORIZATION CURRENT_USER;\nREVOKE ALL ON SCHEMA public FROM PUBLIC;\n`, { mode: 0o600 });
    await pipeline(createReadStream(payload), createWriteStream(complete, { flags: "a" }));
    await appendFile(complete, "\nREVOKE ALL ON SCHEMA public FROM PUBLIC;\n");
    // Credentials and the validated database name stay in the private PG
    // environment, never a connection URI or unescaped --dbname argument.
    await run("psql", ["-X", "--single-transaction", "--set", "ON_ERROR_STOP=1", `--file=${complete}`], environment);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
