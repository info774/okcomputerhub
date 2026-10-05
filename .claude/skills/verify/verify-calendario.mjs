// Arnés del calendario planificador (paridad bloque 1, tanda 2): vistas
// (Semana, Día por técnico, Por técnico, Agenda, Mes), carga del día, solapes,
// traslados, panel de pendientes, «Sugerir hueco» y planificar, arrastrar en la
// Semana y en la rejilla del Día (cambia de técnico), filtros guardados.
// Sin corte: todo se ve y nada se arrastra ni se planifica.
//   npm run build && node .claude/skills/verify/verify-calendario.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS } from './comun.mjs';

const { ok, fallos } = contador();
const srv = await servidor(4195);
// Un martes de la semana que viene: fijo para que la prueba no dependa del día.
const lunesProx = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 7); return d; })();
const D = new Date(lunesProx.getTime() + 86400000).toLocaleDateString('sv-SE');
const at = h => new Date(`${D}T${h}:00`).toISOString();
const C1 = 'c1111111-1111-1111-1111-111111111111', L1 = 'l1111111-1111-1111-1111-111111111111', L2 = 'l2222222-2222-2222-2222-222222222222';
const base0 = cortado => ({
  usuarios: [{ id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true }, { id: 'u-tito', nombre: 'Tito Pérez', email: 'tito@ok.test', rol: 'tecnico', activo: true }],
  areas: [{ area: 'trabajos', dueno: cortado ? 'hub' : 'app', tablas: ['trabajos', 'agenda', 'sesiones', 'documento_lineas', 'trabajo_comentarios', 'trabajo_fotos'] }],
  sync_estado: [], proyectos: [],
  clientes: [{ id: C1, nombre: 'Hotel Playa SL', activo: true }],
  // Adeje y La Laguna: ~90 km → el segundo bloque llega tarde.
  locales: [{ id: L1, cliente_id: C1, nombre: 'Hotel Playa', lat: 28.12, lng: -16.73, activo: true }, { id: L2, cliente_id: C1, nombre: 'Oficina Laguna', lat: 28.49, lng: -16.31, activo: true }],
  trabajos: [
    { id: 't1', numero: 151, titulo: 'Cambiar router', cliente_id: C1, local_id: L1, estado: 'Pendiente', fecha_programada: D, duracion_teorica: 60, tecnicos: ['Tito Pérez'], prioridad: 'Media' },
    { id: 't2', numero: 152, titulo: 'Revisar servidor', cliente_id: C1, local_id: L2, estado: 'Pendiente', fecha_programada: D, duracion_teorica: 60, tecnicos: ['Tito Pérez'], prioridad: 'Media' },
    { id: 't3', numero: 153, titulo: 'Cámaras', cliente_id: C1, local_id: L1, estado: 'Pendiente', fecha_programada: D, duracion_teorica: 60, tecnicos: ['Tito Pérez'], prioridad: null },
    { id: 't4', numero: 160, titulo: 'Instalar TPV', cliente_id: C1, local_id: L1, estado: 'Pendiente', fecha_programada: null, duracion_teorica: 90, tecnicos: null, prioridad: 'Urgente' },
  ],
  agenda: [
    { id: 'ag1', trabajo_id: 't1', titulo: null, inicio: at('09:00'), fin: at('10:00'), tecnicos: ['Tito Pérez'], estado: null, todo_el_dia: false },
    { id: 'ag2', trabajo_id: 't2', titulo: null, inicio: at('10:15'), fin: at('11:15'), tecnicos: ['Tito Pérez'], estado: null, todo_el_dia: false },
    { id: 'ag3', trabajo_id: 't3', titulo: null, inicio: at('10:30'), fin: at('11:30'), tecnicos: ['Tito'], estado: null, todo_el_dia: false },
  ],
  sesiones: [], tareas: [], tickets: [],
});
const RPC = { agenda_mover: (b, db) => { Object.assign(db.agenda.find(a => a.id === b.p_id), { inicio: b.p_inicio, fin: b.p_fin, ...(b.p_tecnicos ? { tecnicos: b.p_tecnicos } : {}) }); return null; } };

