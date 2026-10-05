// Arnés del planificador del Mapa (paridad bloque 8, tanda 2): panel Día
// (técnicos fichados, trabajos del día por fecha Y por bloque de agenda,
// tickets), técnico en el mapa al lado de su sede, globo de la sede con su
// trabajo; Semana con arrastrar y soltar (pendiente → día a las 9:00 con
// «Asignar al soltar», bloque → otro día por hub.agenda_mover SIMULADA, bloque
// → bandeja lo quita); Ruta (paradas, optimizar desde la oficina, enlace a
// Google Maps, línea en el mapa); y con las áreas de la app, solo lectura.
// Sin datos reales.
//   npm run build && node .claude/skills/verify/verify-mapa-planificador.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS } from './comun.mjs';

const { ok, fallos } = contador();
const srv = await servidor(4207);
const ymd = d => d.toLocaleDateString('sv-SE');
const hoy = ymd(new Date());
const at = (dia, h) => new Date(`${dia}T${String(h).padStart(2, '0')}:00:00`).toISOString();
const sumar = (dia, n) => { const d = new Date(`${dia}T12:00:00`); d.setDate(d.getDate() + n); return ymd(d); };
const dow = new Date(`${hoy}T12:00:00`).getDay();
const lunes = sumar(hoy, -((dow + 6) % 7));
const destino = dow === 0 ? lunes : sumar(lunes, 6);   // otro día de esta semana
const L1 = 'l1111111-1111-1111-1111-111111111111', L2 = 'l2222222-2222-2222-2222-222222222222', C1 = 'c1111111-1111-1111-1111-111111111111';
const FIX = areas => ({
  usuarios: [{ id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true }, { id: 'u-tito', nombre: 'Tito Pérez', email: 'tito@ok.test', rol: 'tecnico', activo: true }],
  areas, sync_estado: [], config: [], proyectos: [],
  clientes: [{ id: C1, nombre: 'Hotel Playa SL', activo: true, zoho_id: null }],
  locales: [{ id: L1, cliente_id: C1, nombre: 'Hotel Playa', lat: 28.08, lng: -16.73, direccion: 'Adeje', activo: true, estado_pago: null, plan: null },
            { id: L2, cliente_id: C1, nombre: 'Bar Puerto', lat: 28.41, lng: -16.55, direccion: 'Puerto de la Cruz', activo: true, estado_pago: null, plan: null }],
  rmm_estado_local: [], oportunidades: [], clientes_crm: [], actividades: [], zoho_facturas: [],
  trabajos: [
    { id: 'w1', numero: 151, titulo: 'Cambiar router', descripcion: null, estado: 'Pendiente', local_id: L1, cliente_id: C1, fecha_programada: hoy, hora_llegada: at(hoy, 10), tecnicos: ['Tito Pérez'], duracion_teorica: 60 },
    { id: 'w2', numero: 152, titulo: 'Cableado (día 2)', descripcion: null, estado: 'En progreso', local_id: L2, cliente_id: C1, fecha_programada: sumar(hoy, -1), hora_llegada: at(sumar(hoy, -1), 9), tecnicos: ['Ana Admin'], duracion_teorica: 240 },
    { id: 'w3', numero: 153, titulo: 'Revisar TPV', descripcion: null, estado: 'Pendiente', local_id: L2, cliente_id: C1, fecha_programada: null, hora_llegada: null, tecnicos: [], duracion_teorica: null, created_at: at(hoy, 8) },
  ],
  agenda: [
    { id: 'b1', trabajo_id: 'w1', tarea_id: null, ticket_id: null, tipo: 'trabajo', titulo: null, inicio: at(hoy, 10), fin: at(hoy, 11), todo_el_dia: false, tecnicos: ['Tito Pérez'] },
    { id: 'b2', trabajo_id: 'w2', tarea_id: null, ticket_id: null, tipo: 'trabajo', titulo: null, inicio: at(hoy, 12), fin: at(hoy, 14), todo_el_dia: false, tecnicos: ['Ana Admin'] },
  ],
  sesiones: [{ id: 's1', entidad_tipo: 'trabajo', entidad_id: 'w1', tecnico_id: 'u-tito', tecnico_nombre: 'Tito Pérez', traslado: null, inicio: new Date(Date.now() - 1800e3).toISOString(), fin: null,
    gps_lat: null, gps_lng: null, created_at: new Date(Date.now() - 1800e3).toISOString() }],
  tickets: [{ id: 't1', numero: 5001, titulo: 'No imprime', prioridad: 'Alta', estado: 'Abierto', local_id: L1, cliente_id: C1, created_at: at(hoy, 8) }],
  tareas: [],
});
const RPC = {
  agenda_mover: (c, db) => { const b = db.agenda.find(x => x.id === c.p_id); Object.assign(b, { inicio: c.p_inicio, fin: c.p_fin }, c.p_tecnicos ? { tecnicos: c.p_tecnicos } : {}); return null; },
};
const APP = [{ area: 'trabajos', tablas: ['trabajos', 'agenda', 'sesiones', 'documento_lineas'], dueno: 'app' }];

async function contexto(browser, areas) {
  const base = baseMemoria(FIX(areas), RPC);
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 950 } });
  await preparar(ctx, { email: 'ana@ok.test', base });
  await ctx.route('https://*.tile.openstreetmap.org/**', r => r.fulfill({ status: 200, contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') }));
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e.stack ?? e)));
  page.on('dialog', d => d.accept());
  return { ctx, page, base, errores };
}
// Arrastrar y soltar con eventos HTML5 de verdad (el arrastre del ratón de Playwright se pierde en el panel con scroll).
const arrastrar = (page, de, a) => page.evaluate(([de, a]) => {
  const dt = new DataTransfer(), src = document.querySelector(de), dst = document.querySelector(a);
  src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
  dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
  dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  src.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
}, [de, a]);
const toast = (page, txt) => page.waitForFunction(t => document.getElementById('toast')?.textContent.includes(t), txt);

