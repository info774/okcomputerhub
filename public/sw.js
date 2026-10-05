// Service worker del hub. BUILD lo sella vite.config.ts con el SHA del deploy:
// cada versión estrena caché y borra las anteriores.
//   · Navegaciones (HTML): red primero; sin red, la última copia.
//   · /assets/* (con hash en el nombre): caché primero, nunca cambian.
//   · Supabase y cualquier otro origen: ni se tocan.
const BUILD = 'dev';
const CACHE = `hub-${BUILD}`;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['/', '/manifest.webmanifest', '/iconos/icono.svg'])));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith('hub-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Páginas sueltas (valorar.html, el portal…): ni se tocan, no son la app.
  if (e.request.mode === 'navigate' && url.pathname.endsWith('.html') && url.pathname !== '/index.html') return;
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request)
      .then(r => { const copia = r.clone(); caches.open(CACHE).then(c => c.put('/', copia)); return r; })
      .catch(() => caches.match('/')));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
      if (r.ok) { const copia = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copia)); }
      return r;
    })));
  }
});

// Avisos push (función `push`, claves VAPID del hub). Un mensaje de chat no se
// enseña si el hub está a la vista: ya se ve en pantalla.
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: e.data ? e.data.text() : 'Ok Computer Hub' }; }
  e.waitUntil((async () => {
    if (d.data && d.data.chat) {
      const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (ventanas.some(w => w.visibilityState === 'visible')) return;
    }
    await self.registration.showNotification(d.title || 'Ok Computer Hub', {
      body: d.body || '', tag: d.tag || 'hub', data: d.data || {},
      icon: '/iconos/icono-192.png', badge: '/iconos/icono-192.png',
    });
  })());
});

// Tocar el aviso: a la pantalla que dice, en el hub ya abierto si lo hay.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(lista => {
    for (const c of lista) {
      if (new URL(c.url).origin === location.origin && 'focus' in c) {
        c.postMessage({ tipo: 'hub-ir', url });
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
