// Minimal service worker: precache the app shell so the PWA installs + opens offline.
// The webhook API (/search, /probe, /add) is never cached — it's cross-origin and always live.
// NOTE: bump CACHE on every shell change, or installed apps keep serving the old UI.
const CACHE = "travelgrabber-pwa-v2";
const SHELL = ["./", "./index.html", "./app.js", "./manifest.webmanifest", "./icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) =>
    Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  // Network-first for the shell so a redeploy shows up promptly; cache is the offline fallback.
  e.respondWith(fetch(req).then((res) => {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
    return res;
  }).catch(() => caches.match(req)));
});
