// Arnés de la paridad de trabajos (bloque 1, tanda 1): alta Simple/Completa,
// editar, duplicar, continuación, kanban (arrastrar cambia el estado), Excel y
// «¿Para facturar?» al completar. Dos mundos:
//   · ANTES del corte: el alta lleva a la app y el formulario no deja guardar.
//   · DESPUÉS (áreas del hub en hub.areas): todo escribe.
//   npm run build && node .claude/skills/verify/verify-trabajos.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS } from './comun.mjs';

const { ok, fallos } = contador();
const srv = await servidor(4194);
const hoy = new Date().toLocaleDateString('sv-SE');
const iso = h => new Date(`${hoy}T${h}:00`).toISOString();
const C1 = 'c1111111-1111-1111-1111-111111111111', L1 = 'l1111111-1111-1111-1111-111111111111', L2 = 'l2222222-2222-2222-2222-222222222222';
const T1 = 'b1111111-1111-1111-1111-111111111111';
const base0 = cortado => ({
  usuarios: [{ id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true }, { id: 'u-tito', nombre: 'Tito Pérez', email: 'tito@ok.test', rol: 'tecnico', activo: true }],
  areas: [{ area: 'trabajos', dueno: cortado ? 'hub' : 'app', tablas: ['trabajos', 'agenda', 'sesiones', 'documento_lineas', 'trabajo_comentarios', 'trabajo_fotos'] }],
  sync_estado: [], proyectos: [],
  clientes: [{ id: C1, nombre: 'Hotel Playa SL', nif: 'B12345678', telefono: '612345678', email: null, activo: true }],
  locales: [{ id: L1, cliente_id: C1, nombre: 'Hotel Playa', direccion: 'Av. Adeje 1', activo: true }, { id: L2, cliente_id: C1, nombre: 'Hotel Playa Anexo', direccion: 'Av. Adeje 3', activo: true }],
  contactos: [{ id: 'k1', cliente_id: C1, nombre: 'Marta Recepción', activo: true, favorito: true }],
  presupuestos: [{ id: 'p1', numero: 77, titulo: 'Cámaras', cliente_id: C1, created_at: iso('07:00') }],
  trabajos: [{ id: T1, numero: 151, created_at: iso('08:00'), titulo: 'Cambiar router', tipo: 'Asistencia', descripcion: 'Router nuevo', estado: 'Pendiente', tecnicos: ['Tito Pérez'],
    cliente_id: C1, local_id: L1, contacto_id: null, fecha_programada: hoy, hora_llegada: iso('10:00'), prioridad: 'Media', duracion_teorica: 60, chain_root_id: null },
    { id: 'b2', numero: 150, created_at: iso('07:00'), titulo: 'Revisar alarma', tipo: 'Mantenimiento', descripcion: '', estado: 'En progreso', tecnicos: ['Ana Admin'], cliente_id: C1, local_id: null, fecha_programada: null }],
  agenda: [], sesiones: [{ id: 's1', entidad_tipo: 'trabajo', entidad_id: T1, inicio: iso('10:00'), fin: iso('11:00'), duracion_min: 60, tecnico_nombre: 'Tito Pérez' }],
  documento_lineas: [], trabajo_comentarios: [], trabajo_fotos: [], tickets: [],
});
const RPC = {
  trabajo_estado: (b, db) => {
    if (b.p_estado === 'Completado' && !db.sesiones.some(s => s.entidad_id === b.p_id && s.fin)) throw new Error('Para completarlo hace falta fichar el inicio y el fin');
    db.trabajos.find(t => t.id === b.p_id).estado = b.p_estado; return null;
  },
};

async function contexto(browser, cortado, viewport = { width: 1280, height: 900 }) {
  const base = baseMemoria(base0(cortado), RPC);
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport, acceptDownloads: true });
  await preparar(ctx, { email: 'ana@ok.test', base });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
  page.on('dialog', d => d.accept());
  return { ctx, page, base, errores };
}
const posts = (base, t) => base.reg.escrituras.filter(e => e.metodo === 'POST' && e.tabla === t);
const rpcs = (base, n) => base.reg.escrituras.filter(e => e.metodo === 'RPC' && e.tabla === n);

