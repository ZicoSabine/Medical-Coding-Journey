const VERSION = "medical-coding-shell-v1";
const SHELL = ["/", "/index.html", "/styles.css", "/app.js", "/calendar.js", "/offline.js", "/manifest.webmanifest", "/icons/icon-192.svg", "/icons/icon-512.svg"];
self.addEventListener("install", (event) => event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/") || event.request.method !== "GET") return;
  event.respondWith(fetch(event.request).then((response) => { const copy = response.clone(); caches.open(VERSION).then((cache) => cache.put(event.request, copy)); return response; }).catch(() => caches.match(event.request).then((cached) => cached || caches.match("/index.html"))));
});
