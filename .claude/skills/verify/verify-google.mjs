// Arnés de Google (paridad bloque 7, tanda 5): la capa de Google Calendar del
// calendario (SOLO LECTURA: Semana, Agenda y Día; «Google» la apaga y se
// recuerda; sin el permiso, la nota que lo dice), «Drive» en las fichas de
// cliente y sede (abre la carpeta que da la función) y, con el área de
// clientes del hub, guardar el cliente en Google Contactos al editarlo. La
// función `google` SIMULADA. Sin datos reales.
//   npm run build && node .claude/skills/verify/verify-google.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS, SB } from './comun.mjs';

const { ok, fallos } = contador();
const srv = await servidor(4205);
const lunes = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 7); return d; })();
const D = new Date(lunes.getTime() + 86400000).toLocaleDateString('sv-SE');
const C1 = 'c1111111-1111-1111-1111-111111111111', L1 = 'l1111111-1111-1111-1111-111111111111';
const FIX = areas => ({
  usuarios: [{ id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true }],
  areas, sync_estado: [], proyectos: [], config: [],
  clientes: [{ id: C1, nombre: 'Hotel Playa SL', tipo: 'empresa', nif: 'B123', activo: true, estado: 'activo', plan: 'Sin mantenimiento' }],
  locales: [{ id: L1, cliente_id: C1, nombre: 'Hotel Playa', activo: true }],
  contactos: [], trabajos: [], tickets: [], presupuestos: [], agenda: [], sesiones: [], tareas: [], oportunidades: [], actividades: [], clientes_crm: [],
  rmm_estado_local: [], local_telefonos: [], local_hardware: [], local_software: [], local_camaras: [],
});
const EVENTOS = [
  { id: 'info@:e1', calendario: 'Empresa', titulo: 'Reunión con <b>Ingram</b>', ubicacion: 'Oficina', inicio: `${D}T10:00:00+01:00`, fin: `${D}T11:00:00+01:00`, todoDia: false, enlace: 'https://calendar.google.com/x' },
  { id: 'info@:e2', calendario: 'Empresa', titulo: 'Feria', ubicacion: '', inicio: `${D}T00:00:00`, fin: `${new Date(lunes.getTime() + 2 * 86400000).toLocaleDateString('sv-SE')}T00:00:00`, todoDia: true, enlace: 'https://calendar.google.com/y' },
];

async function contexto(browser, areas, respuesta) {
  const base = baseMemoria(FIX(areas), {});
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1400, height: 950 } });
  await preparar(ctx, { email: 'ana@ok.test', base });
  await ctx.addInitScript(d => { if (!localStorage.getItem('hub_ca_fecha')) localStorage.setItem('hub_ca_fecha', d); }, D);
  const fn = [];
  await ctx.route(`${SB}/functions/v1/google`, route => {
    const b = route.request().postDataJSON();
    fn.push(b);
    const r = b.accion === 'calendario' ? respuesta : b.accion === 'carpeta' ? { url: 'https://drive.google.com/drive/folders/abc123' } : { ok: true, google_contact_id: 'people/c1' };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r) });
  });
  await ctx.route('https://drive.google.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Drive</p>' }));
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e.stack ?? e)));
  return { ctx, page, base, fn, errores };
}

