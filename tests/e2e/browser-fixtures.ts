import { createHash } from "node:crypto";
import { test as base } from "@playwright/test";

export { expect, type Download, type Page } from "@playwright/test";

// Model independent clients behind the explicitly trusted disposable proxy.
// Keep production rate limits enabled instead of sharing one IP across every
// user's login and action in a fast seeded acceptance run.
export const test = base.extend({
  extraHTTPHeaders: async ({ extraHTTPHeaders }, provideHeaders, testInfo) => {
    const isolatedProxy = process.env.CI === "true"
      && process.env.ALLOW_INSECURE_PRODUCTION_TESTS === "1"
      && process.env.PLAYWRIGHT_TRUSTED_IP_HEADER === "x-real-ip";
    if (!isolatedProxy) return provideHeaders(extraHTTPHeaders);
    const bytes = createHash("sha256").update(testInfo.testId).digest();
    await provideHeaders({ ...extraHTTPHeaders, "x-real-ip": `127.64.${bytes[0]}.${bytes[1]}` });
  },
});
