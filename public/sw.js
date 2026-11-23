const CACHE = "paperscan-v11";
const ROOT = new URL("./", self.registration.scope);
const asset = (path) => new URL(path, ROOT).href;
const coreFiles = [
  "",
  "index.html",
  "result.html",
  "result.js",
  "style.css",
  "papers.json",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "icon.svg",
  "vendor/zxing.min.js",
  "fonts/bbh-bogle-latin.woff2",
  "fonts/firjar-latin.woff2",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    fetch(asset("index.html"))
      .then((response) => response.text())
      .then((html) => {
        const builtAssets = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^\"]+)"/g)]
          .map((match) => match[1]);
        return caches
          .open(CACHE)
          .then((cache) => cache.addAll([...coreFiles, ...builtAssets].map(asset)));
      })
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
            .filter((key) => key.startsWith("paperscan-") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => {
          if (cached) return cached;
          if (request.mode === "navigate") {
            const fallback = new URL(request.url).pathname.endsWith("/result.html")
              ? asset("result.html")
              : asset("index.html");
            return caches.match(fallback);
          }
          return Response.error();
        }),
      ),
  );
});