async function contexto(browser, cortado, viewport = { width: 1400, height: 950 }) {
  const base = baseMemoria(base0(cortado), RPC);
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport });
  await preparar(ctx, { email: 'ana@ok.test', base });
  await ctx.addInitScript(d => { if (!localStorage.getItem('hub_ca_fecha')) localStorage.setItem('hub_ca_fecha', d); }, D);
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
  page.on('dialog', d => d.accept(d.type() === 'prompt' ? 'Solo Tito' : undefined));
  return { ctx, page, base, errores };
}
const rpcs = (base, n) => base.reg.escrituras.filter(e => e.metodo === 'RPC' && e.tabla === n);
const parches = base => base.reg.escrituras.filter(e => e.metodo === 'PATCH' && e.tabla === 'trabajos');

const browser = await navegador();
try {
  // ── Sin corte ───────────────────────────────────────────────────────────
  const A = await contexto(browser, false);
  await A.page.goto(`${srv.base}/#/calendario`);
  await A.page.waitForSelector('.ca-semana .ca-bloque');
  ok(await A.page.locator('.ca-bloque[draggable="true"]').count() === 0 && await A.page.locator('.ca-pend[draggable="true"]').count() === 0, 'sin corte: nada se arrastra');
  await A.page.click('.ca-pend [data-action="caSugerir"]');
  await A.page.waitForSelector('.ca-hueco-banner');
  ok(await A.page.locator('[data-action="caPlanificar"]').count() === 0 && (await A.page.textContent('.ca-hueco-banner')).includes('en la app'), 'sin corte: el hueco se enseña pero se planifica en la app');
  ok(await A.page.locator('a[href="#/calendario/cita"]').count() === 0, 'sin corte: sin «+ Cita»');
  ok(A.errores.length === 0, `sin corte: sin errores${A.errores.length ? ': ' + A.errores.join(' | ') : ''}`);
  await A.ctx.close();

  // ── Con corte ───────────────────────────────────────────────────────────
  const B = await contexto(browser, true);
  const { page, base } = B;
  await page.goto(`${srv.base}/#/calendario`);
  await page.waitForSelector('.ca-semana .ca-bloque[draggable="true"]');
  ok(await page.locator(`.ca-dia[data-dia="${D}"] .ca-bloque`).count() === 3, 'semana: los tres bloques en su día');
  ok((await page.textContent(`.ca-dia[data-dia="${D}"] .ca-carga`)).includes('3h de 16h'), 'carga del día: 3 h de 2 técnicos × 8 h');
  ok(await page.locator('.ca-bloque.ca-solapa').count() === 2 && (await page.textContent('.ca-barra')).includes('1 solape'), 'solapes: «Tito» y «Tito Pérez» a la misma hora se marcan (nombre de pila)');
  const tras = await page.textContent('#ca-b-ag2');
  ok(/\d+ min desde Hotel Playa/.test(tras) && tras.includes('tarde') && await page.locator('#ca-b-ag2 .ca-ag-txt small svg.ico').count() === 1, 'traslados: de Adeje a La Laguna en 15 min llega tarde');
  ok((await page.textContent('#ca-b-ag1')).includes('desde la oficina'), 'traslados: el primero del día sale de la oficina');

  // Pendientes y «Sugerir hueco»
  ok((await page.textContent('.ca-pendientes')).includes('Urgente · 1') && await page.locator('.ca-pend').count() === 1, 'pendientes: el urgente sin fecha, agrupado');
  await page.click('.ca-pend [data-action="caSugerir"]');
  await page.waitForSelector('.ca-hueco-banner');
  ok(await page.isVisible('.ca-rejilla') && await page.isVisible('.ca-hueco'), 'sugerir hueco: salta a la vista Día con el hueco marcado');
  const banner = await page.textContent('.ca-hueco-banner');
  ok(banner.includes('#160') && /\d{2}:\d{2}–\d{2}:\d{2}/.test(banner), 'sugerir hueco: dice para qué, cuándo y quién');
  await page.click('[data-action="caOtroHueco"]');
  await page.waitForFunction(b => document.querySelector('.ca-hueco-banner')?.textContent !== b, banner);
  ok(true, 'otro hueco: propone otro');
  await page.click('[data-action="caPlanificar"]');
  await page.waitForFunction(() => !document.querySelector('.ca-hueco-banner'));
  const pl = parches(base).at(-1);
  ok(pl?.cuerpo.fecha_programada && pl?.cuerpo.hora_llegada && pl?.url?.includes('id=eq.t4'), 'planificar: escribe la fecha y la hora en el trabajo (el bloque lo crea la base)');

  // Rejilla del Día: soltar en otra columna cambia de técnico
  await page.evaluate(d => { localStorage.setItem('hub_ca_fecha', d); localStorage.setItem('hub_ca_vista', 'dia'); }, D);
  await page.reload();
  await page.waitForSelector('.ca-rejilla .ca-bloque[data-id="ag1"]');
  ok(await page.locator('.ca-col').count() === 3, 'día: una columna por técnico y «Sin asignar»');
  const n0 = rpcs(base, 'agenda_mover').length;
  await page.dragAndDrop('.ca-rejilla .ca-bloque[data-id="ag1"] strong', '.ca-col-cuerpo[data-tecnico="Ana Admin"]', { targetPosition: { x: 20, y: 48 * 7 + 5 } });
  await page.waitForTimeout(400);
  const mv = rpcs(base, 'agenda_mover').slice(n0)[0]?.cuerpo;
  ok(mv?.p_tecnicos?.[0] === 'Ana Admin' && new Date(mv.p_inicio).getHours() === 14, 'día: soltar en la columna de otro técnico lo reasigna y a esa hora (14:00)');
  await page.screenshot({ path: `${CAPTURAS}/calendario-dia.png`, fullPage: true });

  // Semana: soltar un bloque en otro día conserva las horas
  await page.click('[data-action="caVista"][data-p0="semana"]');
  await page.waitForSelector('.ca-semana');
  const otro = new Date(lunesProx.getTime() + 2 * 86400000).toLocaleDateString('sv-SE');
  const n1 = rpcs(base, 'agenda_mover').length;
  await page.dragAndDrop('.ca-semana .ca-bloque[data-id="ag2"] strong', `.ca-dia[data-dia="${otro}"]`);
  await page.waitForTimeout(400);
  const mv2 = rpcs(base, 'agenda_mover').slice(n1)[0]?.cuerpo;
  ok(mv2 && new Date(mv2.p_inicio).toLocaleDateString('sv-SE') === otro && new Date(mv2.p_inicio).getHours() === 10 && !mv2.p_tecnicos, 'semana: arrastrar a otro día conserva las horas y el técnico');

  // Otras vistas
  await page.click('[data-action="caVista"][data-p0="tecnicos"]');
  await page.waitForSelector('.ca-tabla');
  ok(await page.locator('.ca-tabla tbody tr').count() === 3, 'por técnico: una fila por técnico y «Sin asignar»');
  await page.click('[data-action="caVista"][data-p0="agenda"]');
  await page.waitForSelector('.ca-agenda li');
  ok(await page.locator('.ca-agenda a[href*="google.com/maps"]').count() >= 1, 'agenda: con «Cómo llegar»');
  await page.click('[data-action="caVista"][data-p0="mes"]');
  await page.waitForSelector('.ca-mes');
  ok(await page.locator('.ca-mes-dia').count() === 42, 'mes: 6 semanas');

  // Filtro y filtros guardados
  await page.click('[data-action="caVista"][data-p0="semana"]');
  await page.waitForSelector('.ca-semana');
  await page.selectOption('#ca-filtro', 'Ana Admin');
  await page.waitForFunction(() => document.querySelectorAll('.ca-semana .ca-bloque').length === 1);
  ok(true, 'filtro por técnico');
  await page.click('[data-action="caGuardarFiltro"]');
  await page.waitForFunction(() => [...document.querySelectorAll('#ca-guardados option')].some(o => o.textContent === 'Solo Tito'));
  await page.selectOption('#ca-filtro', 'todo');
  await page.waitForFunction(() => document.querySelectorAll('.ca-semana .ca-bloque').length === 3);
  await page.selectOption('#ca-guardados', { label: 'Solo Tito' });
  await page.waitForFunction(() => document.querySelectorAll('.ca-semana .ca-bloque').length === 1);
  ok(true, 'filtro guardado con nombre y vuelto a aplicar');
  // Citas sueltas y días de un trabajo (mismo formulario)
  await page.click('a[href="#/calendario/cita"]');
  await page.waitForSelector('#cc-form');
  await page.fill('#cc-titulo', 'Reunión con proveedor');
  await page.fill('#cc-fecha', D);
  await page.fill('#cc-ini', '16:00');
  await page.fill('#cc-fin', '17:00');
  await page.check('#cc-form .tf-tecnicos input[value="Ana Admin"]');
  await page.click('#cc-form button[type=submit]');
  await page.waitForFunction(() => location.hash === '#/calendario');
  const cita = base.reg.escrituras.filter(e => e.metodo === 'POST' && e.tabla === 'agenda').at(-1)?.cuerpo;
  ok(cita?.titulo === 'Reunión con proveedor' && new Date(cita.inicio).getHours() === 16 && cita.tecnicos?.[0] === 'Ana Admin' && !cita.trabajo_id, 'cita suelta: con título, hora y quién');
  await page.goto(`${srv.base}/#/calendario/dia/t1`);
  await page.waitForSelector('#cc-form');
  ok(await page.locator('#cc-titulo').count() === 0, 'día de trabajo: sin título (es el del trabajo)');
  await page.fill('#cc-fecha', D);
  await page.click('#cc-form button[type=submit]');
  await page.waitForFunction(() => location.hash === '#/trabajos/151');
  ok(base.reg.escrituras.filter(e => e.metodo === 'POST' && e.tabla === 'agenda').at(-1)?.cuerpo?.trabajo_id === 't1', 'añadir día: el bloque va con su trabajo y vuelve a la ficha');
  await page.goto(`${srv.base}/#/calendario/dia/b:ag2`);
  await page.waitForSelector('[data-action="ccBorrar"]');
  await page.click('[data-action="ccBorrar"]');
  await page.waitForFunction(() => location.hash === '#/trabajos/152');
  ok(base.reg.escrituras.some(e => e.metodo === 'DELETE' && e.tabla === 'agenda' && e.url.includes('ag2')), 'quitar un día de la agenda');
  ok(await page.locator('[onclick],[ondrop],[ondragstart]').count() === 0, 'sin manejadores inline');
  ok(B.errores.length === 0, `sin errores${B.errores.length ? ': ' + B.errores.join(' | ') : ''}`);
  await B.ctx.close();

  // Móvil: arranca en Agenda y no desborda
  const M = await contexto(browser, true, { width: 390, height: 844 });
  await M.page.goto(`${srv.base}/#/calendario`);
  await M.page.waitForSelector('.ca-agenda li');
  const ancho = await M.page.evaluate(() => document.documentElement.scrollWidth);
  ok(ancho <= 390, `móvil: arranca en Agenda y sin desbordar (${ancho} px)`);
  await M.page.screenshot({ path: `${CAPTURAS}/calendario-movil.png`, fullPage: true });
  await M.ctx.close();
} finally {
  await browser.close();
  srv.parar();
}
process.exit(fallos() ? 1 : 0);