const browser = await navegador();
const errores = [];
try {
  // ── Calendario con eventos de Google ────────────────────────────────────
  let C = await contexto(browser, [], { eventos: EVENTOS });
  let { page, fn } = C;
  await page.goto(`${srv.base}/#/calendario`);
  await page.waitForSelector('.ca-semana');
  await page.waitForSelector(`.ca-dia[data-dia="${D}"] .ca-google`);
  const dia = await page.textContent(`.ca-dia[data-dia="${D}"]`);
  ok(dia.includes('Reunión con <b>Ingram</b>') && dia.includes('Todo el día') && dia.includes('Feria'), 'semana: los eventos de Google, escapados, con los de todo el día');
  ok(await page.getAttribute(`.ca-dia[data-dia="${D}"] .ca-google`, 'target') === '_blank' && await page.locator('.ca-google[draggable]').count() === 0, 'semana: solo lectura (se abren en Google, no se arrastran)');
  ok(fn[0]?.accion === 'calendario' && fn[0].desde && fn[0].hasta, 'la función google pide el rango que se ve');
  const siguiente = new Date(lunes.getTime() + 2 * 86400000).toLocaleDateString('sv-SE');
  ok(!(await page.textContent(`.ca-dia[data-dia="${siguiente}"]`)).includes('Feria'), 'todo el día: el fin de Google es exclusivo (no sale al día siguiente)');
  await page.click('[data-action="caVista"][data-p0="agenda"]');
  await page.waitForSelector('.ca-agenda-dia .ca-google');
  ok((await page.textContent('.ca-agenda-dia .ca-google-dia')).includes('Ingram'), 'agenda: también');
  await page.screenshot({ path: `${CAPTURAS}/google-calendario.png` });
  await page.uncheck('#ca-google');
  await page.waitForFunction(() => !document.querySelector('.ca-google'));
  ok(await page.evaluate(() => localStorage.getItem('hub_ca_google')) === '0', 'la casilla «Google» la apaga y se recuerda');
  errores.push(...C.errores);
  await C.ctx.close();

  // ── Sin el permiso de Google ────────────────────────────────────────────
  C = await contexto(browser, [], { eventos: [], error: 'falta_permiso', mensaje: 'Falta dar al hub el permiso de leer Google Calendar (docs/PENDIENTE_FRAN.md §2 ter).' });
  ({ page } = C);
  await page.goto(`${srv.base}/#/calendario`);
  await page.waitForSelector('.ca-google-nota');
  ok((await page.textContent('.ca-google-nota')).includes('permiso de leer Google Calendar'), 'sin el permiso: lo dice (y el calendario sale igual)');
  errores.push(...C.errores);
  await C.ctx.close();

  // ── Drive y Contactos ───────────────────────────────────────────────────
  C = await contexto(browser, [], { eventos: [] });
  ({ page, fn } = C);
  await page.goto(`${srv.base}/#/clientes/${C1}`);
  await page.waitForSelector('[data-action="abrirDrive"][data-p0="cliente"]');
  const [pest] = await Promise.all([page.waitForEvent('popup'), page.click('[data-action="abrirDrive"][data-p0="cliente"]')]);
  await pest.waitForURL(/drive\.google\.com/).catch(() => null);
  ok(fn.some(f => f.accion === 'carpeta' && f.cliente_id === C1) && pest.url().includes('drive.google.com/drive/folders/abc123'), 'Drive: abre la carpeta del cliente que da la función');
  await pest.close();
  await page.goto(`${srv.base}/#/sitios/${L1}`);
  await page.waitForSelector('[data-action="abrirDrive"][data-p0="local"]');
  ok(true, 'Drive: también en la ficha de la sede');
  await page.goto(`${srv.base}/#/clientes/${C1}/editar`);
  await page.waitForSelector('#cf-form');
  await page.fill('#cf-telefono', '922000111');
  await page.click('#cf-form button[type="submit"]');
  await page.waitForFunction(() => document.getElementById('toast')?.textContent.includes('Cliente guardado'));
  await page.waitForTimeout(300);
  ok(fn.some(f => f.accion === 'contacto' && f.cliente_id === C1), 'Contactos: al guardar el cliente (área del hub) se manda a Google Contactos');
  errores.push(...C.errores);
  await C.ctx.close();

  ok(!errores.length, `sin errores JS${errores.length ? ': ' + errores.join(' | ') : ''}`);
} finally {
  await browser.close();
  srv.parar();
}
if (!fallos()) console.log('\nTodo bien');
process.exit(fallos() ? 1 : 0);
