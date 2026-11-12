import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let cached: string | undefined;
/** Release name from the VERSION file at the app root. */
export function appRelease(): string {
  if (cached) return cached;
  try {
    cached = `space-works@${readFileSync(join(process.cwd(), "VERSION"), "utf8").trim() || "unknown"}`;
  } catch {
    cached = "space-works@unknown";
  }
  return cached;
}
