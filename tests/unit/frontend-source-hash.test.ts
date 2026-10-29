import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("fingerprints LF and CRLF checkouts equally while detecting changed source", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "sww-source-hash-"));
  const moduleUrl = new URL("../../scripts/frontend-source-hash.mjs", import.meta.url).href;
  for (const name of ["app", "components", "lib", "prisma"]) mkdirSync(path.join(directory, name));
  const files = ["app/page.tsx", "components/control.tsx", "lib/model.ts", "prisma/schema.prisma"];
  const setContents = (lineEnding: string, value = "original") => {
    for (const file of files) writeFileSync(path.join(directory, file), `first ${value}${lineEnding}second${lineEnding}`);
  };
  const fingerprint = () => {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `import { frontendSourceHash } from ${JSON.stringify(moduleUrl)}; console.log(frontendSourceHash());`], { cwd: directory, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout.trim();
  };
  try {
    setContents("\n");
    const lf = fingerprint();
    expect(lf).toMatch(/^[a-f0-9]{64}$/);
    setContents("\r\n");
    expect(fingerprint()).toBe(lf);
    setContents("\n", "changed");
    expect(fingerprint()).not.toBe(lf);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("generates identical frontend templates from LF and CRLF source", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "sww-catalog-eol-"));
  const root = fileURLToPath(new URL("../../", import.meta.url));
  for (const name of ["app/actions", "components", "lib", "prisma", "scripts"]) mkdirSync(path.join(directory, name), { recursive: true });
  for (const name of ["generate-frontend-catalog.mjs", "frontend-source-hash.mjs"]) copyFileSync(path.join(root, "scripts", name), path.join(directory, "scripts", name));
  symlinkSync(path.join(root, "node_modules"), path.join(directory, "node_modules"), "junction");
  const source = 'import { requireAuth } from "@/lib/permissions";\nexport default async function Page() {\n  const user = await requireAuth();\n  return <main>{user.name}</main>;\n}\n';
  const generate = (content: string) => {
    writeFileSync(path.join(directory, "app/page.tsx"), content);
    const result = spawnSync(process.execPath, ["scripts/generate-frontend-catalog.mjs"], { cwd: directory, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    return readFileSync(path.join(directory, "frontend/pages.json"), "utf8");
  };
  try {
    const lf = generate(source);
    expect(generate(source.replace(/\n/g, "\r\n"))).toBe(lf);
    expect(generate(source.replace("user.name", "user.email"))).not.toBe(lf);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 15_000);
