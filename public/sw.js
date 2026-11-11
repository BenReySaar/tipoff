// טיפ-אוף service worker: opens without internet (last known schedule) and shows push notifications.
const CACHE = 'tipoff-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Network first for the page and the schedule, so parents see fresh data; fall back to the last copy offline or when slow.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const fresh = e.request.mode === 'navigate' || url.pathname === '/api/data' || SHELL.includes(url.pathname);
  if (!fresh) return;
  const key = e.request.mode === 'navigate' ? '/' : e.request;
  const net = fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(key, copy)); }
    return r;
  });
  e.waitUntil(net.catch(() => {}));
  // the page itself: if the network is slow, open from the saved copy after 4 seconds (the page refreshes its schedule on its own)
  if (e.request.mode === 'navigate' || SHELL.includes(url.pathname)) {
    e.respondWith(new Promise(res => {
      let done = false;
      const t = setTimeout(async () => { const c = await caches.match(key); if (c && !done) { done = true; res(c); } }, 4000);
      net.then(r => { if (!done) { done = true; clearTimeout(t); res(r); } })
        .catch(async () => { if (!done) { done = true; clearTimeout(t); res((await caches.match(key)) || Response.error()); } });
    }));
    return;
  }
  e.respondWith(net.catch(() => caches.match(key)));
});

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data && e.data.text() }; }
  const title = d.title || 'טיפ-אוף';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || 'יש עדכון במשחקים שלכם',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag: d.tag || 'tipoff',
    renotify: true,
    lang: 'he', dir: 'rtl',
    data: { url: d.url || '/' },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || '/', location.origin).href;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.startsWith(location.origin)) { c.navigate(target).catch(() => {}); return c.focus(); }
    return clients.openWindow(target);
  }));
});