const browser = await navegador();
try {
  // ── Antes del corte ─────────────────────────────────────────────────────
  const A = await contexto(browser, false);
  await A.page.goto(`${srv.base}/#/trabajos`);
  await A.page.waitForSelector('#tr-lista');
  ok(await A.page.locator('a.btn[href="#/trabajos/nuevo"]').count() === 0, 'sin corte: no hay alta en el hub');
  ok((await A.page.textContent('.acciones')).includes('Nuevo trabajo en la app'), 'sin corte: el alta lleva a la app');
  await A.page.goto(`${srv.base}/#/trabajos/nuevo`);
  await A.page.waitForSelector('#tf-form');
  ok(await A.page.isDisabled('#tf-form button[type=submit]'), 'sin corte: el formulario no deja guardar');
  ok(await A.page.locator('.area-app').count() === 1, 'sin corte: lo avisa');
  await A.page.goto(`${srv.base}/#/trabajos/151`);
  await A.page.waitForSelector('.op-ficha');
  ok(await A.page.locator('[data-action="trDuplicar"]').count() === 0, 'sin corte: la ficha no deja duplicar');
  ok(A.errores.length === 0, `sin corte: sin errores${A.errores.length ? ': ' + A.errores.join(' | ') : ''}`);
  await A.ctx.close();

  // ── Después del corte ───────────────────────────────────────────────────
  const B = await contexto(browser, true);
  const { page, base } = B;
  await page.goto(`${srv.base}/#/trabajos`);
  await page.waitForSelector('a.btn[href="#/trabajos/nuevo"]');
  ok(true, 'con corte: botón «Nuevo trabajo»');

  // Alta en Simple
  await page.click('a.btn[href="#/trabajos/nuevo"]');
  await page.waitForSelector('#tf-form');
  await page.click('[data-action="tfModo"][data-p0="simple"]');
  ok(await page.isHidden('#tf-descripcion') && await page.isHidden('#tf-local'), 'Simple esconde descripción y sede');
  ok(await page.isVisible('#tf-titulo') && await page.isVisible('#tf-fecha') && await page.isVisible('.tf-tecnicos'), 'Simple deja título, fecha y técnicos');
  await page.fill('#tf-cliente-q', 'hotel');
  await page.waitForSelector('[data-action="tfElegirCliente"]');
  await page.click('[data-action="tfElegirCliente"]');
  await page.waitForFunction(() => document.querySelectorAll('#tf-local option').length === 3);
  await page.fill('#tf-titulo', 'Instalar cámaras');
  await page.selectOption('#tf-tipo', 'Instalación');
  await page.fill('#tf-fecha', hoy);
  await page.fill('#tf-hora', '09:30');
  await page.check('.tf-tecnicos input[value="Tito Pérez"]');
  await page.click('#tf-form button[type=submit]');
  await page.waitForSelector('.op-ficha');
  const alta = posts(base, 'trabajos').at(-1)?.cuerpo;
  ok(alta?.titulo === 'Instalar cámaras' && alta?.tipo === 'Instalación' && alta?.cliente_id === C1 && alta?.estado === 'Pendiente', 'alta: título, tipo, cliente y Pendiente');
  ok(alta?.fecha_programada === hoy && alta?.hora_llegada === iso('09:30') && alta?.tecnicos?.[0] === 'Tito Pérez', 'alta: fecha, hora (con su zona) y técnico');
  ok(!('descripcion' in (alta ?? {})) || alta.descripcion === null, 'alta en Simple: lo escondido va vacío');
  ok(page.url().endsWith('#/trabajos/101'), 'tras el alta abre la ficha del trabajo nuevo');

  // El modo elegido se recuerda; Completa enseña todo
  await page.goto(`${srv.base}/#/trabajos/nuevo`);
  await page.waitForSelector('#tf-form');
  ok(await page.getAttribute('#tf-form', 'data-modo') === 'simple', 'el modo elegido a mano se recuerda');
  await page.click('[data-action="tfModo"][data-p0="completa"]');
  ok(await page.isVisible('#tf-descripcion') && await page.isVisible('#tf-prioridad'), 'Completa enseña todos los campos');

  // Editar: cambiar a Completado → RPC + «¿Para facturar?»
  await page.goto(`${srv.base}/#/trabajos/151/editar`);
  await page.waitForSelector('#tf-form');
  ok(await page.inputValue('#tf-titulo') === 'Cambiar router' && await page.inputValue('#tf-hora') === '10:00', 'editar: el formulario viene relleno');
  ok(await page.inputValue('#tf-local') === L1, 'editar: con su sede');
  await page.fill('#tf-titulo', 'Cambiar router y AP');
  await page.selectOption('#tf-estado', 'Completado');
  await page.click('#tf-form button[type=submit]');
  await page.waitForSelector('.op-ficha');
  const parche = base.reg.escrituras.filter(e => e.metodo === 'PATCH' && e.tabla === 'trabajos').at(-1)?.cuerpo;
  ok(parche?.titulo === 'Cambiar router y AP' && !('estado' in parche), 'editar: el PATCH no lleva el estado');
  ok(rpcs(base, 'trabajo_estado').map(r => r.cuerpo.p_estado).join(',') === 'Completado,Para facturar', 'editar: estado por RPC y «Para facturar» aceptado');

  // Duplicar y continuación
  await page.goto(`${srv.base}/#/trabajos/150`);
  await page.waitForSelector('[data-action="trDuplicar"]', { state: 'attached' });
  await page.click('details.menu-mas > summary');
  await page.click('[data-action="trDuplicar"]');
  await page.waitForFunction(() => location.hash !== '#/trabajos/150');
  const dup = posts(base, 'trabajos').at(-1)?.cuerpo;
  ok(dup?.titulo === 'Revisar alarma (copia)' && dup?.estado === 'Pendiente' && !('fecha_programada' in dup), 'duplicar: copia en Pendiente y sin programar');
  await page.goto(`${srv.base}/#/trabajos/150`);
  await page.waitForSelector('[data-action="trContinuacion"]', { state: 'attached' });
  await page.click('details.menu-mas > summary');
  await page.click('[data-action="trContinuacion"]');
  await page.waitForFunction(() => location.hash !== '#/trabajos/150');
  const cont = posts(base, 'trabajos').at(-1)?.cuerpo;
  ok(cont?.parent_trabajo_id === 'b2' && cont?.chain_root_id === 'b2' && cont?.estado === 'Pendiente', 'continuación: misma cadena, en Pendiente');

  // Kanban: arrastrar cambia el estado
  await page.goto(`${srv.base}/#/trabajos`);
  await page.waitForSelector('[data-action="trVista"][data-p0="kanban"]');
  await page.click('[data-action="trVista"][data-p0="kanban"]');
  await page.waitForSelector('.tr-kanban');
  ok(await page.locator('.tr-kanban .pr-columna').count() >= 2, 'kanban: columnas por estado');
  const n0 = rpcs(base, 'trabajo_estado').length;
  await page.dragAndDrop('.tr-kanban .pr-tarjeta[data-p0="150"]', '.tr-kanban .pr-columna[data-estado="Pendiente"]');
  await page.waitForTimeout(300);
  const mov = rpcs(base, 'trabajo_estado').slice(n0)[0]?.cuerpo;
  ok(mov?.p_id === 'b2' && mov?.p_estado === 'Pendiente', 'kanban: soltar en otra columna cambia el estado por RPC');
  await page.screenshot({ path: `${CAPTURAS}/trabajos-kanban.png` });

  // Excel
  const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="trExportar"]')]);
  const ruta = await descarga.path();
  const { readFileSync } = await import('node:fs');
  const csv = readFileSync(ruta, 'utf8');
  ok(csv.charCodeAt(0) === 0xFEFF && csv.includes('"Nº";"Título"') && csv.includes('Hotel Playa SL'), 'Excel: CSV con BOM, «;» y el nombre del cliente');

  // Móvil: arranca en Simple
  const M = await contexto(browser, true, { width: 390, height: 844 });
  await M.page.goto(`${srv.base}/#/trabajos/nuevo`);
  await M.page.waitForSelector('#tf-form');
  ok(await M.page.getAttribute('#tf-form', 'data-modo') === 'simple', 'móvil: el alta arranca en Simple');
  const ancho = await M.page.evaluate(() => document.documentElement.scrollWidth);
  ok(ancho <= 390, `móvil: sin desbordar (${ancho} px)`);
  await M.page.screenshot({ path: `${CAPTURAS}/trabajos-alta-movil.png`, fullPage: true });
  await M.ctx.close();

  ok(await page.locator('[onclick],[onchange],[oninput]').count() === 0, 'sin manejadores inline');
  ok(B.errores.length === 0, `sin errores${B.errores.length ? ': ' + B.errores.join(' | ') : ''}`);
} finally {
  await browser.close();
  srv.parar();
}
process.exit(fallos() ? 1 : 0);
