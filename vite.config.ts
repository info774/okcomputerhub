import { defineConfig } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';

// El service worker (public/sw.js) lleva `const BUILD = 'dev'`; el workflow de
// deploy pone HUB_BUILD=<sha> y aquí se sella en dist/sw.js, así cada deploy
// estrena caché y no se sirve JS de una versión anterior.
export default defineConfig({
  // Dos páginas: la app del equipo y el área de clientes (portal.html).
  build: { target: 'es2022', sourcemap: true, rollupOptions: { input: { main: 'index.html', portal: 'portal.html' } } },
  plugins: [{
    name: 'sellar-sw',
    apply: 'build',
    closeBundle() {
      const build = process.env.HUB_BUILD || 'local-' + Date.now();
      const f = 'dist/sw.js';
      const src = readFileSync(f, 'utf8');
      const out = src.replace("const BUILD = 'dev';", `const BUILD = '${build}';`);
      if (out === src) throw new Error('No se pudo sellar BUILD en dist/sw.js');
      writeFileSync(f, out);
      writeFileSync('dist/version.json', JSON.stringify({ build }));
    },
  }],
});
