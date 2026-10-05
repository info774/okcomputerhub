// Arnés de los tickets completos (paridad bloque 8, tanda 1): en la ficha del
// ticket, las tareas (crear con el área de tareas del hub; con la de la app,
// solo verlas), duplicar, «Crear trabajo desde el ticket» (el ticket queda
// enlazado y cerrado; con el área de trabajos de la app no sale) y guardar la
// resolución en la wiki (una página por ticket bajo «Resoluciones»); y en
// Monitorización, «Abrir ticket» desde una alerta de Breeze (uno por alerta).
// Sin datos reales.
//   npm run build && node .claude/skills/verify/verify-tickets-completos.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS, SB } from './comun.mjs';

const { ok, fallos } = contador();
const srv = await servidor(4206);
const ahora = Date.now();
const iso = ms => new Date(ms).toISOString();
const C1 = 'c1111111-1111-1111-1111-111111111111', L1 = 'l1111111-1111-1111-1111-111111111111';
const T1 = 'f1111111-1111-1111-1111-111111111111', T2 = 'f2222222-2222-2222-2222-222222222222';
const A1 = 'a1111111-1111-1111-1111-111111111111', D1 = 'd1111111-1111-1111-1111-111111111111';
const tk = (id, numero, extra) => ({ id, numero, created_at: iso(ahora - 3 * 3600e3), updated_at: null, cliente_id: C1, local_id: L1, contacto_id: null, trabajo_id: null,
  descripcion: 'No imprime la de cocina', estado: 'Abierto', prioridad: 'Alta', tecnico_id: 'Tito', resolucion: null, resolucion_categoria: null, via_contacto: 'Teléfono', canal: 'telefono',
  email_hilo: null, email_de: null, sla_respuesta_at: null, sla_resolucion_at: null, primera_respuesta_at: null, cerrado_at: null, valoracion: null,
  valoracion_comentario: null, valoracion_at: null, valoracion_token: '99999999-9999-4999-8999-999999999999', etiquetas: [], rmm_alerta_id: null, ...extra });
const FIX = areas => ({
  usuarios: [{ id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true }, { id: 'u-tito', nombre: 'Tito', email: 'tito@ok.test', rol: 'tecnico', activo: true }],
  areas, sync_estado: [], proyectos: [], config: [], plantillas_respuesta: [], ticket_comentarios: [], ticket_adjuntos: [], paginas: [],
  clientes: [{ id: C1, nombre: 'Hotel Playa SL', activo: true }],
  locales: [{ id: L1, cliente_id: C1, nombre: 'Hotel Playa', activo: true }],
  contactos: [], trabajos: [], presupuestos: [], agenda: [], sesiones: [], plantillas_trabajo: [],
  tareas: [{ id: 'ta1', titulo: 'Pedir tóner', estado: 'pendiente', tecnico_id: 'Tito', notas: null, ticket_id: T1, created_at: iso(ahora - 3600e3) }],
  tickets: [tk(T1, 50, { titulo: 'Impresora cocina' }), tk(T2, 51, { titulo: 'Sin internet' })],
  rmm_equipos: [{ id: D1, hostname: 'CAJA1', nombre: 'CAJA1', local_id: L1, conectado: true }], rmm_estado_local: [], rmm_sites: [], rmm_sitios: [],
  rmm_alertas: [{ id: A1, device_id: D1, hostname: 'CAJA1', local_id: L1, sitio: 'Hotel Playa', estado: 'active', severidad: 'critical',
    titulo: 'Disco C casi lleno', mensaje: 'Queda un 3 %', disparada: iso(ahora - 1800e3), acusada: null, acusada_por: null, resuelta: null, nota_resolucion: null }],
});
const APP = [{ area: 'tareas', tablas: ['tareas'], dueno: 'app' }, { area: 'trabajos', tablas: ['trabajos', 'agenda', 'sesiones', 'documento_lineas'], dueno: 'app' }];

