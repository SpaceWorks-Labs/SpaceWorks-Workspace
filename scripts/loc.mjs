#!/usr/bin/env node
// Counts lines of tracked files and prints Markdown tables by language and by area.
// Usage: npm run loc [-- --json]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const EXCLUDED_PREFIXES = ["design-kit/", "node_modules/"];
const EXCLUDED_FILES = new Set(["lib/frontend/registry.ts"]);
const EXCLUDED_NAMES = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb"]);
const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|icns|pdf|woff2?|ttf|otf|eot|zip|gz|tgz|mp[34]|mov|webm|wasm|bin|sqlite)$/i;

const LANGUAGES = {
  ".ts": "TypeScript", ".tsx": "TypeScript (TSX)", ".js": "JavaScript", ".mjs": "JavaScript",
  ".cjs": "JavaScript", ".jsx": "JavaScript", ".css": "CSS", ".sql": "SQL", ".prisma": "Prisma",
  ".md": "Markdown", ".mdx": "Markdown", ".json": "JSON", ".yml": "YAML", ".yaml": "YAML",
  ".sh": "Shell", ".html": "HTML", ".svg": "SVG", ".toml": "TOML", ".tpl": "Helm template",
};

export function languageOf(file) {
  const base = path.posix.basename(file);
  if (base === "Dockerfile" || base.startsWith("Dockerfile.")) return "Dockerfile";
  if (base === "Caddyfile") return "Caddyfile";
  return LANGUAGES[path.posix.extname(base).toLowerCase()] ?? "Other";
}

export function areaOf(file) {
  const parts = file.split("/");
  return parts.length === 1 ? "(root)" : parts[0];
}

export function isCountable(file) {
  if (EXCLUDED_FILES.has(file) || EXCLUDED_NAMES.has(path.posix.basename(file))) return false;
  if (EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix))) return false;
  return !BINARY.test(file);
}

export function countLines(text) {
  if (text.length === 0) return 0;
  const newlines = text.split("\n").length - 1;
  return text.endsWith("\n") ? newlines : newlines + 1;
}

/** Groups `{ file, lines }` entries by a key function into sorted rows. */
export function groupBy(entries, keyOf) {
  const groups = new Map();
  for (const entry of entries) {
    const key = keyOf(entry.file);
    const row = groups.get(key) ?? { name: key, files: 0, lines: 0 };
    row.files += 1;
    row.lines += entry.lines;
    groups.set(key, row);
  }
  return [...groups.values()].sort((a, b) => b.lines - a.lines || a.name.localeCompare(b.name));
}

export function summarize(entries) {
  return {
    totals: { files: entries.length, lines: entries.reduce((sum, entry) => sum + entry.lines, 0) },
    byLanguage: groupBy(entries, languageOf),
    byArea: groupBy(entries, areaOf),
  };
}

const n = (value) => value.toLocaleString("en-US");

export function toMarkdown(summary, date = new Date().toISOString().slice(0, 10)) {
  const table = (title, rows) => [
    `| ${title} | Files | Lines |`,
    "| --- | ---: | ---: |",
    ...rows.map((row) => `| ${row.name} | ${n(row.files)} | ${n(row.lines)} |`),
    `| **Total** | **${n(summary.totals.files)}** | **${n(summary.totals.lines)}** |`,
  ].join("\n");
  return [
    `Tracked files as of ${date} (lockfiles, generated registry, binaries and the design-kit submodule excluded).`,
    "",
    table("Language", summary.byLanguage),
    "",
    table("Area", summary.byArea),
    "",
  ].join("\n");
}

function main() {
  const listed = execFileSync("git", ["ls-files", "-z"], { cwd: root, maxBuffer: 64 * 1024 * 1024 })
    .toString("utf8").split("\0").filter(Boolean);
  const entries = [];
  for (const file of listed.filter(isCountable)) {
    try {
      const buffer = readFileSync(path.join(root, file));
      if (buffer.includes(0)) continue; // binary content
      entries.push({ file, lines: countLines(buffer.toString("utf8")) });
    } catch {
      // Deleted in the working tree, a submodule gitlink or a directory: nothing to count.
    }
  }
  const summary = summarize(entries);
  console.log(process.argv.includes("--json") ? JSON.stringify(summary, null, 2) : toMarkdown(summary));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
