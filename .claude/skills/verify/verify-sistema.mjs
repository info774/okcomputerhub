// Arnés del bloque 6 (Sistema) de la paridad.
// Tanda 1: usuarios (solo lectura con el área de la app; con el corte, alta,
// rol y teléfono, activar/desactivar y nunca a uno mismo), registro de cambios
// (global con filtros, «Cargar más» por la fecha del último, de una ficha y el
// enlace «🕘 Historial» de las fichas, solo admin; la función `historial`
// SIMULADA) y el modo empleado (menú reducido del técnico y, en el móvil,
// entrada a «Hoy»). Sin datos reales.
//   npm run build && node .claude/skills/verify/verify-sistema.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS, SB } from './comun.mjs';

const { ok, fallos } = contador();
const srv = await servidor(4198);
const ahora = Date.now();
const iso = ms => new Date(ms).toISOString();

const USUARIOS = [
  { id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true, telefono: null },
  { id: 'u-tito', nombre: 'Tito Técnico', email: 'tito@ok.test', rol: 'tecnico', activo: true, telefono: '600111222' },
];
const inicial = areas => ({
  usuarios: USUARIOS, areas,
  clientes: [{ id: 'cl1', nombre: 'Bar Manolo', activo: true }],
  sesiones: [], trabajos: [], agenda: [], tareas: [], tickets: [],
});

const llamadas = [];
const HIST = [
  { id: 'h1', ts: iso(ahora - 3600e3), tabla: 'clientes', registro_id: 'cl1', accion: 'UPDATE', usuario_nombre: 'Ana Admin', usuario_email: 'ana@ok.test',
    cambios: { telefono: ['922000000', '922000001'] }, antes: null, despues: null, titulo: 'Bar Manolo', fuente: 'hub' },
  { id: 'h2', ts: iso(ahora - 7200e3), tabla: 'clientes', registro_id: 'cl1', accion: 'INSERT', usuario_nombre: 'Fran', usuario_email: null,
    cambios: null, antes: null, despues: { nombre: 'Bar Manolo', nif: 'B123' }, titulo: 'Bar Manolo', fuente: 'app' },
];
async function historialFalso(route) {
  const b = JSON.parse(route.request().postData() || '{}');
  llamadas.push(b);
  const filas = b.antes_de ? [{ ...HIST[1], id: 'h3', ts: iso(ahora - 9e6), titulo: 'Más antiguo' }] : HIST;
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ filas, mas: !b.antes_de, app_ok: true }) });
}