async function contexto(browser, areas) {
  const base = baseMemoria(FIX(areas), {});
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1400, height: 950 } });
  await preparar(ctx, { email: 'ana@ok.test', base });
  const fn = [];
  await ctx.route(`${SB}/functions/v1/**`, route => {
    fn.push({ nombre: new URL(route.request().url()).pathname.split('/').pop(), ...(route.request().postDataJSON() ?? {}) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e.stack ?? e)));
  return { ctx, page, base, fn, errores };
}
const toast = (page, txt) => page.waitForFunction(t => document.getElementById('toast')?.textContent.includes(t), txt);

const browser = await navegador();
const errores = [];
try {
  // ── Con las áreas del hub ───────────────────────────────────────────────
  let C = await contexto(browser, []);
  let { page, base, fn } = C;
  await page.goto(`${srv.base}/#/tickets/50`);
  await page.waitForSelector('#tkx-tareas');
  ok((await page.textContent('#tkx-tareas')).includes('Pedir tóner'), 'tareas: las del ticket salen en su ficha');
  await page.click('#tkx-tareas summary');
  await page.fill('#tkx-titulo', 'Llamar al proveedor');
  await page.selectOption('#tkx-tecnico', 'Tito');
  await page.click('#tkx-tareas button[type="submit"]');
  await toast(page, 'Tarea creada');
  const nueva = base.db.tareas.find(t => t.titulo === 'Llamar al proveedor');
  ok(nueva?.ticket_id === T1 && nueva.tecnico_id === 'Tito' && nueva.estado === 'pendiente' && /^[0-9a-f-]{36}$/.test(nueva.id), 'tareas: crear una tarea del ticket (con su id, para la cola sin red)');

  await page.click('[data-action="tkxDuplicar"]');
  await toast(page, 'Ticket duplicado');
  const copia = base.db.tickets.find(t => t.titulo === 'Impresora cocina (copia)');
  ok(copia && copia.estado === 'Abierto' && copia.cliente_id === C1 && copia.local_id === L1 && copia.prioridad === 'Alta' && !copia.resolucion && !copia.trabajo_id
    && base.db.tareas.filter(t => t.ticket_id === copia.id).length === 0, 'duplicar: mismos datos, abierto, sin resolución ni trabajo ni tareas');
  await page.waitForFunction(n => location.hash === `#/tickets/${n}`, copia.numero);
  ok(true, 'duplicar: abre la copia');

  await page.goto(`${srv.base}/#/tickets/50`);
  await page.waitForSelector('[data-action="tkxATrabajo"]');
  await page.click('[data-action="tkxATrabajo"]');
  await page.waitForSelector('#tf-form');
  ok(await page.inputValue('#tf-titulo') === 'Impresora cocina' && (await page.textContent('.vista')).includes('Ticket #50'), 'a trabajo: el alta sale rellena con el ticket');
  await page.click('#tf-form button[type="submit"]');
  await toast(page, 'el ticket #50 cerrado');
  const trab = base.db.trabajos.find(t => t.titulo === 'Impresora cocina');
  const t1 = base.db.tickets.find(t => t.id === T1);
  ok(trab && trab.cliente_id === C1 && t1.trabajo_id === trab.id && t1.estado === 'Cerrado' && t1.resolucion_categoria === 'Pasó a trabajo' && t1.resolucion.includes(`#${trab.numero}`),
    'a trabajo: el ticket queda enlazado y cerrado («Pasó a trabajo»)');

  await page.goto(`${srv.base}/#/tickets/51`);
  await page.waitForSelector('#tk-resolucion');
  await page.fill('#tk-resolucion', 'Reinicio del router y cambio de **DNS**');
  await page.click('[data-action="tkxWiki"]');
  await toast(page, 'Resolución guardada en la wiki');
  const raiz = base.db.paginas.find(p => p.titulo === 'Resoluciones' && !p.padre_id);
  let pg = base.db.paginas.filter(p => p.ticket_id === T2);
  ok(raiz && pg.length === 1 && pg[0].padre_id === raiz.id && pg[0].contenido.includes('Ticket #51') && pg[0].contenido.includes('Cómo se resolvió') && pg[0].cliente_id === C1,
    'wiki: la resolución es una página bajo «Resoluciones», con el ticket y el cliente');
  ok(base.db.tickets.find(t => t.id === T2).resolucion.includes('DNS') && fn.some(f => f.nombre === 'documentos-indexar' && f.id === pg[0].id), 'wiki: se queda también en el ticket y se manda indexar');
  await page.waitForSelector('a[href^="#/wiki/"]');
  await page.fill('#tk-resolucion', 'Cambio de DNS y reinicio');
  await page.click('[data-action="tkxWiki"]');
  for (let i = 0; i < 50 && !base.db.paginas.some(p => p.ticket_id === T2 && p.contenido.includes('Cambio de DNS y reinicio')); i++) await page.waitForTimeout(100);
  pg = base.db.paginas.filter(p => p.ticket_id === T2);
  ok(pg.length === 1 && pg[0].contenido.includes('Cambio de DNS y reinicio') && base.db.paginas.filter(p => p.titulo === 'Resoluciones').length === 1, 'wiki: guardarla otra vez actualiza la misma página');
  await page.screenshot({ path: `${CAPTURAS}/tickets-completos.png`, fullPage: true });

  await page.goto(`${srv.base}/#/monitorizacion/alertas`);
  await page.waitForSelector(`[data-action="moTicketAlerta"][data-p0="${A1}"]`);
  await page.click(`[data-action="moTicketAlerta"][data-p0="${A1}"]`);
  await toast(page, 'creado');
  const deAlerta = base.db.tickets.filter(t => t.rmm_alerta_id === A1);
  ok(deAlerta.length === 1 && deAlerta[0].canal === 'rmm' && deAlerta[0].prioridad === 'Alta' && deAlerta[0].cliente_id === C1 && deAlerta[0].local_id === L1
    && deAlerta[0].titulo.includes('Disco C casi lleno') && deAlerta[0].descripcion.includes('CAJA1'), 'alerta: abre un ticket de la sede, crítica = Alta, por Monitorización');
  await page.waitForSelector(`a[href="#/tickets/${deAlerta[0].numero}"]`);
  ok(await page.locator(`[data-action="moTicketAlerta"][data-p0="${A1}"]`).count() === 0, 'alerta: después enseña su ticket en vez del botón (uno por alerta)');
  await page.goto(`${srv.base}/#/monitorizacion/equipo/${D1}/alertas`);
  await page.waitForSelector(`a[href="#/tickets/${deAlerta[0].numero}"]`);
  ok(true, 'alerta: también en la ficha del equipo');
  errores.push(...C.errores);
  await C.ctx.close();

  // ── Con las áreas de tareas y trabajos de la app ────────────────────────
  C = await contexto(browser, APP);
  ({ page } = C);
  await page.goto(`${srv.base}/#/tickets/50`);
  await page.waitForSelector('#tkx-tareas');
  ok((await page.textContent('#tkx-tareas')).includes('se crean todavía en la app') && await page.locator('#tkx-titulo').count() === 0, 'área de tareas de la app: se ven, no se crean');
  ok(await page.locator('[data-action="tkxATrabajo"]').count() === 0 && (await page.textContent('.vista')).includes('app actual'), 'área de trabajos de la app: sin «Crear trabajo» (se crea en la app y se vincula)');
  ok(await page.locator('[data-action="tkxDuplicar"]').count() === 1, 'duplicar vale ya (los tickets son del hub)');
  errores.push(...C.errores);
  await C.ctx.close();

  ok(!errores.length, `sin errores JS${errores.length ? ': ' + errores.join(' | ') : ''}`);
} finally {
  await browser.close();
  srv.parar();
}
if (!fallos()) console.log('\nTodo bien');
process.exit(fallos() ? 1 : 0);
