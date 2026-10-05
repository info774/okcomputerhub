// Arnés del control de equipos (paridad bloque 7, tanda 4): la pestaña
// «Software obligatorio» de Monitorización (cifras, filtros incompletos / sin
// sede / todos / ignorados, marcas por programa, «sin conectar desde», IDs) y
// la sección de la sede; con el área de la app, solo lectura (sin «Comprobar
// ahora», botones apagados); con el área del hub, ignorar, asignar sede a mano y
// «Comprobar ahora» (función control-equipos SIMULADA). Sin datos reales.
//   npm run build && node .claude/skills/verify/verify-control-equipos.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS, SB } from './comun.mjs';

const { ok, fallos } = contador();
const srv = await servidor(4204);
const ahora = Date.now();
const iso = ms => new Date(ms).toISOString();
const L1 = '11111111-1111-1111-1111-111111111111';
const PC = (id, hostname, local_id, t, extra = {}) => ({ id, clave: hostname.toLowerCase(), hostname, local_id, local_manual: false, ignorar: false,
  tiene_action1: t[0], tiene_breeze: t[1], tiene_rustdesk: t[2], tiene_anydesk: t[3],
  faltan: ['action1', 'breeze', 'rustdesk', 'anydesk'].filter((_, i) => t[i] === false), rustdesk_id: null, anydesk_id: null,
  comprobado_at: iso(ahora - 3600e3), breeze_visto: null, action1_visto: null, ...extra });
const FIX = areas => ({
  usuarios: [{ id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true }],
  areas, sync_estado: [], config: [],
  locales: [{ id: L1, nombre: 'El Rebajón', activo: true }, { id: 'l2', nombre: 'Pizzería San Marco', activo: true }],
  rmm_equipos: [], rmm_alertas: [], rmm_estado_local: [], rmm_sites: [], rmm_sitios: [],
  equipos_control: [
    PC('e1', 'CAJA1', L1, [true, true, true, true], { rustdesk_id: '123 456 789', anydesk_id: '987654321' }),
    PC('e2', 'CAJA2', L1, [true, false, true, false], { breeze_visto: iso(ahora - 10 * 86400e3) }),
    PC('e3', 'PORTATIL-X', null, [true, null, null, null]),
    PC('e4', 'SERVIDOR', L1, [false, true, true, true], { ignorar: true }),
  ],
});
const APP = [{ area: 'equipos', tablas: ['equipos_control'], dueno: 'app' }];

const browser = await navegador();
const errores = [];
try {
  // ── Con el área de la app ──────────────────────────────────────────────
  let base = baseMemoria(FIX(APP), {});
  let ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
  await preparar(ctx, { email: 'ana@ok.test', base });
  let page = await ctx.newPage();
  page.on('pageerror', e => errores.push(String(e.stack ?? e)));
  await page.goto(`${srv.base}/#/monitorizacion/control`);
  await page.waitForSelector('#mce-tabla');
  const cifras = await page.textContent('.di-cifras');
  ok(cifras.includes('3') && cifras.includes('1 ignorado') && /Incompletos\s*1/.test(cifras.replace(/\s+/g, ' ')), 'cifras: controlados, ignorados e incompletos');
  const tabla = await page.textContent('#mce-tabla');
  ok(tabla.includes('CAJA2') && tabla.includes('falta Breeze, AnyDesk') && tabla.includes('sin conectar desde') && !tabla.includes('CAJA1'), 'incompletos: el PC con lo que le falta y desde cuándo no conecta Breeze');
  ok(await page.locator('[data-action="mceComprobar"]').count() === 0 && await page.isDisabled('[data-action="mceIgnorar"]') && await page.isVisible('.area-app'),
    'área de la app: solo lectura y sin «Comprobar ahora»');
  await page.click('[data-action="mceFiltro"][data-p0="todos"]');
  await page.waitForFunction(() => document.getElementById('mce-tabla')?.textContent.includes('CAJA1'));
  ok((await page.textContent('#mce-tabla')).includes('RD 123 456 789'), 'todos: con los IDs de RustDesk y AnyDesk');
  await page.goto(`${srv.base}/#/monitorizacion/sede/${L1}`);
  await page.waitForSelector('#mce-sede');
  ok((await page.textContent('#mce-sede')).includes('CAJA1') && (await page.textContent('#mce-sede')).includes('SERVIDOR'), 'sede: su sección de software obligatorio');
  await ctx.close();

  // ── Con el área del hub ─────────────────────────────────────────────────
  base = baseMemoria(FIX([]), {});
  ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
  await preparar(ctx, { email: 'ana@ok.test', base });
  const llamadas = [];
  await ctx.route(`${SB}/functions/v1/control-equipos`, route => { llamadas.push(1); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, equipos: 4, breeze: 'ok (3)', action1: 'Action1 sin configurar' }) }); });
  page = await ctx.newPage();
  page.on('pageerror', e => errores.push(String(e.stack ?? e)));
  await page.goto(`${srv.base}/#/monitorizacion/control`);
  await page.waitForSelector('#mce-tabla');
  await page.click('[data-action="mceIgnorar"][data-p0="e2"]');
  await page.waitForFunction(() => document.getElementById('toast')?.textContent.includes('ya no se controla'));
  ok(base.db.equipos_control.find(e => e.id === 'e2').ignorar === true, 'ignorar: el PC deja de controlarse');
  await page.click('[data-action="mceFiltro"][data-p0="sinsede"]');
  await page.waitForSelector('#mce-tabla select');
  await page.selectOption('#mce-tabla select', 'l2');
  await page.waitForFunction(() => document.getElementById('toast')?.textContent.includes('asignado'));
  const e3 = base.db.equipos_control.find(e => e.id === 'e3');
  ok(e3.local_id === 'l2' && e3.local_manual === true, 'sin sede: asignar a mano (y que la pasada no lo pise)');
  await page.click('[data-action="mceComprobar"]');
  await page.waitForFunction(() => document.getElementById('toast')?.textContent.includes('Comprobados 4 PCs'));
  ok(llamadas.length === 1, '«Comprobar ahora»: la función control-equipos del hub');
  await page.click('[data-action="mceFiltro"][data-p0="todos"]');
  await page.waitForFunction(() => document.getElementById('mce-tabla')?.textContent.includes('CAJA1'));
  await page.screenshot({ path: `${CAPTURAS}/control-equipos.png` });
  await ctx.close();

  ok(!errores.length, `sin errores JS${errores.length ? ': ' + errores.join(' | ') : ''}`);
} finally {
  await browser.close();
  srv.parar();
}
if (!fallos()) console.log('\nTodo bien');
process.exit(fallos() ? 1 : 0);
