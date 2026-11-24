// Round TUIT service worker: the app opens with no signal, and a tapped reminder opens its job.
const CACHE = 'round-tuit-v1';
const SHELL = ['./', 'index.html', 'styles.css', 'manifest.webmanifest', 'device.html',
  'js/app.js', 'js/order.js', 'js/parse.js', 'js/store.js', 'js/speech.js', 'js/alarm.js', 'js/textsize.js',
  'fonts/fraunces-latin-wght-normal.woff2', 'fonts/inter-latin-wght-normal.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-180.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// The newest copy when there is signal; the kept copy when there is none.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html')))
  );
});

self.addEventListener('notificationclick', (e) => {
  const id = e.notification.data && e.notification.data.id;
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const page = list[0];
    if (page) { page.postMessage({ open: id }); return page.focus(); }
    return self.clients.openWindow('./');
  }));
});
