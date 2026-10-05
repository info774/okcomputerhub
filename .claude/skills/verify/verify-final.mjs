// Arnés de la fase Final (trabajos, calendario, chat, hoy). Dos mundos:
//   · ANTES del corte (áreas de la app): todo se ve, nada se edita, avisa.
//   · DESPUÉS (áreas del hub, simulado en hub.areas): estado por RPC, material
//     por RPC, mover en el calendario por RPC, fichar y terminar con foto.
// Más el chat (canales, directo, enviar con Intro, sin leer) y el móvil.
//   npm run build && node .claude/skills/verify/verify-final.mjs
import { servidor, navegador, baseMemoria, preparar, contador, SB } from './comun.mjs';

const { ok, fallos, sumar } = contador();
const srv = await servidor(4192);
const hoy = new Date().toLocaleDateString('sv-SE');
const iso = (h) => new Date(`${hoy}T${h}:00`).toISOString();
const T1 = 'b1111111-1111-1111-1111-111111111111', L1 = 'l1111111-1111-1111-1111-111111111111', C1 = 'c1111111-1111-1111-1111-111111111111';
const base0 = (cortado) => ({
  usuarios: [{ id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true }, { id: 'u-tito', nombre: 'Tito Pérez', email: 'tito@ok.test', rol: 'tecnico', activo: true }],
  areas: [{ area: 'trabajos', dueno: cortado ? 'hub' : 'app', tablas: ['trabajos', 'agenda', 'sesiones', 'documento_lineas', 'trabajo_comentarios', 'trabajo_fotos'] },
          { area: 'inventario', dueno: cortado ? 'hub' : 'app', tablas: ['catalogo', 'furgonetas', 'furgoneta_inventario', 'furgoneta_movimientos'] }],
  sync_estado: [], proyectos: [],
  clientes: [{ id: C1, nombre: 'Hotel Playa SL', telefono: '612345678', activo: true }],
  locales: [{ id: L1, cliente_id: C1, nombre: 'Hotel Playa', direccion: 'Av. Adeje 1', lat: 28.1, lng: -16.7, activo: true }],
  contactos: [],
  trabajos: [{ id: T1, numero: 151, created_at: iso('08:00'), titulo: 'Cambiar router <b>x</b>', descripcion: 'Router **nuevo** y wifi', estado: 'Pendiente', tecnicos: ['Tito'], cliente_id: C1, local_id: L1,
    contacto_id: null, fecha_programada: hoy, hora_llegada: '10:00:00', prioridad: 'media', observaciones: null },
    { id: 'b2', numero: 150, created_at: iso('08:00'), titulo: 'Viejo', descripcion: '', estado: 'Facturado', tecnicos: ['Ana Admin'], cliente_id: C1, local_id: null, fecha_programada: null }],
  agenda: [{ id: 'ag1', trabajo_id: T1, titulo: null, inicio: iso('10:00'), fin: iso('12:00'), tecnicos: ['Tito'], estado: null, todo_el_dia: false }],
  sesiones: [], documento_lineas: [{ id: 'dl1', trabajo_id: T1, nombre: 'Cable', cantidad: 2, precio: 3, descuento: 0, inventario_id: 'inv1', furgoneta_id: 'f1', categoria: null, orden: 1 }],
  trabajo_comentarios: [{ id: 'tc1', trabajo_id: T1, autor_nombre: 'Tito', texto: 'Llevo el <script>router</script>', created_at: iso('09:00') }], trabajo_fotos: [],
  tickets: [{ numero: 60, titulo: 'Sin wifi', estado: 'Abierto', trabajo_id: T1 }],
  furgoneta_inventario: [{ id: 'inv2', nombre: 'Router TP-Link', cantidad: 4, furgoneta_id: 'f1', precio: 45 }], furgonetas: [{ id: 'f1', nombre: 'Furgo Tito' }],
  chat_canales: [{ id: 'cg', nombre: 'General', tipo: 'grupo', miembros: [] }], chat_mensajes: [{ id: 'm1', canal_id: 'cg', autor_id: 'u-ana', texto: 'Buenos días **equipo**', created_at: iso('08:30'), editado_at: null }],
  chat_leidos: [],
});
const RPC = {
  trabajo_estado: (b, db) => { if (b.p_estado === 'Completado' && !db.sesiones.some(s => s.entidad_id === b.p_id && s.fin)) throw new Error('Para completarlo hace falta fichar el inicio y el fin'); db.trabajos.find(t => t.id === b.p_id).estado = b.p_estado; return null; },
  trabajo_guardar_lineas: (b, db) => { db.documento_lineas = db.documento_lineas.filter(l => l.trabajo_id !== b.p_trabajo).concat(b.p_lineas.map((l, i) => ({ ...l, id: `n${i}`, trabajo_id: b.p_trabajo }))); return b.p_lineas.length; },
  agenda_mover: (b, db) => { Object.assign(db.agenda.find(a => a.id === b.p_id), { inicio: b.p_inicio, fin: b.p_fin }); return null; },
  fichar: (b, db) => {
    if (b.p_accion === 'inicio') { db.sesiones.push({ id: 's1', entidad_tipo: 'trabajo', entidad_id: b.p_id, inicio: new Date().toISOString(), fin: null, tecnico_id: 'u-tito', tecnico_nombre: 'Tito Pérez', created_at: new Date().toISOString() }); db.trabajos.find(t => t.id === b.p_id).estado = 'En progreso'; }
    if (b.p_accion === 'fin') { const s = db.sesiones.find(x => !x.fin); if (!s) throw new Error('No tienes ninguna sesión en curso'); s.fin = new Date().toISOString(); }
    return { ok: true };
  },
  chat_resumen: (_b, db) => db.chat_canales.map(c => ({ ...c, ultimo_at: iso('08:30'), sin_leer: db.chat_mensajes.filter(m => m.canal_id === c.id && m.autor_id !== 'u-tito' && !db.chat_leidos.some(l => l.canal_id === c.id)).length, ultimo_texto: db.chat_mensajes.filter(m => m.canal_id === c.id).at(-1)?.texto ?? null })),
  chat_directo: (b, db) => { let c = db.chat_canales.find(x => x.tipo === 'directo' && x.miembros.includes(b.p_otro)); if (!c) { c = { id: 'cd', nombre: null, tipo: 'directo', miembros: ['u-tito', b.p_otro] }; db.chat_canales.push(c); } return c.id; },
};

