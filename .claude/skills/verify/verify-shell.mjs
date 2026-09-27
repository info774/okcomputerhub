// Arnés del shell del hub (fase 0): arranca el build real en Chromium headless
// con la red de Supabase INTERCEPTADA (fixtures), nunca contra datos reales.
//
//   npm run build && npm run verify
//
// Comprueba: login sin sesión; usuario no dado de alta; shell con menú por
// grupos; baldosas con número (Content-Range del espejo); pantalla Datos;
// «Sincronizar ahora» llama a sync-app con la sesión; buscador Ctrl+K; tema;
// que TODA petición REST vaya con Accept-Profile: hub (nunca public, que es de
// Breeze); que no quede ningún on*= inline; y móvil sin scroll horizontal.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';

const REF = 'adomalsxsymxzuozksmt';
const SB = `https://${REF}.supabase.co`;
const PUERTO = 4178;
const BASE = `http://127.0.0.1:${PUERTO}`;
const CAPTURAS = 'verify-capturas';
mkdirSync(CAPTURAS, { recursive: true });

let fallos = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fallos++; };

// ── Servidor: vite preview sobre dist/ ─────────────────────────────────────
const srv = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PUERTO), '--strictPort', '--host', '127.0.0.1'], { stdio: 'pipe' });
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('vite preview no arrancó')), 20000);
  srv.stdout.on('data', d => { if (String(d).includes(String(PUERTO))) { clearTimeout(t); res(); } });
});

// ── Sesión falsa de supabase-js v2 ─────────────────────────────────────────
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
function sesion(email) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', email, role: 'authenticated', exp })}.firma`;
  return { access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: exp,
    user: { id: 'u1', email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} } };
}

const FIX = {
  usuarios: [{ id: 'u1', nombre: 'Fran Admin', email: 'admin@ok.test', rol: 'admin', activo: true }],
  areas: [
    { area: 'clientes', dueno: 'app', tablas: ['clientes', 'locales', 'contactos'], notas: 'Fase 4' },
    { area: 'trabajos', dueno: 'app', tablas: ['trabajos', 'agenda'], notas: 'Final' },
  ],
  sync_estado: [
    { clave: 'audit', ultima_ok: new Date(Date.now() - 5 * 60000).toISOString(), filas: 12, detalle: { trabajos: 7, tareas: 5 } },
    { clave: 'completo', ultima_ok: null, ultimo_error: 'Faltan APP_SUPABASE_URL', ultimo_error_at: new Date().toISOString() },
  ],
};
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Range' };
const CUENTAS = { trabajos: 7, agenda: 3, tickets: 4, tareas: 0, clientes: 120, presupuestos: 2, locales: 150, contactos: 300 };

async function preparar(ctx, { email, usuarios = FIX.usuarios } = {}) {
  const reg = { rest: [], funciones: [] };
  await ctx.route(`${SB}/rest/v1/**`, async route => {
    const req = route.request();
    const url = new URL(req.url());
    const tabla = url.pathname.split('/').pop();
    reg.rest.push({ metodo: req.method(), tabla, perfil: req.headers()['accept-profile'], url: url.toString() });
    if (req.method() === 'HEAD') {
      // Como el PostgREST real: Content-Range expuesto por CORS (si no, el
      // navegador no deja leerlo y la baldosa se queda sin número).
      return route.fulfill({ status: 200, headers: { ...CORS, 'Content-Range': `0-0/${CUENTAS[tabla] ?? 0}` }, body: '' });
    }
    let data = tabla === 'usuarios' ? usuarios : (FIX[tabla] ?? []);
    if (tabla === 'sync_estado' && url.searchParams.get('clave') === 'eq.audit') data = data.filter(d => d.clave === 'audit');
    return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await ctx.route(`${SB}/functions/v1/**`, async route => {
    const req = route.request();
    reg.funciones.push({ url: req.url(), auth: req.headers()['authorization'], body: req.postDataJSON() });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, filas: 3 }) });
  });
  await ctx.route(`${SB}/auth/v1/**`, route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  if (email) {
    const s = sesion(email);
    await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [`sb-${REF}-auth-token`, JSON.stringify(s)]);
  }
  return reg;
}

