import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": rootDir,
      "server-only": `${rootDir}tests/helpers/server-only.ts`,
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    exclude: ["**/node_modules/**", "design-kit/**"],
    // Hermetic base URL, whatever a developer's shell or .env sets.
    env: {
      NEXT_PUBLIC_BASE_URL: "http://localhost:3100",
      AUTH_SECRET: "unit-test-auth-secret-0123456789abcdef0123",
      MFA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
      INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64"),
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["lib/**/*.ts", "app/actions/**/*.ts"],
      exclude: ["**/*.client.ts"],
    },
  },
});