async function contexto(browser, email, cortado, viewport = { width: 1280, height: 900 }) {
  const base = baseMemoria(base0(cortado), RPC);
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport });
  await preparar(ctx, { email, base });
  const fn = [];
  await ctx.route(`${SB}/functions/v1/trabajo-foto`, async route => { fn.push(route.request().postDataJSON()); return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"id":"foto1"}' }); });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
  page.on('dialog', d => d.accept());
  return { ctx, page, base, fn, errores };
}
const toastCon = (page, t) => page.waitForFunction(x => document.getElementById('toast')?.textContent.includes(x), t);
const rpcs = (base, n) => base.reg.escrituras.filter(e => e.metodo === 'RPC' && e.tabla === n);

const browser = await navegador();
try {
  // ── Antes del corte: solo lectura ────────────────────────────────────────
  const A = await contexto(browser, 'tito@ok.test', false);
  await A.page.goto(`${srv.base}/#/trabajos`);
  await A.page.waitForSelector('.area-app');
  ok(await A.page.locator('tbody tr').count() === 1 && await A.page.locator('tbody b').count() === 0, 'trabajos: lista de abiertos (escapada)');
  await A.page.selectOption('#tr-tecnico', '__yo');
  await A.page.waitForFunction(() => document.querySelectorAll('#tr-lista tbody tr').length === 1);
  ok(true, 'trabajos: «los míos» por nombre de pila');
  await A.page.click('[data-action="trAbrir"][data-p0="151"]');
  await A.page.waitForSelector('.op-ficha');
  ok(await A.page.locator('#tr-estado').count() === 0 && await A.page.locator('[data-action="trGuardarLineas"]').count() === 0 && await A.page.locator('.area-app').count() === 1, 'ficha: sin el corte no se edita y lo avisa');
  ok((await A.page.textContent('.op-ficha')).includes('#60 Sin wifi') && await A.page.locator('.op-ficha script').count() === 0 && await A.page.locator('a[href*="maps"]').count() === 1, 'ficha: tickets, comentarios escapados y cómo llegar');
  await A.page.goto(`${srv.base}/#/calendario`);
  await A.page.waitForSelector('.ca-bloque');
  ok(await A.page.locator('.ca-bloque[draggable="true"]').count() === 0, 'calendario: sin el corte, los bloques no se arrastran');
  await A.page.goto(`${srv.base}/#/hoy`);
  await A.page.waitForSelector('.ho-siguiente');
  ok((await A.page.textContent('.ho-siguiente')).includes('#151') && await A.page.locator('[data-action="hoInicio"]').count() === 0, 'hoy: la siguiente parada, sin botones de fichar');
  ok(A.errores.length === 0, `antes: sin errores JS${A.errores.length ? ': ' + A.errores.join(' | ') : ''}`);
  await A.ctx.close();

  // ── Después del corte ────────────────────────────────────────────────────
  const B = await contexto(browser, 'tito@ok.test', true);
  const { page, base, fn } = B;
  await page.goto(`${srv.base}/#/trabajos/151`);
  await page.waitForSelector('#tr-estado');
  await page.selectOption('#tr-estado', 'Completado');
  await toastCon(page, 'fichar el inicio y el fin');
  ok(rpcs(base, 'trabajo_estado').length === 1, 'ficha: el estado va por hub.trabajo_estado (y avisa si falta el fichaje)');
  await page.waitForSelector('#tr-l-q');
  await page.fill('#tr-l-q', 'router');
  await page.click('[data-action="trElegirInv"][data-p0="inv2"]');
  await page.fill('#tr-l-cant', '1');
  await page.click('form[data-on-submit="trAnadirLinea"] button[type=submit]');
  await page.click('[data-action="trGuardarLineas"]');
  await toastCon(page, 'Material guardado');
  const gl = rpcs(base, 'trabajo_guardar_lineas')[0];
  ok(gl?.cuerpo.p_lineas.length === 2 && gl.cuerpo.p_lineas[1].inventario_id === 'inv2' && gl.cuerpo.p_lineas[1].precio === 45, 'ficha: el material (con su producto del inventario) va por hub.trabajo_guardar_lineas');
  await page.goto(`${srv.base}/#/calendario`);
  await page.waitForSelector('.ca-bloque[draggable="true"]');
  const dia = await page.$$eval('.ca-dia', ds => ds.map(d => d.dataset.dia));
  const otro = dia.find(d => d !== new Date().toLocaleDateString('sv-SE'));
  await page.dragAndDrop('.ca-bloque[data-id="ag1"] strong', `.ca-dia[data-dia="${otro}"]`);
  await toastCon(page, 'Movido');
  const mv = rpcs(base, 'agenda_mover')[0];
  ok(mv && new Date(mv.cuerpo.p_inicio).toLocaleDateString('sv-SE') === otro && new Date(mv.cuerpo.p_fin) - new Date(mv.cuerpo.p_inicio) === 7200000, 'calendario: arrastrar a otro día conserva las horas (hub.agenda_mover)');
  await page.goto(`${srv.base}/#/hoy`);
  await page.waitForSelector('[data-action="hoInicio"]');
  await page.click('[data-action="hoInicio"]');
  await toastCon(page, 'Inicio fichado');
  ok(rpcs(base, 'fichar').some(r => r.cuerpo.p_accion === 'inicio' && r.cuerpo.p_id === T1), 'hoy: empezar ficha el inicio en el trabajo');
  await page.waitForSelector('[data-action="hoFin"]');
  await page.click(`[data-action="hoTerminar"][data-p0="${T1}"]`);
  await page.waitForSelector('#ho-hecho');
  await page.fill('#ho-hecho', 'Router cambiado y wifi configurada');
  await page.setInputFiles('#ho-foto', { name: 'f.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(2000, 7) });
  await page.click('form[data-on-submit^="hoGuardarTerminar"] button[type=submit]');
  await toastCon(page, 'Trabajo terminado');
  const t = base.db.trabajos.find(x => x.id === T1);
  ok(fn.some(f => f.accion === 'subir' && f.trabajo_id === T1 && f.archivo.length > 2000) && t.estado === 'Completado' && t.observaciones.includes('wifi configurada')
    && rpcs(base, 'fichar').some(r => r.cuerpo.p_accion === 'fin'), 'hoy: terminar = fin + foto + lo que se hizo + Completado');

  // Chat
  await page.goto(`${srv.base}/#/chat/cg`);
  await page.waitForSelector('#ch-texto');
  ok((await page.textContent('.ch-mensajes')).includes('Buenos días') && await page.locator('.ch-mensajes strong').count() >= 1, 'chat: mensajes con markdown seguro');
  ok(base.db.chat_leidos.some(l => l.canal_id === 'cg' && l.usuario_id === 'u-tito'), 'chat: al abrirlo se marca leído');
  await page.fill('#ch-texto', 'Voy para el hotel');
  await page.press('#ch-texto', 'Enter');
  await page.waitForFunction(() => document.querySelector('.ch-mensajes')?.textContent.includes('Voy para el hotel'));
  ok(base.db.chat_mensajes.some(m => m.texto === 'Voy para el hotel' && m.canal_id === 'cg'), 'chat: Intro envía');
  const msj = base.db.chat_mensajes.find(m => m.texto === 'Voy para el hotel');
  ok(base.reg.funciones.some(f => f.url.endsWith('/push') && f.body?.accion === 'chat' && f.body.mensaje_id === msj?.id), 'chat: avisa por push a los demás (función push, acción chat)');
  await page.selectOption('#ch-persona', 'u-ana');
  await page.click('form[data-on-submit="chDirecto"] button[type=submit]');
  await page.waitForFunction(() => location.hash === '#/chat/cd');
  ok(rpcs(base, 'chat_directo').some(r => r.cuerpo.p_otro === 'u-ana'), 'chat: abrir un directo');
  ok(B.errores.length === 0, `después: sin errores JS${B.errores.length ? ': ' + B.errores.join(' | ') : ''}`);
  await B.ctx.close();

  // Móvil
  const M = await contexto(browser, 'tito@ok.test', true, { width: 390, height: 844 });
  for (const [r, sel] of [['trabajos', '#tr-lista'], ['trabajos/151', '.op-ficha'], ['calendario', '.ca-agenda li'], ['hoy', '.ho-siguiente'], ['chat', '.ch-lista'], ['chat/cg', '#ch-texto']]) {
    await M.page.goto(`${srv.base}/#/${r}`);
    await M.page.waitForSelector(sel);
    const ancho = await M.page.evaluate(() => document.documentElement.scrollWidth);
    ok(ancho <= 390, `móvil ${r}: sin scroll horizontal (${ancho}px)`);
  }
  ok(await M.page.locator('.ch-lista').isHidden(), 'móvil: con una conversación abierta, la lista se esconde');
  ok(M.errores.length === 0, 'móvil: sin errores JS');
  await M.ctx.close();
} catch (e) { console.error('✗ excepción:', e); sumar(); }
finally { await browser.close(); srv.parar(); }
console.log(fallos() ? `\n${fallos()} fallo(s)` : '\nTodo bien');
process.exit(fallos() ? 1 : 0);
