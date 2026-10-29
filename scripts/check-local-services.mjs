import { assertLocalServices } from "./dev-stack.mjs";

try {
  assertLocalServices();
  console.info("Local PostgreSQL, Redis, storage and email targets verified.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Local service configuration is invalid.");
  process.exitCode = 1;
}
