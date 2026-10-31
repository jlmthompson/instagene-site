// App shell: precached, served from cache and refreshed in the background.
// data/bundle.enc: network first, falling back to the last cached copy (offline on a train).
const CACHE = "instagene-v5";
const SHELL = [
  "./",
  "index.html",
  "app.css",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "js/main.js",
  "js/charts.js",
  "js/crypto.js",
  "js/events.js",
  "js/feed.js",
  "js/graphics.js",
  "js/illustrations.js",
  "js/render.js",
  "js/store.js",
  "js/stories.js",
  "js/sync.js",
  "js/tracker.js",
  "js/views.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const NETWORK_TIMEOUT_MS = 4000; // a slow train connection falls back to the cached bundle

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), NETWORK_TIMEOUT_MS);
  try {
    const res = await fetch(req, { cache: "no-store", signal: ctrl.signal });
    if (res.ok) await cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(CACHE);
  const req = event.request.mode === "navigate" ? "index.html" : event.request;
  const hit = await cache.match(req, { ignoreSearch: true });
  const update = fetch(event.request)
    .then((res) => {
      if (res.ok) return cache.put(req, res.clone()).then(() => res);
      return res;
    });
  if (hit) {
    event.waitUntil(update.catch(() => {}));
    return hit;
  }
  return update;
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.endsWith("/data/bundle.enc")) e.respondWith(networkFirst(e.request));
  else e.respondWith(staleWhileRevalidate(e));
});
