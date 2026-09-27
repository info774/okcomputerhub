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
