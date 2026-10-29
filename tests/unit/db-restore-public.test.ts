import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { restorePublicArchive } from "../../scripts/db-restore-public.mjs";

const toc = "3; 2615 2200 SCHEMA - public owner\n4; 0 0 COMMENT - SCHEMA public owner\n5; 1259 1 TABLE public recovered owner\n";

async function fixture(options: { contents?: string; target?: string; generationFailure?: boolean; applyFailure?: boolean } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "public-restore-"));
  const calls: { command: string; args: string[]; environment: object }[] = [];
  const environment = { PGDATABASE: "validated-database", PGPASSFILE: "private-passfile" };
  let selection = "", applied = "", failure: unknown;
  try {
    await restorePublicArchive({ archive: "/synthetic/archive.dump", directory, environment,
      fail: (message: string) => { throw new Error(message); },
      commandOutput: async (command: string, args: string[], env: object) => {
        calls.push({ command, args, environment: env });
        return command === "pg_restore" ? options.contents ?? toc : options.target ?? "f\n";
      },
      run: async (command: string, args: string[], env: object) => {
        calls.push({ command, args, environment: env });
        const file = args.find((arg) => arg.startsWith("--file="))!.slice(7);
        if (command === "pg_restore") {
          selection = await readFile(args.find((arg) => arg.startsWith("--use-list="))!.slice(11), "utf8");
          await writeFile(file, "CREATE TABLE public.recovered (id integer);\n");
          if (options.generationFailure) throw new Error("synthetic archive failure");
        } else {
          applied = await readFile(file, "utf8");
          if (options.applyFailure) throw new Error("synthetic SQL failure");
        }
      },
    });
  } catch (error) { failure = error; }
  const remaining = await readdir(directory);
  await rm(directory, { recursive: true, force: true });
  return { calls, selection, applied, failure, remaining, environment };
}

describe("complete public-schema archive restore", () => {
  it("materializes SQL, filters only the public definition, and atomically replaces target residue", async () => {
    const result = await fixture();
    expect(result.failure).toBeUndefined();
    expect(result.calls.map(({ command }) => command)).toEqual(["pg_restore", "psql", "pg_restore", "psql"]);
    expect(result.selection).toContain(";3; 2615 2200 SCHEMA - public owner");
    expect(result.selection).toContain("\n4; 0 0 COMMENT - SCHEMA public owner");
    expect(result.applied).toContain("DROP SCHEMA IF EXISTS public CASCADE;\nCREATE SCHEMA public AUTHORIZATION CURRENT_USER;");
    expect(result.applied).toContain("CREATE TABLE public.recovered");
    expect(result.applied).toContain("RAISE EXCEPTION 'Restore refuses other user schemas'");
    expect(result.calls[2].args).toEqual(expect.arrayContaining(["--no-owner", "--no-privileges", "--exit-on-error"]));
    expect(result.calls[3].args).toEqual(expect.arrayContaining(["--single-transaction", "ON_ERROR_STOP=1"]));
    expect(result.calls.every(({ environment }) => environment === result.environment)).toBe(true);
    expect(JSON.stringify(result.calls.map(({ args }) => args))).not.toContain("private-passfile");
    expect(result.remaining).toEqual([]);
  });

  it("never applies a truncated but valid SQL prefix after archive generation fails", async () => {
    const result = await fixture({ generationFailure: true });
    expect(result.failure).toBeInstanceOf(Error);
    expect(result.calls.filter(({ command }) => command === "psql")).toHaveLength(1);
    expect(result.applied).toBe("");
    expect(result.remaining).toEqual([]);
  });

  it("cleans private staging even if transactional SQL application fails", async () => {
    const result = await fixture({ applyFailure: true });
    expect(result.failure).toBeInstanceOf(Error);
    expect(result.remaining).toEqual([]);
  });

  it.each([
    { contents: `${toc}6; 2615 123 SCHEMA - another_application owner\n` },
    { target: "t\n" },
  ])("refuses archives or targets with other user schemas before mutation: %j", async (options) => {
    const result = await fixture(options);
    expect(result.failure).toBeInstanceOf(Error);
    expect(result.applied).toBe("");
    expect(result.calls.filter(({ command, args }) => command === "pg_restore" && args[0] !== "--list")).toHaveLength(0);
    expect(result.remaining).toEqual([]);
  });
});
