import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { it, expect, vi } from "vitest";
function worker() {
  const handlers: Record<string, (event: unknown) => void> = {};
  const cache = {
    addAll: vi.fn(async () => undefined),
    match: vi.fn(async () => new Response("Offline")),
  };
  const caches = {
    open: vi.fn(async () => cache),
    match: vi.fn(async () => new Response("Offline")),
    keys: vi.fn(async () => [
      "other-cache",
      "sww-offline-old",
      "sww-offline-v2",
    ]),
    delete: vi.fn(async () => true),
  };
  const fetch = vi.fn(async () => new Response("Private page"));
  runInNewContext(
    readFileSync(new URL("../../public/sww-sw.js", import.meta.url), "utf8"),
    {
      self: {
        location: { origin: "https://workspace.test" },
        addEventListener: (name: string, fn: (event: unknown) => void) => {
          handlers[name] = fn;
        },
        skipWaiting: async () => undefined,
        clients: { claim: async () => undefined },
      },
      caches,
      fetch,
      URL,
      Response,
    },
  );
  return { handlers, cache, caches, fetch };
}
it("pre-caches only public shell assets", async () => {
  const w = worker();
  let task: Promise<unknown> | undefined;
  w.handlers.install({
    waitUntil: (value: Promise<unknown>) => {
      task = value;
    },
  });
  await task;
  expect(w.cache.addAll).toHaveBeenCalledWith([
    "/offline.html",
    "/shell-offline.css",
    "/brand/fonts/Gilroy-Light.woff2",
    "/brand/icon-192.png",
  ]);
});
it.each(["/api/files/private", "/api/auth/session", "/w/private?_rsc=abc"])(
  "leaves private API/RSC responses outside service-worker handling: %s",
  (path) => {
    const w = worker();
    const respondWith = vi.fn();
    w.handlers.fetch({
      request: new Request(`https://workspace.test${path}`),
      respondWith,
    });
    expect(respondWith).not.toHaveBeenCalled();
  },
);
it("never stores authenticated navigation HTML", async () => {
  const w = worker();
  let response: Promise<Response> | undefined;
  w.handlers.fetch({
    request: {
      url: "https://workspace.test/w/private",
      method: "GET",
      mode: "navigate",
      headers: new Headers(),
    },
    respondWith: (value: Promise<Response>) => {
      response = value;
    },
  });
  expect(await (await response)?.text()).toBe("Private page");
  expect(w.caches.open).not.toHaveBeenCalled();
  expect(w.cache.addAll).not.toHaveBeenCalled();
});
it("uses only the public offline shell after a network failure", async () => {
  const w = worker();
  w.fetch.mockRejectedValueOnce(new Error("offline"));
  let response: Promise<Response> | undefined;
  w.handlers.fetch({
    request: {
      url: "https://workspace.test/w/private",
      method: "GET",
      mode: "navigate",
      headers: new Headers(),
    },
    respondWith: (value: Promise<Response>) => {
      response = value;
    },
  });
  expect(await (await response)?.text()).toBe("Offline");
  expect(w.caches.match).toHaveBeenCalledWith("/offline.html");
});
it("removes only obsolete caches belonging to this worker", async () => {
  const w = worker();
  let task: Promise<unknown> | undefined;
  w.handlers.activate({
    waitUntil: (value: Promise<unknown>) => {
      task = value;
    },
  });
  await task;
  expect(w.caches.delete).toHaveBeenCalledExactlyOnceWith("sww-offline-old");
});