const browser = await navegador();
try {
  // ── Admin, con el área `usuarios` aún en la app ───────────────────────────
  let base = baseMemoria(inicial([{ area: 'usuarios', dueno: 'app', tablas: ['usuarios'] }]), {});
  let ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
  await preparar(ctx, { email: 'ana@ok.test', base });
  await ctx.route(`${SB}/functions/v1/historial`, historialFalso);
  let page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e.stack ?? e)));
  page.on('dialog', d => d.accept());
  await page.goto(`${srv.base}/#/usuarios`);
  await page.waitForSelector('.us-tabla');
  ok(await page.locator('#menu a[data-mod="usuarios"]').count() === 1 && await page.locator('#menu a[data-mod="registro"]').count() === 1, 'admin: Usuarios y Registro de cambios en el menú');
  ok(await page.locator('.us-tabla tbody tr').count() === 2 && (await page.textContent('.us-tabla')).includes('tú'), 'usuarios: la lista, con «tú»');
  ok(await page.isVisible('.area-app') && await page.isDisabled('#us-nombre') && await page.locator('[data-action="usActivo"]').count() === 0, 'usuarios: con el área de la app, solo lectura');
  await ctx.close();

  // ── Admin, con el área del hub ───────────────────────────────────────────
  base = baseMemoria(inicial([]), {});
  ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
  await preparar(ctx, { email: 'ana@ok.test', base });
  await ctx.route(`${SB}/functions/v1/historial`, historialFalso);
  page = await ctx.newPage();
  page.on('pageerror', e => errores.push(String(e.stack ?? e)));
  page.on('dialog', d => d.accept());
  await page.goto(`${srv.base}/#/usuarios`);
  await page.waitForSelector('.us-tabla');
  ok(await page.locator('[data-action="usActivo"]').count() === 1 && await page.isDisabled('#us-rol-u-ana'), 'usuarios: a uno mismo no se le desactiva ni se le cambia el rol');
  await page.fill('#us-nombre', 'Nuevo Técnico');
  await page.fill('#us-email', 'Nuevo@Ok.Test');
  await page.fill('#us-telefono', '+34 611 22 33 44');
  await page.click('#us-alta button[type="submit"]');
  await page.waitForFunction(() => document.querySelectorAll('.us-tabla tbody tr').length === 3);
  const nuevo = base.db.usuarios.find(u => u.nombre === 'Nuevo Técnico');
  ok(nuevo?.email === 'nuevo@ok.test' && nuevo?.rol === 'tecnico' && nuevo?.telefono === '+34 611 22 33 44' && nuevo?.activo === true, 'usuarios: alta con el correo en minúsculas, rol técnico y teléfono');
  await page.fill('#us-tel-u-tito', '600 999 888');
  await page.selectOption('#us-rol-u-tito', 'admin');
  await page.click('[data-action="usGuardar"][data-p0="u-tito"]');
  await page.waitForFunction(() => document.querySelector('#us-rol-u-tito')?.value === 'admin');
  ok(base.db.usuarios.find(u => u.id === 'u-tito')?.telefono === '600 999 888', 'usuarios: rol y teléfono guardados');
  await page.click('[data-action="usActivo"][data-p0="u-tito"]');
  await page.waitForFunction(() => document.querySelector('.us-tabla')?.textContent.includes('Desactivado'));
  ok(base.db.usuarios.find(u => u.id === 'u-tito')?.activo === false, 'usuarios: desactivar (no se borra)');

  // Registro global
  await page.goto(`${srv.base}/#/registro`);
  await page.waitForSelector('.rg-item');
  const rg = await page.textContent('#rg-lista');
  ok(await page.locator('.rg-item').count() === 2 && rg.includes('922000000') && rg.includes('Bar Manolo') && rg.includes('app') && rg.includes('hub'), 'registro: cambios del hub y de la app, con el antes y el después');
  await page.click('[data-action="rgMas"]');
  await page.waitForFunction(() => document.querySelectorAll('.rg-item').length === 3);
  ok(llamadas.at(-1)?.antes_de === HIST[1].ts && await page.isHidden('#rg-mas'), 'registro: «Cargar más» desde la fecha del último');
  await page.selectOption('#rg-tabla', 'clientes');
  await page.waitForFunction(() => document.querySelectorAll('.rg-item').length === 2);
  ok(llamadas.at(-1)?.tabla === 'clientes', 'registro: filtrar por tabla');

  // Historial de una ficha
  await page.goto(`${srv.base}/#/clientes/cl1`);
  await page.waitForSelector('a[href="#/registro/clientes/cl1"]');
  await page.click('a[href="#/registro/clientes/cl1"]');
  await page.waitForSelector('.rg-item');
  ok(llamadas.at(-1)?.tabla === 'clientes' && llamadas.at(-1)?.registro_id === 'cl1' && await page.locator('#rg-tabla').count() === 0, 'ficha: «🕘 Historial» abre el de esa ficha, sin filtros');
  await page.screenshot({ path: `${CAPTURAS}/sistema-registro.png`, fullPage: true });
  await ctx.close();

  // ── Técnico: modo empleado ───────────────────────────────────────────────
  base = baseMemoria(inicial([]), {});
  ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, isMobile: true });
  await preparar(ctx, { email: 'tito@ok.test', base });
  page = await ctx.newPage();
  page.on('pageerror', e => errores.push(String(e.stack ?? e)));
  await page.goto(`${srv.base}/`);
  await page.waitForFunction(() => location.hash === '#/hoy');
  ok(true, 'técnico en el móvil: entra a «Hoy»');
  const mods = await page.$$eval('#menu a.menu-item', as => as.map(a => a.dataset.mod));
  ok(['trabajos', 'calendario', 'lista-dia', 'sitios', 'personas', 'comandas'].every(m => mods.includes(m)), 'modo empleado: Trabajos, Calendario, Lista del día, Sitios, Personas y Comandas en el menú');
  ok(!['clientes', 'direccion', 'oportunidades', 'cobros', 'usuarios', 'registro', 'facturacion'].some(m => mods.includes(m)), 'modo empleado: sin Clientes, Dirección, Oportunidades, Cobros, Usuarios, Registro ni Facturación');
  await page.goto(`${srv.base}/#/clientes/cl1`);
  await page.waitForSelector('.tarjeta-cab');
  ok(await page.locator('a[href^="#/registro/"]').count() === 0, 'técnico: sin «🕘 Historial» en las fichas');

  ok(!errores.length, `sin errores JS${errores.length ? ': ' + errores.join(' | ') : ''}`);
} finally {
  await browser.close();
  srv.parar();
}
if (!fallos()) console.log('\nTodo bien');
process.exit(fallos() ? 1 : 0);
