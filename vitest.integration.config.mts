import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
// Only TEST_DATABASE_URL is read from a local .env; nothing else is inherited from it.
if (!process.env.TEST_DATABASE_URL) {
  try {
    const { parseEnv } = await import("node:util");
    const { readFileSync } = await import("node:fs");
    const parsed = parseEnv(readFileSync(".env", "utf8"));
    if (parsed.TEST_DATABASE_URL) process.env.TEST_DATABASE_URL = parsed.TEST_DATABASE_URL;
  } catch {
    // No .env: the explicit check below explains what is missing.
  }
}
const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

if (!testDatabaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL is required for PostgreSQL integration tests; point it only at a disposable database.",
  );
}

// Never inherit an ambient application DATABASE_URL for a destructive test
// suite. All Prisma clients created by the tests use the explicitly named test
// database instead.
process.env.DATABASE_URL = testDatabaseUrl;
// The schema's `directUrl` must resolve too; never let it point elsewhere.
process.env.DIRECT_URL = testDatabaseUrl;

export default defineConfig({
  resolve: {
    alias: {
      "@": rootDir,
      "server-only": `${rootDir}tests/helpers/server-only.ts`,
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    exclude: ["**/node_modules/**", "design-kit/**"],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 20_000,
    // Hermetic secrets for crypto helpers; never real values.
    env: {
      AUTH_SECRET: "integration-test-auth-secret-0123456789abcdef",
      MFA_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
      INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString("base64"),
      NEXT_PUBLIC_BASE_URL: "http://localhost:3100",
      REDIS_URL: "",
      // Prisma can load local app settings after generation; keep storage hermetic.
      S3_BUCKET: process.env.TEST_S3_BUCKET ?? "",
      S3_REGION: process.env.TEST_S3_BUCKET ? (process.env.S3_REGION ?? "us-east-1") : "",
    },
  },
});
