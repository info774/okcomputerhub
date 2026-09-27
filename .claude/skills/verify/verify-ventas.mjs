// Arnés de la fase 4 (ventas): Clientes 360 (lista con clase A/B/C, ficha,
// «lo siguiente», clase a mano, apuntar lo de hoy, línea de tiempo, sedes y
// contactos), Oportunidades (embudo con arrastre, nueva con cliente, etapas,
// actividad, previsión, embudos), Cobros (recordatorio preparado: WhatsApp,
// texto editable, marcar enviado) y Mapa (puntos y capas). Un técnico no ve
// dinero ni Cobros. Nada escribe en las tablas espejo de la app.
//   npm run build && node .claude/skills/verify/verify-ventas.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS, SB } from './comun.mjs';

const { ok, fallos, sumar } = contador();
const srv = await servidor(4183);
const hoy = new Date().toISOString().slice(0, 10);
const ayer = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const C1 = 'c1111111-1111-1111-1111-111111111111', C2 = 'c2222222-2222-2222-2222-222222222222';
const L1 = 'l1111111-1111-1111-1111-111111111111', L2 = 'l2222222-2222-2222-2222-222222222222';
const PIPE = '00000000-0000-4000-8000-000000000001';
const ETAPAS = [['Detectado', 10, 'abierta'], ['Contactado', 25, 'abierta'], ['Propuesta', 50, 'abierta'], ['Negociando', 75, 'abierta'], ['Ganado', 100, 'ganada'], ['Perdido', 0, 'perdida']]
  .map(([n, p, t]) => ({ clave: n, nombre: n, probabilidad: p, tipo: t }));