const browser = await navegador();
const errores = [];
try {
  let C = await contexto(browser, []);
  let { page, base } = C;
  await page.goto(`${srv.base}/#/mapa`);
  await page.waitForSelector('#map-cuerpo');
  const dia = await page.textContent('#map-cuerpo');
  ok(dia.includes('Cambiar router') && dia.includes('Cableado (día 2)') && !dia.includes('Revisar TPV'), 'día: los trabajos por fecha Y por bloque de agenda (el día 2 de uno largo)');
  ok(dia.includes('Tito Pérez') && dia.includes('en sitio') && dia.includes('#5001'), 'día: técnico fichado y tickets abiertos');
  ok(await page.locator('.leaflet-marker-pane .map-tec').count() === 1, 'mapa: el técnico fichado al lado de su sede');
  await page.click('.map-fila[data-p0="' + L1 + '"] >> nth=1');
  await page.waitForSelector('.leaflet-popup-content');
  ok((await page.textContent('.leaflet-popup-content')).includes('Cambiar router') && (await page.textContent('.leaflet-popup-content')).includes('Cómo llegar'), 'globo de la sede: su trabajo del día, tickets y «Cómo llegar»');
  await page.screenshot({ path: `${CAPTURAS}/mapa-dia.png` });

  // Semana
  await page.click('[data-action="maPanel"][data-p0="semana"]');
  await page.waitForSelector('.map-sem');
  ok(await page.locator('.map-sem-fila').count() === 7 && await page.locator(`.map-sem-fila[data-dia="${hoy}"] .map-bloque`).count() === 2
    && (await page.textContent('.map-bandeja')).includes('Revisar TPV'), 'semana: siete días, los bloques de hoy y la bandeja «Sin planificar»');
  await page.click('[data-action="maAsignarA"][data-p0="Tito Pérez"]');
  await arrastrar(page, '[data-pend="w3"]', `.map-sem-fila[data-dia="${destino}"]`);
  await toast(page, 'Planificado');
  const w3 = base.db.trabajos.find(t => t.id === 'w3');
  ok(w3.fecha_programada === destino && new Date(w3.hora_llegada).getHours() === 9 && w3.duracion_teorica === 60 && w3.tecnicos.includes('Tito Pérez'),
    'semana: soltar un pendiente lo planifica a las 9:00, con el técnico de «Asignar al soltar»');
  await page.click('[data-action="maAsignarA"][data-p0="Tito Pérez"]');
  await arrastrar(page, '[data-bloque="b2"]', `.map-sem-fila[data-dia="${destino}"]`);
  await toast(page, 'Movido');
  const b2 = base.db.agenda.find(b => b.id === 'b2');
  ok(ymd(new Date(b2.inicio)) === destino && new Date(b2.inicio).getHours() === 12 && new Date(b2.fin) - new Date(b2.inicio) === 2 * 3600e3 && b2.tecnicos.join() === 'Ana Admin',
    'semana: soltar un bloque en otro día lo mueve con sus horas (hub.agenda_mover)');
  await arrastrar(page, '[data-bloque="b1"]', '.map-bandeja');
  await toast(page, 'Día quitado');
  ok(!base.db.agenda.some(b => b.id === 'b1'), 'semana: soltar un bloque en la bandeja le quita el día');
  await page.screenshot({ path: `${CAPTURAS}/mapa-semana.png` });

  // Ruta (de vuelta a hoy: w1 ya sin bloque sigue por su fecha; w2 se movió)
  await page.click('[data-action="maPanel"][data-p0="ruta"]');
  await page.waitForSelector('#map-total');
  ok((await page.textContent('#map-total')).includes('1 parada') && await page.locator('.leaflet-overlay-pane path').count() >= 1, 'ruta: paradas del día y la línea en el mapa');
  const enlace = await page.getAttribute('.map-total a', 'href');
  ok(enlace.includes('origin=28.093500,-16.756500') && enlace.includes('destination=28.080000,-16.730000'), 'ruta: Google Maps desde la oficina hasta la última parada');
  await page.check('#map-optimizar');
  await page.waitForFunction(() => document.getElementById('map-optimizar')?.checked);
  ok(true, 'ruta: optimizar el orden');
  errores.push(...C.errores);
  await C.ctx.close();

  // Con las áreas de la app: se ve, no se arrastra
  C = await contexto(browser, APP);
  ({ page } = C);
  await page.goto(`${srv.base}/#/mapa`);
  await page.waitForSelector('#map-cuerpo');
  await page.click('[data-action="maPanel"][data-p0="semana"]');
  await page.waitForSelector('.map-sem');
  ok(await page.isVisible('#map-panel .area-app') && await page.locator('#map-panel [draggable="true"]').count() === 0 && await page.locator('[data-action="maAsignarA"]').count() === 0,
    'área de la app: la semana se ve y no se arrastra');
  await page.click('[data-action="maPanel"][data-p0="dia"]');
  errores.push(...C.errores);
  await C.ctx.close();

  ok(!errores.length, `sin errores JS${errores.length ? ': ' + errores.join(' | ') : ''}`);
} finally {
  await browser.close();
  srv.parar();
}
if (!fallos()) console.log('\nTodo bien');
process.exit(fallos() ? 1 : 0);