// En la nube de Claude Code, el Chromium preinstalado; en CI, el de Playwright.
const CHROMIUM = '/opt/pw-browsers/chromium';
const browser = await chromium.launch({ executablePath: existsSync(CHROMIUM) ? CHROMIUM : undefined });
try {
  // 1. Sin sesión → login
  {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    await preparar(ctx);
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForSelector('#lg-email', { timeout: 10000 });
    ok(true, 'sin sesión sale el login');
    await ctx.close();
  }

  // 2. Sesión de alguien que no está en hub.usuarios
  {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    await preparar(ctx, { email: 'nadie@ok.test', usuarios: [] });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForSelector('#lg-aviso:not([hidden])', { timeout: 10000 });
    ok((await page.textContent('#lg-aviso')).includes('no está dado de alta'), 'usuario sin alta en el hub: login con aviso');
    await ctx.close();
  }

  // 3. Admin: shell, baldosas, Datos, sync, buscador, tema
  {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 860 } });
    const reg = await preparar(ctx, { email: 'admin@ok.test' });
    const page = await ctx.newPage();
    const errores = [];
    page.on('pageerror', e => errores.push(String(e)));
    await page.addInitScript(() => localStorage.setItem('hub_tour_visto', '1'));
    await page.goto(BASE);
    await page.waitForSelector('#menu .menu-item', { timeout: 10000 });
    const grupos = await page.$$eval('.menu-grupo h4', hs => hs.map(h => h.textContent));
    ok(grupos.includes('En la app actual') && grupos.includes('Sistema'), `menú por grupos (${grupos.join(', ')})`);
    await page.waitForFunction(() => document.querySelector('#bal-trabajos .baldosa-valor')?.textContent === '7');
    ok(true, 'baldosa Trabajos con número del espejo (7)');
    ok(await page.getAttribute('#bal-tareas', 'data-tono') === 'bien', 'baldosa a 0 → tono bien');
    ok(await page.getAttribute('#bal-trabajos', 'href') === '#/trabajos' && await page.getAttribute('#bal-tareas', 'href') === 'https://okcomputertenerife.web.app',
      'Trabajos es pantalla del hub; Tareas sigue enlazando a la app actual');
    await page.waitForFunction(() => document.querySelector('#bal-datos')?.dataset.tono === 'bien');
    ok(true, 'baldosa Datos: sync reciente → bien');
    await page.screenshot({ path: `${CAPTURAS}/inicio.png`, fullPage: true });

    await page.goto(`${BASE}/#/datos`);
    await page.waitForSelector('text=Sincronización con la app actual');
    ok((await page.textContent('#pantalla-explicacion')).length > 40, 'Datos lleva párrafo explicativo');
    ok(await page.isVisible('text=Faltan APP_SUPABASE_URL'), 'Datos enseña el error de la pasada completa');
    ok(await page.isVisible('text=clientes (120)'), 'Datos enseña las filas por tabla');
    await page.click('[data-action="datosSincronizar"][data-p0="incremental"]');
    await page.waitForFunction(() => document.getElementById('toast')?.textContent?.includes('3 filas'));
    const f = reg.funciones.filter(x => x.url.endsWith('/sync-app')).at(-1);
    ok(f?.url.endsWith('/sync-app') && f.body?.modo === 'incremental' && /^Bearer .+\..+\./.test(f.auth ?? ''),
      'Sincronizar ahora → sync-app con la sesión del usuario');
    await page.screenshot({ path: `${CAPTURAS}/datos.png`, fullPage: true });

    await page.keyboard.press('Control+k');
    await page.waitForSelector('#buscador[open]');
    await page.fill('#bus-campo', 'sincron');
    const res = await page.$$eval('#bus-resultados a', as => as.map(a => a.textContent.trim()));
    ok(res.length === 1 && res[0].includes('Datos y sincronización'), 'buscador filtra por nombre y explicación');
    await page.keyboard.press('Escape');

    await page.click('#tema-btn');
    const tema = await page.evaluate(() => document.documentElement.dataset.theme);
    ok(tema === 'dark' || tema === 'light', `tema cambia (${tema})`);

    ok(reg.rest.length > 0 && reg.rest.every(r => r.perfil === 'hub'), `todas las peticiones REST con Accept-Profile: hub (${reg.rest.length})`);
    const inline = await page.evaluate(() => [...document.querySelectorAll('*')].filter(e => [...e.attributes].some(a => /^on[a-z]+$/.test(a.name))).length);
    ok(inline === 0, 'ningún on*= inline en el DOM');
    ok(errores.length === 0, `sin errores JS${errores.length ? ': ' + errores.join(' | ') : ''}`);
    await ctx.close();
  }

  // 4. Móvil
  {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await preparar(ctx, { email: 'admin@ok.test' });
    const page = await ctx.newPage();
    await page.addInitScript(() => localStorage.setItem('hub_tour_visto', '1'));
    await page.goto(BASE);
    await page.waitForSelector('.baldosa');
    const ancho = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    ok(ancho[0] <= ancho[1], `móvil sin scroll horizontal (${ancho[0]} ≤ ${ancho[1]})`);
    ok(!(await page.isVisible('#menu .menu-item')), 'móvil: menú plegado');
    await page.click('[data-action="alternarMenu"]');
    await page.waitForTimeout(300);
    ok(await page.isVisible('#menu .menu-item'), 'móvil: ☰ abre el menú');
    await page.screenshot({ path: `${CAPTURAS}/movil-menu.png` });
    await ctx.close();
  }

  // 5. Tour la primera vez
  {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    await preparar(ctx, { email: 'admin@ok.test' });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForSelector('#tour', { timeout: 5000 });
    ok(true, 'el tour sale la primera vez');
    for (let i = 0; i < 6 && await page.isVisible('#tour'); i++) await page.click('[data-action="tourSiguiente"]');
    ok(await page.evaluate(() => localStorage.getItem('hub_tour_visto')) === '1', 'el tour queda visto al acabar');
    await ctx.close();
  }
} catch (e) {
  console.error('✗ excepción:', e);
  fallos++;
} finally {
  await browser.close();
  srv.kill();
}
console.log(fallos ? `\n${fallos} fallo(s)` : '\nTodo bien');
process.exit(fallos ? 1 : 0);
