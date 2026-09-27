// Arnés de la fase 6 (Desk): lista por vistas con el SLA, nuevo ticket con
// cliente/sede/contacto, ficha (responder por correo → desk-correo, por
// WhatsApp, nota interna, plantilla con sus datos, técnico, vincular trabajo,
// cerrar con la plantilla de cierre y el enlace de valoración), bandeja de
// correo (crear ticket, añadir a uno, descartar), ajustes (plantilla nueva,
// SLA solo admin) y la página pública de valoración. Móvil sin scroll.
//   npm run build && node .claude/skills/verify/verify-tickets.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS, SB } from './comun.mjs';

const { ok, fallos, sumar } = contador();
const srv = await servidor(4185);
const ahora = Date.now();
const iso = ms => new Date(ms).toISOString();
const C1 = 'c1111111-1111-1111-1111-111111111111', L1 = 'l1111111-1111-1111-1111-111111111111', K1 = 'k1111111-1111-1111-1111-111111111111';
const T1 = 'f1111111-1111-1111-1111-111111111111', T2 = 'f2222222-2222-2222-2222-222222222222', T3 = 'f3333333-3333-3333-3333-333333333333';
const TOK = '99999999-9999-4999-8999-999999999999';
const tk = (id, numero, extra) => ({ id, numero, created_at: iso(ahora - 3 * 3600e3), updated_at: null, cliente_id: C1, local_id: L1, contacto_id: K1, trabajo_id: null,
  descripcion: 'No imprime', estado: 'Abierto', prioridad: 'Media', tecnico_id: null, resolucion: null, resolucion_categoria: null, via_contacto: null, canal: 'email',
  email_hilo: 'h1', email_de: 'marta@x.test', sla_respuesta_at: iso(ahora + 5 * 3600e3), sla_resolucion_at: iso(ahora + 30 * 3600e3), primera_respuesta_at: null,
  cerrado_at: null, valoracion: null, valoracion_comentario: null, valoracion_at: null, valoracion_token: TOK, etiquetas: [], ...extra });
const INICIAL = {
  usuarios: [{ id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true },
             { id: 'u-tito', nombre: 'Tito', email: 'tito@ok.test', rol: 'tecnico', activo: true }],
  areas: [], sync_estado: [], proyectos: [], proyecto_tareas: [],
  clientes: [{ id: C1, nombre: 'Hotel Playa SL', nif: 'B1', telefono: '612345678', email: 'hotel@x.test', activo: true }],
  locales: [{ id: L1, cliente_id: C1, nombre: 'Hotel Playa', direccion: 'Adeje', activo: true }],
  contactos: [{ id: K1, nombre: 'Marta Díaz', telefono: '612345678', email: 'marta@x.test', cliente_id: C1, activo: true, favorito: true }],
  trabajos: [{ id: 'w1', numero: 151, titulo: 'Cambiar impresora', estado: 'Pendiente' }],
  tickets: [
    tk(T1, 50, { titulo: 'Impresora cocina' }),
    tk(T2, 51, { titulo: 'Sin internet', prioridad: 'Urgente', tecnico_id: 'Tito', sla_respuesta_at: iso(ahora - 3600e3), canal: 'whatsapp', email_de: null, email_hilo: null }),
    tk(T3, 49, { titulo: 'Viejo cerrado', estado: 'Cerrado', cerrado_at: iso(ahora - 86400e3), valoracion: 5, valoracion_token: '88888888-8888-4888-8888-888888888888' }),
  ],
  ticket_comentarios: [{ id: 'cm1', ticket_id: T1, autor_id: null, autor_nombre: 'Marta (correo)', texto: 'Sigue igual <script>alert(1)</script>', created_at: iso(ahora - 3600e3),
    tipo: 'cliente', canal: 'email', email_id: 'g0', enviado_at: null, envio_error: null }],
  plantillas_respuesta: [
    { id: 'p1', titulo: 'Recibido', texto: 'Hola {{contacto}}, recibido el #{{numero}}.', cierre: false, orden: 1, activa: true },
    { id: 'p2', titulo: 'Cierre', texto: 'Resuelto el #{{numero}}. Valora: {{valoracion}}', cierre: true, orden: 2, activa: true }],
  correos_entrantes: [{ id: 'e1', gmail_id: 'g9', hilo: 'h9', message_id: '<m9>', de: 'nuevo@y.test', de_nombre: 'Pepe', asunto: 'Presupuesto cámaras', texto: 'Hola, quería…', recibido_at: iso(ahora - 600e3), estado: 'nuevo', motivo: null, ticket_id: null },
    { id: 'e2', gmail_id: 'g8', hilo: 'h8', message_id: '<m8>', de: 'otro@y.test', de_nombre: null, asunto: 'Re: impresora', texto: 'Ya funciona', recibido_at: iso(ahora - 900e3), estado: 'nuevo', motivo: null, ticket_id: null },
    { id: 'e3', gmail_id: 'g7', hilo: 'h7', message_id: null, de: 'spam@y.test', de_nombre: null, asunto: 'Oferta', texto: 'x', recibido_at: iso(ahora - 900e3), estado: 'nuevo', motivo: null, ticket_id: null }],
  sla_politicas: ['urgente', 'alta', 'media', 'baja'].map((p, i) => ({ prioridad: p, respuesta_min: [120, 240, 480, 1440][i], resolucion_min: [240, 480, 960, 2880][i] })),
  horario_laboral: [1, 2, 3, 4, 5].flatMap(d => [{ dia_semana: d, desde: '09:00:00', hasta: '14:00:00' }, { dia_semana: d, desde: '16:00:00', hasta: '19:00:00' }]),
  festivos: [{ fecha: '2099-12-25', nombre: 'Navidad' }],
};

