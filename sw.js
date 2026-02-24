const CACHE_VERSION = "weather-story-shell-v1";
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./script.js",
  "./manifest.webmanifest",
  "./icons/icon-192.svg",
  "./icons/icon-512.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

function isAppShellRequest(requestUrl) {
  const path = requestUrl.pathname;
  return (
    path.endsWith("/") ||
    path.endsWith("/index.html") ||
    path.endsWith("/styles.css") ||
    path.endsWith("/script.js") ||
    path.endsWith("/manifest.webmanifest") ||
    path.includes("/icons/")
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Let weather/geocoding APIs stay network-first and uncached.
  if (
    url.origin.includes("open-meteo.com") ||
    url.hostname.includes("nominatim.openstreetmap.org") ||
    url.hostname.includes("fonts.googleapis.com") ||
    url.hostname.includes("fonts.gstatic.com")
  ) {
    return;
  }

  if (!isAppShellRequest(url)) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match("./index.html")))
  );
});
