/* Service worker: offline reading and fast repeat visits.
 *
 *  - pages:  network first (4 s), then the cached copy, then /offline.html
 *  - saved:  pages of articles the reader saved — kept until un-saved
 *  - static: hashed Next.js assets, cache first
 *  - media:  images, cache first (bounded)
 *  - API calls always go to the network.
 */
const VERSION = 'v1';
const PAGES = `pages-${VERSION}`;
const SAVED = 'saved-articles';
const STATIC = `static-${VERSION}`;
const MEDIA = `media-${VERSION}`;
const OFFLINE_URL = '/offline.html';
const LIMITS = { [PAGES]: 40, [MEDIA]: 150 };

function strategyFor(request) {
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return 'bypass';
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin')) return 'bypass';
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/'))
    return 'static';
  if (url.pathname.startsWith('/media/')) return 'media';
  if (request.mode === 'navigate') return 'page';
  return 'bypass';
}
self.strategyFor = strategyFor;

async function trim(cacheName) {
  const limit = LIMITS[cacheName];
  if (!limit) return;
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - limit))) await cache.delete(key);
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function networkFirstPage(request) {
  try {
    const response = await withTimeout(fetch(request), 4000);
    if (response.ok && response.type === 'basic') {
      const copy = response.clone();
      caches.open(PAGES).then((cache) => cache.put(request, copy).then(() => trim(PAGES)));
    }
    return response;
  } catch {
    const cached =
      (await caches.match(request, { cacheName: SAVED })) || (await caches.match(request));
    return cached || (await caches.match(OFFLINE_URL)) || Response.error();
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const copy = response.clone();
    caches.open(cacheName).then((cache) => cache.put(request, copy).then(() => trim(cacheName)));
  }
  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC).then((cache) => cache.addAll([OFFLINE_URL, '/icons/icon-192.png'])),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  const keep = new Set([PAGES, SAVED, STATIC, MEDIA]);
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => !keep.has(name)).map((name) => caches.delete(name))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const strategy = strategyFor(event.request);
  if (strategy === 'page') event.respondWith(networkFirstPage(event.request));
  else if (strategy === 'static') event.respondWith(cacheFirst(event.request, STATIC));
  else if (strategy === 'media') event.respondWith(cacheFirst(event.request, MEDIA));
});

// Saving an article keeps an offline copy; un-saving removes it.
self.addEventListener('message', (event) => {
  const { type, url } = event.data || {};
  if (typeof url !== 'string' || !url.startsWith('/')) return;
  if (type === 'cache-article') {
    event.waitUntil(
      caches
        .open(SAVED)
        .then((cache) => cache.add(url))
        .catch(() => {}),
    );
  } else if (type === 'uncache-article') {
    event.waitUntil(caches.open(SAVED).then((cache) => cache.delete(url)));
  }
});

// Push notifications (breaking news, daily briefing) ---------------------------
self.addEventListener('push', (event) => {
  let data;
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data ? event.data.text() : '' };
  }
  const url = typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/';
  event.waitUntil(
    self.registration.showNotification(data.title || 'Newsmedia', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag,
      renotify: Boolean(data.tag && data.tag.startsWith('urgent')),
      data: { url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(
    (event.notification.data && event.notification.data.url) || '/',
    self.location.origin,
  ).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