async function contexto(browser, email, viewport = { width: 1280, height: 900 }) {
  const base = baseMemoria(INICIAL, {});
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport });
  await preparar(ctx, { email, base });
  const fn = [];
  await ctx.route(`${SB}/functions/v1/**`, async route => {
    const nombre = new URL(route.request().url()).pathname.split('/').pop();
    const b = route.request().postDataJSON() ?? {};
    fn.push({ nombre, ...b });
    const r = nombre === 'desk-correo'
      ? (b.accion === 'estado' ? { configurado: true, ok: true, buzon: 'info@ok.test', sync: { ultima_ok: iso(ahora - 120e3) } } : b.accion === 'enviar' ? { ok: true, para: 'marta@x.test' } : { ok: true, ticket: 1, comentario: 0, nuevo: 0 })
      : nombre === 'ticket-valorar' ? (b.nota ? { numero: 50, titulo: 'Impresora', guardada: true } : { numero: 50, titulo: 'Impresora <b>x</b>' }) : { ok: true };
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(r) });
  });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
  page.on('dialog', d => d.accept());
  return { ctx, page, base, fn, errores };
}
const toastCon = (page, t) => page.waitForFunction(x => document.getElementById('toast')?.textContent.includes(x), t);

const browser = await navegador();
try {
  const A = await contexto(browser, 'ana@ok.test');
  const { page, base, fn } = A;

  // ── Lista ────────────────────────────────────────────────────────────────
  await page.goto(`${srv.base}/#/tickets`);
  await page.waitForSelector('.tk-tabla');
  const filas = await page.locator('.tk-tabla tbody tr').allTextContents();
  ok(filas.length === 2 && filas[0].includes('Sin internet') && filas[0].includes('vencido'), 'lista: abiertos, el del SLA vencido primero');
  ok((await page.textContent('.tk-vistas')).includes('SLA en riesgo (1)') && (await page.textContent('.pr-barra')).includes('Bandeja'), 'lista: contadores por vista y bandeja');
  await page.fill('#tk-q', 'impresora');
  await page.waitForFunction(() => document.querySelectorAll('.tk-tabla tbody tr').length === 1);
  ok(true, 'lista: buscar filtra');
  await page.fill('#tk-q', '');
  await page.click('[data-action="tkVista"][data-p0="cerrados"]');
  await page.waitForSelector('.tk-estrellas');
  ok((await page.textContent('.tk-tabla')).includes('Viejo cerrado'), 'lista: cerrados con su valoración');
  await page.click('[data-action="tkVista"][data-p0="abiertos"]');

  // ── Nuevo ────────────────────────────────────────────────────────────────
  await page.goto(`${srv.base}/#/tickets/nuevo`);
  await page.waitForSelector('#tk-titulo');
  await page.fill('#tk-titulo', 'Cámara sin imagen');
  await page.fill('#tk-cliente-q', 'Hotel');
  await page.click('[data-action="tkElegirCliente"]');
  await page.waitForFunction(() => document.querySelectorAll('#tk-contacto option').length === 2);
  await page.selectOption('#tk-contacto', K1);
  ok(await page.inputValue('#tk-email') === 'marta@x.test' && await page.inputValue('#tk-local') === L1, 'nuevo: sede sola y correo del contacto');
  await page.selectOption('#tk-prioridad', 'Alta');
  await page.click('form[data-on-submit="tkCrear"] button[type=submit]');
  await page.waitForSelector('.tk-responder');
  const nuevo = base.db.tickets.find(t => t.titulo === 'Cámara sin imagen');
  ok(nuevo?.cliente_id === C1 && nuevo.contacto_id === K1 && nuevo.prioridad === 'Alta' && nuevo.email_de === 'marta@x.test' && nuevo.canal === 'telefono', 'nuevo: ticket creado con sus datos');

  // ── Ficha ────────────────────────────────────────────────────────────────
  await page.goto(`${srv.base}/#/tickets/50`);
  await page.waitForSelector('.tk-conversacion');
  ok(await page.locator('.tk-conversacion script').count() === 0 && (await page.textContent('.tk-conversacion')).includes('<script>'), 'ficha: el texto del cliente va escapado');
  await page.selectOption('#tk-plantilla', 'p1');
  ok(await page.inputValue('#tk-texto') === 'Hola Marta, recibido el #50.', 'ficha: la plantilla se rellena con el contacto y el número');
  await page.click('#tk-enviar');
  await toastCon(page, 'Enviada a marta@x.test');
  const resp = base.db.ticket_comentarios.find(c => c.texto === 'Hola Marta, recibido el #50.');
  ok(resp?.tipo === 'respuesta' && fn.some(f => f.nombre === 'desk-correo' && f.accion === 'enviar' && f.comentario_id === resp.id), 'ficha: la respuesta se manda por correo (desk-correo)');
  ok(base.db.tickets.find(t => t.id === T1).estado === 'En curso', 'ficha: al contestar pasa a En curso');
  await page.waitForSelector('.tk-responder');
  await page.check('input[name="tk-tipo"][value="nota"]');
  ok(await page.locator('#tk-via-l').isHidden(), 'ficha: una nota no pregunta por dónde enviarla');
  await page.fill('#tk-texto', 'Llamé y no contesta');
  await page.click('#tk-enviar');
  await toastCon(page, 'Nota guardada');
  const n = fn.filter(f => f.accion === 'enviar').length;
  ok(base.db.ticket_comentarios.some(c => c.tipo === 'nota' && c.texto === 'Llamé y no contesta') && n === 1, 'ficha: nota interna sin enviar nada');
  await page.waitForSelector('#tk-tec');
  await page.selectOption('#tk-tec', 'Tito');
  await toastCon(page, 'Cambiado');
  ok(base.db.tickets.find(t => t.id === T1).tecnico_id === 'Tito', 'ficha: asignar técnico');
  await page.waitForSelector('#tk-trabajo');
  await page.fill('#tk-trabajo', '151');
  await page.click('form[data-on-submit="tkVincular"] button[type=submit]');
  await toastCon(page, 'trabajo #151');
  ok(base.db.tickets.find(t => t.id === T1).trabajo_id === 'w1', 'ficha: vincular un trabajo de la app por su número');
  await page.waitForSelector('#tk-resolucion');
  await page.fill('#tk-resolucion', 'Cambiado el cable');
  await page.selectOption('#tk-categoria', 'Presencial');
  await page.click('form[data-on-submit="tkCerrar"] button[type=submit]');
  await page.waitForFunction(() => (document.getElementById('tk-texto')?.value ?? '').includes('valorar.html?t='));
  const t1 = base.db.tickets.find(t => t.id === T1);
  ok(t1.estado === 'Cerrado' && t1.resolucion === 'Cambiado el cable' && t1.resolucion_categoria === 'Presencial', 'ficha: cerrar con resolución');
  ok((await page.inputValue('#tk-texto')).includes(`/valorar.html?t=${TOK}`), 'ficha: al cerrar se prepara el mensaje con el enlace de valoración');
  await page.screenshot({ path: `${CAPTURAS}/tickets-ficha.png`, fullPage: true });

  // WhatsApp (ticket sin correo)
  await page.goto(`${srv.base}/#/tickets/51`);
  await page.waitForSelector('#tk-via');
  ok(await page.inputValue('#tk-via') === 'whatsapp', 'ficha: sin correo, se contesta por WhatsApp');
  await page.evaluate(() => { window.open = u => { window.__abierto = u; return null; }; });
  await page.fill('#tk-texto', 'Vamos para allá');
  await page.click('#tk-enviar');
  await page.waitForFunction(() => !!window.__abierto);
  const url = await page.evaluate(() => window.__abierto);
  ok(decodeURIComponent(url).includes('Vamos para allá') && url.includes('wa.me/34612345678'), 'ficha: abre WhatsApp con el texto');
  await page.waitForFunction(() => document.querySelector('.tk-respuesta > small')?.textContent.includes('enviada'));
  ok(base.db.ticket_comentarios.find(c => c.texto === 'Vamos para allá')?.canal === 'whatsapp', 'ficha: queda como enviada por WhatsApp');

  // ── Bandeja ──────────────────────────────────────────────────────────────
  await page.goto(`${srv.base}/#/tickets/bandeja`);
  await page.waitForSelector('.tk-correo');
  ok((await page.textContent('main')).includes('info@ok.test') && await page.locator('.tk-correo').count() === 3, 'bandeja: estado del buzón y correos por revisar');
  await page.fill('#tk-a-e2', '51');
  await page.click('form[data-on-submit="tkCorreoATicket:e2"] button[type=submit]');
  await toastCon(page, 'Añadido al ticket #51');
  ok(base.db.ticket_comentarios.some(c => c.ticket_id === T2 && c.tipo === 'cliente' && c.email_id === 'g8') && base.db.correos_entrantes.find(e => e.id === 'e2').estado === 'comentario'
    && base.db.tickets.find(t => t.id === T2).email_hilo === 'h8', 'bandeja: añadir a un ticket (y queda enlazado al hilo)');
  await page.waitForSelector('[data-action="tkDescartar"][data-p0="e3"]');
  await page.click('[data-action="tkDescartar"][data-p0="e3"]');
  await page.waitForFunction(() => document.querySelectorAll('.tk-correo').length === 1);
  ok(base.db.correos_entrantes.find(e => e.id === 'e3').estado === 'descartado', 'bandeja: descartar');
  await page.click('[data-action="tkDeCorreo"][data-p0="e1"]');
  await page.waitForSelector('.tk-conversacion');
  const deCorreo = base.db.tickets.find(t => t.titulo === 'Presupuesto cámaras');
  ok(deCorreo?.email_hilo === 'h9' && deCorreo.email_de === 'nuevo@y.test' && base.db.correos_entrantes.find(e => e.id === 'e1').estado === 'ticket', 'bandeja: crear ticket desde un correo');

  // ── Ajustes ──────────────────────────────────────────────────────────────
  await page.goto(`${srv.base}/#/tickets/ajustes`);
  await page.waitForSelector('input[name="r-urgente"]');
  const nueva = page.locator('form[data-on-submit="tkGuardarPlantilla:$this"]').last();
  await nueva.locator('input[name="titulo"]').fill('Visita');
  await nueva.locator('textarea[name="texto"]').fill('Pasamos mañana, {{contacto}}.');
  await nueva.locator('button[type=submit]').click();
  await toastCon(page, 'Plantilla guardada');
  ok(base.db.plantillas_respuesta.some(p => p.titulo === 'Visita'), 'ajustes: plantilla nueva');
  await page.waitForSelector('input[name="r-urgente"]');
  await page.fill('input[name="r-urgente"]', '1');
  await page.click('form[data-on-submit="tkGuardarSla"] button[type=submit]');
  await toastCon(page, 'SLA guardado');
  ok(base.db.sla_politicas.find(s => s.prioridad === 'urgente').respuesta_min === 60, 'ajustes: un admin cambia el SLA');
  ok(A.errores.length === 0, `admin: sin errores JS${A.errores.length ? ': ' + A.errores.join(' | ') : ''}`);
  await A.ctx.close();

  // ── Técnico ──────────────────────────────────────────────────────────────
  const T = await contexto(browser, 'tito@ok.test');
  await T.page.goto(`${srv.base}/#/tickets`);
  await T.page.waitForSelector('.tk-tabla');
  await T.page.click('[data-action="tkVista"][data-p0="mios"]');
  await T.page.waitForFunction(() => document.querySelectorAll('.tk-tabla tbody tr').length === 1);
  ok((await T.page.textContent('.tk-tabla')).includes('Sin internet'), 'técnico: «Míos» por su nombre');
  await T.page.goto(`${srv.base}/#/tickets/51`);
  await T.page.waitForSelector('.tk-conversacion');
  ok(await T.page.locator('[data-action="tkBorrar"]').count() === 0, 'técnico: no borra tickets');
  await T.page.goto(`${srv.base}/#/tickets/ajustes`);
  await T.page.waitForSelector('input[name="r-urgente"]');
  ok(await T.page.locator('input[name="r-urgente"]').isDisabled(), 'técnico: ve el SLA pero no lo cambia');
  ok(T.errores.length === 0, 'técnico: sin errores JS');
  await T.ctx.close();

  // ── Página pública de valoración ─────────────────────────────────────────
  const V = await contexto(browser, null);
  await V.page.goto(`${srv.base}/valorar.html?t=${TOK}`);
  await V.page.waitForSelector('[data-n="4"]');
  ok((await V.page.textContent('#que')).includes('Impresora <b>x</b>'), 'valorar: enseña el ticket (texto, sin HTML)');
  await V.page.click('[data-n="4"]');
  await V.page.fill('#comentario', 'Muy rápidos');
  await V.page.click('#enviar');
  await V.page.waitForSelector('h1.ok');
  const envio = V.fn.find(f => f.nombre === 'ticket-valorar' && f.nota);
  ok(envio?.nota === 4 && envio.comentario === 'Muy rápidos' && envio.token === TOK, 'valorar: manda la nota con el token');
  ok(V.errores.length === 0, 'valorar: sin errores JS');
  await V.ctx.close();

  // ── Móvil ────────────────────────────────────────────────────────────────
  const M = await contexto(browser, 'ana@ok.test', { width: 390, height: 844 });
  for (const [ruta, sel] of [['tickets', '.tk-tabla'], ['tickets/50', '.tk-conversacion'], ['tickets/nuevo', '#tk-titulo'], ['tickets/bandeja', '.tk-correo'], ['tickets/ajustes', 'input[name="r-urgente"]']]) {
    await M.page.goto(`${srv.base}/#/${ruta}`);
    await M.page.waitForSelector(sel);
    const ancho = await M.page.evaluate(() => document.documentElement.scrollWidth);
    ok(ancho <= 390, `móvil ${ruta}: sin scroll horizontal (${ancho}px)`);
  }
  await M.page.goto(`${srv.base}/valorar.html?t=${TOK}`);
  await M.page.waitForSelector('[data-n="5"]');
  ok(await M.page.evaluate(() => document.documentElement.scrollWidth) <= 390, 'móvil valorar: sin scroll horizontal');
  ok(M.errores.length === 0, 'móvil: sin errores JS');
  await M.ctx.close();
} catch (e) { console.error('✗ excepción:', e); sumar(); }
finally { await browser.close(); srv.parar(); }
console.log(fallos() ? `\n${fallos()} fallo(s)` : '\nTodo bien');
process.exit(fallos() ? 1 : 0);
