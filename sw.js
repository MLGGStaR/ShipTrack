// Offline copy of the app shell. Network first, so updates land on the next load; cache only as a fallback.
// Requests bypass the browser's HTTP cache (GitHub Pages sends max-age=600) and revalidate with the server instead,
// so a fresh deploy shows up on the very next open rather than up to ten minutes later.
const VERSION = 'shiptrack-v3';
const SHELL = ['./', './index.html', './styles.css', './app.js', './carriers.js', './providers.js', './format.js', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return; // never touch API calls
  event.respondWith(
    fetch(event.request, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) caches.open(VERSION).then((c) => c.put(event.request, res.clone()));
        return res;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || (event.request.mode === 'navigate' ? caches.match('./index.html') : undefined))),
  );
});
