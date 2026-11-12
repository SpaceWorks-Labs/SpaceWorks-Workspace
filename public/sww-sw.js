const SHELL_CACHE = "sww-offline-v2";
const PUBLIC_SHELL = [
  "/offline.html",
  "/shell-offline.css",
  "/brand/fonts/Gilroy-Light.woff2",
  "/brand/icon-192.png",
];
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PUBLIC_SHELL))
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => key.startsWith("sww-offline-") && key !== SHELL_CACHE,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    request.headers.has("RSC") ||
    url.searchParams.has("_rsc")
  )
    return;
  if (PUBLIC_SHELL.includes(url.pathname) && !url.search) {
    event.respondWith(
      caches
        .open(SHELL_CACHE)
        .then(
          async (cache) => (await cache.match(url.pathname)) || fetch(request),
        ),
    );
  } else if (request.mode === "navigate") {
    // Workspace pages, HTML, RSC payloads and API responses are never stored.
    event.respondWith(
      fetch(request).catch(
        async () => (await caches.match("/offline.html")) || Response.error(),
      ),
    );
  }
});