const ESPEJO = ['clientes', 'locales', 'contactos', 'trabajos', 'tickets', 'presupuestos', 'tareas', 'zoho_facturas', 'zoho_cobros'];
const INICIAL = {
  usuarios: [{ id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true },
             { id: 'u-tito', nombre: 'Tito', email: 'tito@ok.test', rol: 'tecnico', activo: true }],
  areas: [], sync_estado: [{ clave: 'zoho', ultima_ok: new Date().toISOString() }], proyectos: [], proyecto_tareas: [],
  clientes: [
    { id: C1, nombre: 'Hotel Playa SL', nif: 'B123', telefono: '612345678', email: 'hotel@x.test', direccion: 'Adeje', estado: 'activo', zoho_id: 'z1', activo: true, notas: null },
    { id: C2, nombre: 'Bar Pepe', nif: 'B999', telefono: '922000000', email: null, direccion: 'La Laguna', estado: 'activo', zoho_id: 'z2', activo: true, notas: null },
  ],
  clientes_crm: [{ cliente_id: C2, clase_manual: null, siguiente_fecha: ayer, siguiente_texto: 'Llamar', responsable_id: 'u-tito', etiquetas: [] }],
  locales: [
    { id: L1, cliente_id: C1, nombre: 'Hotel Playa', direccion: 'Adeje', plan: 'Premium', estado_pago: 'Al corriente', importe_mantenimiento: 90, programa_tpv: 'Sysme', lat: 28.12, lng: -16.73, activo: true },
    { id: L2, cliente_id: C2, nombre: 'Bar Pepe', direccion: 'La Laguna', plan: 'Silver', estado_pago: 'No paga', importe_mantenimiento: 40, programa_tpv: null, lat: 28.48, lng: -16.31, activo: true },
  ],
  contactos: [{ id: 'k1', nombre: 'Marta', cargo: 'Gerente', telefono: '612345678', email: 'marta@x.test', cliente_id: C1, activo: true, favorito: true }],
  rmm_estado_local: [{ local_id: L1, equipos: 2, conectados: 1, alertas: 0, estado: 'parcial' }],
  pipelines: [{ id: PIPE, nombre: 'Ventas', etapas: ETAPAS, por_defecto: true, orden: 0, activo: true }],
  oportunidades: [
    { id: 'o1', created_at: new Date().toISOString(), titulo: 'Cámaras hotel', cliente_id: C1, estado: 'Detectado', valor_estimado: 3000, tecnico_id: 'Tito',
      fecha_seguimiento: ayer, origen: 'web', pipeline_id: PIPE, orden: 0, cerrada_at: null, descripcion: null },
    { id: 'o2', created_at: new Date().toISOString(), titulo: 'TPV nuevo', cliente_id: C2, estado: 'Propuesta', valor_estimado: 1200, tecnico_id: null,
      fecha_seguimiento: null, origen: null, pipeline_id: PIPE, orden: 0, cerrada_at: null, descripcion: null },
  ],
  actividades: [], presupuestos: [{ id: 'p1', numero_presupuesto: 'P-7', titulo: 'Cámaras', estado: 'Enviado', total: 3100, oportunidad_id: 'o1', cliente_id: C1 }],
  trabajos: [], tickets: [], tareas: [],
  zoho_facturas: [{ invoice_id: 'i1', numero: 'F26-1', cliente_zoho_id: 'z1', cliente_nombre: 'Hotel Playa SL', total: 5000, saldo: 800, vence: '2026-08-01', fecha: '2026-07-01', estado: 'overdue' }],
  cobros_recordatorios: [{ id: 'r1', invoice_id: 'i1', numero: 'F26-1', cliente_zoho_id: 'z1', cliente_nombre: 'Hotel Playa SL', saldo: 800, vence: '2026-08-01',
    nivel: 3, estado: 'pendiente', texto: 'Hola Hotel, la factura F26-1 de 800,00 € sigue pendiente.', canal: null, enviado_at: null, created_at: new Date().toISOString() }],
};
const RPC = {
  clases_clientes: () => [{ cliente_id: C1, clase: 'A', clase_auto: 'A' }, { cliente_id: C2, clase: 'C', clase_auto: 'C' }],
  linea_tiempo: (b, db) => [
    ...db.actividades.filter(a => a.cliente_id === b.p_cliente).map(a => ({ fecha: a.created_at, tipo: `actividad_${a.tipo}`, titulo: a.tipo, detalle: a.texto, importe: null, enlace: null, autor: 'Ana', ref_id: a.id })),
    { fecha: '2026-09-01T10:00:00Z', tipo: 'presupuesto', titulo: 'P-7 Cámaras', detalle: 'Enviado', importe: 3100, enlace: null, autor: null, ref_id: 'p1' },
  ],
};

async function contexto(browser, email, viewport = { width: 1280, height: 900 }) {
  const base = baseMemoria(INICIAL, RPC);
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport });
  await preparar(ctx, { email, base });
  await ctx.route('https://*.tile.openstreetmap.org/**', r => r.fulfill({ status: 200, contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') }));
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
  page.on('dialog', d => d.type() === 'prompt' ? d.accept('precio') : d.accept());
  return { ctx, page, base, errores };
}
const toastCon = (page, t) => page.waitForFunction(x => document.getElementById('toast')?.textContent.includes(x), t);

const browser = await navegador();
try {
  const A = await contexto(browser, 'ana@ok.test');
  const { page, base } = A;

  // ── Clientes ─────────────────────────────────────────────────────────────
  await page.goto(`${srv.base}/#/clientes`);
  await page.waitForSelector('#cl-filtro');
  ok(await page.locator('main tbody tr.fila-clic').count() === 2 && (await page.locator('main tbody tr').first().textContent()).includes('Hotel Playa'),
    'clientes: lista con los A primero');
  await page.click('[data-action="clClase"][data-p0="C"]');
  await page.waitForFunction(() => document.querySelectorAll('main tbody tr.fila-clic').length === 1);
  ok((await page.textContent('main tbody')).includes('Bar Pepe') && (await page.textContent('main tbody')).includes('Llamar'), 'clientes: filtro por clase y «lo siguiente» en la lista');
  await page.click('[data-action="clClase"][data-p0=""]');
  await page.waitForSelector('[data-action="clAbrir"][data-p0="' + C1 + '"]');
  await page.click(`[data-action="clAbrir"][data-p0="${C1}"]`);
  await page.waitForSelector('#cl-sig-texto');
  ok((await page.textContent('#cl-cuerpo')).includes('Dinero (Zoho)') && (await page.textContent('#cl-cuerpo')).includes('800,00 €'), 'ficha: admin ve pendiente y vencido de Zoho');
  ok(await page.locator('a[href="https://wa.me/34612345678"]').count() >= 1, 'ficha: WhatsApp con prefijo 34');
  await page.fill('#cl-sig-fecha', '2026-10-15');
  await page.fill('#cl-sig-texto', 'Mandar oferta de cámaras');
  await page.click('form[data-on-submit="clGuardarSiguiente"] button[type=submit]');
  await toastCon(page, 'Guardado');
  const crm = base.reg.escrituras.find(e => e.tabla === 'clientes_crm');
  ok(crm?.cuerpo.cliente_id === C1 && crm.cuerpo.siguiente_texto === 'Mandar oferta de cámaras' && crm.url.includes('on_conflict=cliente_id'), 'ficha: «lo siguiente» se guarda en clientes_crm');
  await page.selectOption('#cl-clase', 'B');
  await toastCon(page, 'Clase B');
  ok(base.db.clientes_crm.find(c => c.cliente_id === C1)?.clase_manual === 'B', 'ficha: clase a mano');
  await page.waitForSelector('#cl-texto');
  await page.check('input[name="cl-tipo"][value="visita"]');
  await page.fill('#cl-texto', 'Visita: quieren 4 cámaras más');
  await page.click('form[data-on-submit="clApuntar"] button[type=submit]');
  await page.waitForSelector('.cl-linea');
  const act = base.reg.escrituras.find(e => e.tabla === 'actividades');
  ok(act?.cuerpo.tipo === 'visita' && act.cuerpo.cliente_id === C1, 'ficha: apuntar lo de hoy crea la actividad');
  ok((await page.textContent('.cl-linea')).includes('4 cámaras') && (await page.textContent('.cl-linea')).includes('P-7'), 'ficha: la línea de tiempo junta actividad y presupuesto');
  await page.click('[data-action="clPestana"][data-p1="sedes"]');
  await page.waitForSelector(`a[href="#/monitorizacion/sede/${L1}"]`);
  ok((await page.textContent('#cl-cuerpo')).includes('Premium'), 'ficha: sedes con plan y estado de equipos');
  await page.click('[data-action="clPestana"][data-p1="contactos"]');
  await page.waitForSelector('.cl-contactos');
  ok((await page.textContent('.cl-contactos')).includes('Marta'), 'ficha: contactos');
  await page.screenshot({ path: `${CAPTURAS}/ventas-cliente.png`, fullPage: true });

  // ── Oportunidades ────────────────────────────────────────────────────────
  await page.goto(`${srv.base}/#/oportunidades`);
  await page.waitForSelector('.pr-columna');
  ok(await page.locator('.pr-columna').count() === 4, 'oportunidades: embudo con las 4 etapas abiertas');
  await page.dragAndDrop('.pr-tarjeta[data-id="o1"]', '.pr-columna[data-etapa="Contactado"]');
  await toastCon(page, 'Contactado');
  ok(base.db.oportunidades.find(o => o.id === 'o1').estado === 'Contactado', 'oportunidades: arrastrar cambia la etapa');
  await page.click('[data-action="opVista"][data-p0="prevision"]');
  await page.waitForSelector('.di-cifra');
  ok(/4\.?200 €/.test(await page.textContent('main')), 'oportunidades: previsión con lo que está en juego');
  await page.click('[data-action="opVista"][data-p0="embudo"]');
  await page.waitForSelector('[data-action="opNueva"]');
  await page.click('[data-action="opNueva"]');
  await page.waitForSelector('#op-titulo');
  await page.fill('#op-titulo', 'Wifi terraza');
  await page.fill('#op-cliente-q', 'bar');
  await page.waitForSelector(`[data-action="opElegirCliente"][data-p0="${C2}"]`);
  await page.click(`[data-action="opElegirCliente"][data-p0="${C2}"]`);
  await page.fill('#op-valor', '900');
  await page.click('form[data-on-submit="opCrear"] button[type=submit]');
  await page.waitForSelector('.op-etapas');
  const nueva = base.db.oportunidades.find(o => o.titulo === 'Wifi terraza');
  ok(nueva?.cliente_id === C2 && nueva.estado === 'Detectado' && nueva.pipeline_id === PIPE && nueva.valor_estimado === 900, 'oportunidades: nueva con cliente, primera etapa y embudo');
  await page.click('[data-action="opEtapa"][data-p0="Ganado"]');
  await toastCon(page, 'Ganada');
  ok(base.db.oportunidades.find(o => o.titulo === 'Wifi terraza').estado === 'Ganado', 'oportunidades: ganar desde la ficha');
  await page.waitForSelector('#op-act-texto');
  await page.fill('#op-act-texto', 'Aceptó por teléfono');
  await page.click('form[data-on-submit="opApuntar"] button[type=submit]');
  await page.waitForFunction(() => document.body.textContent.includes('Aceptó por teléfono'));
  ok(base.db.actividades.some(a => a.oportunidad_id === nueva.id && a.cliente_id === C2), 'oportunidades: la actividad queda en la oportunidad y en el cliente');
  await page.goto(`${srv.base}/#/oportunidades/o1`);
  await page.waitForSelector('.op-etapas');
  ok((await page.textContent('main')).includes('P-7'), 'oportunidades: la ficha enseña lo vinculado en la app');
  await page.click('[data-action="opEtapa"][data-p0="Perdido"]');
  await toastCon(page, 'Perdido');
  ok(base.db.oportunidades.find(o => o.id === 'o1').motivo_perdida === 'precio', 'oportunidades: perder pide el motivo');
  await page.goto(`${srv.base}/#/oportunidades`);
  await page.waitForSelector('[data-action="opVista"][data-p0="embudos"]');
  await page.click('[data-action="opVista"][data-p0="embudos"]');
  await page.waitForSelector('form[data-on-submit^="opGuardarPipe"][data-id=""]');
  const f = page.locator('form[data-on-submit^="opGuardarPipe"][data-id=""]');
  await f.locator('input[name="nombre"]').fill('Mantenimiento');
  await f.locator('textarea[name="etapas"]').fill('Interesado | 20 | abierta\nFirmado | 100 | ganada\nNo | 0 | perdida');
  await f.locator('button[type=submit]').click();
  await toastCon(page, 'Embudo guardado');
  const pipe = base.db.pipelines.find(p => p.nombre === 'Mantenimiento');
  ok(pipe?.etapas.length === 3 && pipe.etapas[1].tipo === 'ganada' && pipe.etapas[0].probabilidad === 20, 'embudos: un admin crea uno con sus etapas');

  // ── Cobros ───────────────────────────────────────────────────────────────
  await page.goto(`${srv.base}/#/cobros`);
  await page.waitForSelector('.co-rec');
  const wa = await page.getAttribute('.co-rec a[href^="https://wa.me/"]', 'href');
  ok(wa?.startsWith('https://wa.me/34612345678?text=') && decodeURIComponent(wa).includes('F26-1'), 'cobros: WhatsApp con el teléfono del cliente y el texto');
  await page.fill('#co-texto-r1', 'Texto cambiado a mano');
  await page.locator('#co-texto-r1').dispatchEvent('change');
  await page.waitForFunction(() => true);
  await page.waitForTimeout(300);
  ok(base.db.cobros_recordatorios[0].texto === 'Texto cambiado a mano', 'cobros: el texto se edita y se guarda');
  await page.click('[data-action="coEnviado"][data-p0="r1"]');
  await toastCon(page, 'enviado');
  ok(base.db.cobros_recordatorios[0].estado === 'enviado' && base.db.cobros_recordatorios[0].enviado_por === 'u-ana', 'cobros: marcar enviado apunta quién');
  await page.waitForFunction(() => document.querySelector('main')?.textContent.includes('Mantenimiento con el cobro torcido'));
  ok((await page.textContent('main')).includes('Bar Pepe'), 'cobros: mantenimiento torcido de la app');
  await page.screenshot({ path: `${CAPTURAS}/ventas-cobros.png`, fullPage: true });

  // ── Mapa ─────────────────────────────────────────────────────────────────
  await page.goto(`${srv.base}/#/mapa`);
  await page.waitForSelector('.leaflet-interactive');
  ok(await page.locator('path.leaflet-interactive').count() === 2, 'mapa: un punto por sede con ubicación');
  await page.click('[data-action="maCapa"][data-p0="cobro"]');
  await page.waitForFunction(() => document.getElementById('ma-leyenda')?.textContent.includes('No paga'));
  ok((await page.textContent('#ma-leyenda')).includes('No paga o facturas vencidas (2)'), 'mapa: la capa de cobro marca «No paga» y la factura vencida');
  await page.screenshot({ path: `${CAPTURAS}/ventas-mapa.png` });

  const aEspejo = base.reg.escrituras.filter(e => ESPEJO.includes(e.tabla));
  ok(aEspejo.length === 0, `nada escribe en el espejo de la app${aEspejo.length ? ': ' + aEspejo.map(e => e.tabla).join(',') : ''}`);
  ok(base.reg.rest.every(r => r.metodo === 'OPTIONS' || r.perfil === 'hub'), 'todas las lecturas con Accept-Profile: hub');
  ok(await page.locator('[onclick],[onchange],[oninput]').count() === 0, 'sin on*= inline');
  ok(A.errores.length === 0, `admin: sin errores JS${A.errores.length ? ': ' + A.errores.join(' | ') : ''}`);
  await A.ctx.close();

  // ── Técnico ──────────────────────────────────────────────────────────────
  const T = await contexto(browser, 'tito@ok.test');
  await T.page.goto(`${srv.base}/#/clientes/${C1}`);
  await T.page.waitForSelector('#cl-sig-texto');
  ok(!(await T.page.textContent('#cl-cuerpo')).includes('Dinero (Zoho)'), 'técnico: sin dinero en la ficha');
  ok(!T.base.reg.rest.some(r => r.tabla === 'zoho_facturas'), 'técnico: ni lo pide');
  ok(await T.page.locator('.menu-item[data-mod="cobros"]').count() === 0, 'técnico: Cobros no está en el menú');
  await T.page.goto(`${srv.base}/#/cobros`);
  await T.page.waitForSelector('text=solo para administradores');
  ok(await T.page.locator('.co-rec').count() === 0, 'técnico: ni por URL');
  ok(T.errores.length === 0, 'técnico: sin errores JS');
  await T.ctx.close();

  // ── Móvil ────────────────────────────────────────────────────────────────
  const M = await contexto(browser, 'ana@ok.test', { width: 390, height: 844 });
  for (const [ruta, sel] of [[`clientes/${C1}`, '#cl-sig-texto'], ['oportunidades/o2', '.op-etapas'], ['cobros', '.co-rec'], ['mapa', '.leaflet-interactive']]) {
    await M.page.goto(`${srv.base}/#/${ruta}`);
    await M.page.waitForSelector(sel);
    const ancho = await M.page.evaluate(() => document.documentElement.scrollWidth);
    ok(ancho <= 390, `móvil ${ruta}: sin scroll horizontal (${ancho}px)`);
  }
  ok(M.errores.length === 0, 'móvil: sin errores JS');
  await M.ctx.close();
} catch (e) { console.error('✗ excepción:', e); sumar(); }
finally { await browser.close(); srv.parar(); }
console.log(fallos() ? `\n${fallos()} fallo(s)` : '\nTodo bien');
process.exit(fallos() ? 1 : 0);
