// Arnés de WhatsApp completo (paridad bloque 5, tanda 1).
// Cubre, en la ventana fija: chip del plan de la sede (y el pago torcido),
// enlaces a la ficha, foto en la conversación y «Ver foto» pedida a Meta,
// «Remoto» (varios equipos → se elige), «Ticket» (alta rellena con cliente,
// sede, contacto y el último texto del cliente), «Presupuesto» (desde la sede)
// y «Factura / presupuesto» (lista del cliente → se manda el PDF); sin cliente,
// solo lo que vale. En #/tickets/whatsapp: texto → parse-whatsapp → sede
// reconocida por teléfono → ticket relleno; trabajo con la fecha que pide el
// cliente; IA caída → análisis de reserva y cliente por nombre; captura →
// la función recibe la imagen y lo leído vuelve al campo. Sin datos reales.
//   npm run build && node .claude/skills/verify/verify-whatsapp.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS, SB } from './comun.mjs';

const { ok, fallos } = contador();
const srv = await servidor(4197);
const ahora = Date.now();
const iso = ms => new Date(ms).toISOString();

const INICIAL = {
  usuarios: [{ id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true }],
  areas: [], ticket_comentarios: [],
  tickets: [{ id: 'tk9', numero: 5009, titulo: 'Datáfono sin conexión', estado: 'Abierto', prioridad: 'Media', canal: 'whatsapp', created_at: iso(ahora - 3600e3),
    sla_respuesta_at: iso(ahora + 3600e3), sla_resolucion_at: iso(ahora + 86400e3), cliente_id: 'cl1', local_id: 'l1' }],
  ticket_adjuntos: [
    { id: 'ad1', ticket_id: 'tk9', nombre: 'Foto WhatsApp 04/10/26 9:15', drive_url: 'https://ejemplo.test/datafono.jpg', mime_type: 'image/jpeg', usuario: 'WhatsApp · Marta', created_at: iso(ahora - 3500e3) },
    { id: 'ad2', ticket_id: 'tk9', nombre: 'Factura.pdf', drive_url: 'https://ejemplo.test/f.pdf', mime_type: 'application/pdf', usuario: 'WhatsApp · Marta', created_at: iso(ahora - 3400e3) },
  ], plantillas_respuesta: [], trabajos: [], presupuestos: [], presupuesto_plantillas: [],
  clientes: [
    { id: 'cl1', nombre: 'Restaurante Costa SL', nif: 'B11111111', telefono: '922000001', activo: true },
    { id: 'cl2', nombre: 'Bar Manolo', nif: 'B22222222', telefono: '922000002', activo: true },
  ],
  locales: [
    { id: 'l1', nombre: 'Costa Adeje', direccion: 'Av. del Mar 1', cliente_id: 'cl1', activo: true, plan: 'Silver', estado_pago: 'Pendiente de pago' },
    { id: 'l2', nombre: 'Bar Manolo Centro', direccion: 'C/ Real 3', cliente_id: 'cl2', activo: true, plan: null },
  ],
  local_telefonos: [{ id: 'lt1', local_id: 'l1', numero: '600 111 222' }],
  contactos: [{ id: 'k1', nombre: 'Marta Costa', email: 'marta@costa.test', telefono: '600111222', cliente_id: 'cl1', local_id: 'l1', activo: true, favorito: true }],
  local_hardware: [
    { id: 'h1', local_id: 'l1', nombre: 'TPV Barra', tipo: 'TPV', anydesk_id: '111 222 333' },
    { id: 'h2', local_id: 'l1', nombre: 'Servidor', tipo: 'PC', anydesk_id: '444555666' },
  ],
  local_software: [], rmm_equipos: [], rmm_despliegues: [],
};

const CONVS = [
  { id: 'c1', telefono: '34600111222', nombre: 'Restaurante Costa SL', perfil: 'Marta', sede: 'Costa Adeje', cliente_id: 'cl1', local_id: 'l1', contacto_id: 'k1',
    ticket: null, ultimo: 'La impresora no va', ultimo_at: iso(ahora - 600e3), ultimo_entrante_at: iso(ahora - 600e3), sin_leer: 0, pendiente: true, ventana: true },
  { id: 'c2', telefono: '34600999888', nombre: '+34600999888', perfil: null, sede: null, cliente_id: null, local_id: null, contacto_id: null,
    ticket: null, ultimo: 'Hola', ultimo_at: iso(ahora - 900e3), ultimo_entrante_at: iso(ahora - 900e3), sin_leer: 0, pendiente: true, ventana: true },
];
const msg = (id, o) => ({ id, created_at: iso(ahora - 700e3), direccion: 'entrante', tipo: 'text', texto: null, media_id: null, media_url: null, media_nombre: null,
  media_descripcion: null, estado: 'recibido', error: null, usuario: null, automatico: false, ...o });
const MSGS = {
  c1: [
    msg('m1', { texto: 'La impresora de cocina no va' }),
    msg('m2', { tipo: 'image', media_url: 'https://ejemplo.test/foto.jpg', media_descripcion: 'Una impresora con luz roja' }),
    msg('m3', { tipo: 'image', media_id: '987654', texto: null }),
  ],
  c2: [msg('m4', { texto: 'Hola' })],
};
const llamadas = [];
const resp = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
async function waFalso(route) {
  const b = JSON.parse(route.request().postData() || '{}');
  llamadas.push({ fn: 'whatsapp', ...b });
  if (b.accion === 'estado') return resp(route, { envio: true, claude: false, plantilla: false });
  if (b.accion === 'conversaciones') return resp(route, { conversaciones: CONVS, envio: true, plantilla: false });
  if (b.accion === 'mensajes') {
    const c = CONVS.find(x => x.id === b.conversacion_id);
    return resp(route, { conversacion: { ...c, plan: c.local_id === 'l1' ? 'Silver' : null, estado_pago: c.local_id === 'l1' ? 'Pendiente de pago' : null }, mensajes: MSGS[b.conversacion_id] });
  }
  if (b.accion === 'leida') return resp(route, { ok: true });
  if (b.accion === 'media') return resp(route, { data_url: 'data:image/png;base64,iVBORw0KGgo=', mime: 'image/png' });
  if (b.accion === 'meta_conector_estado') return resp(route, { ok: true, registrado: true, base_url: 'https://gaksrtxgnuuuvhvgwxue.supabase.co/functions/v1/meta-agente-mcp',
    conexion: { status: 'CONNECTED' }, herramientas: { status: 'SYNCED', tool_count: 7 }, skills: [{ title: 'identidad-y-tono', status: 'active' }, { title: 'facturas-y-presupuestos', status: 'blocked' }] });
  if (b.accion === 'meta_conector') return resp(route, { ok: false, error: 'El WhatsApp se lleva en la app hasta el cambio: el conector se registra desde su bandeja.' }, 409);
  if (b.accion === 'documentos') return resp(route, { documentos: [{ tipo: 'factura', id: '5001', numero: 'F26-0001' }, { tipo: 'presupuesto', id: '6001', numero: 'P-0007' }], plantilla: false });
  if (b.accion === 'enviar_documento') {
    const m = msg('m9', { direccion: 'saliente', tipo: 'document', texto: '📎 Factura F26-0001 de Ok Computer Tenerife', estado: 'enviado', usuario: 'Ana Admin', created_at: new Date().toISOString() });
    MSGS[b.conversacion_id].push(m);
    return resp(route, { ok: true, mensaje: m });
  }
  return resp(route, {}, 400);
}

// parse-whatsapp falsa: lo que «resume la IA» lo decide la prueba.
let analisis = null;
async function parseFalso(route) {
  const b = JSON.parse(route.request().postData() || '{}');
  llamadas.push({ fn: 'parse-whatsapp', ...b });
  if (!analisis) return resp(route, { error: 'El análisis automático no está configurado todavía.' }, 503);
  return resp(route, analisis);
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const browser = await navegador();
let page;
// La pantalla, recién pintada (ir a la misma URL no vuelve a pintarla).
async function abrirDesde() {
  await page.evaluate(() => { location.hash = '#/tickets'; });
  await page.waitForSelector('a[href="#/tickets/whatsapp"]');
  await page.evaluate(() => { location.hash = '#/tickets/whatsapp'; });
  await page.waitForSelector('#wai-texto');
}
try {
  const base = baseMemoria(INICIAL, {});
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
  await preparar(ctx, { email: 'ana@ok.test', base });
  await ctx.route(`${SB}/functions/v1/whatsapp`, waFalso);
  await ctx.route(`${SB}/functions/v1/parse-whatsapp`, parseFalso);
  // Los anydesk:// y compañía no se abren de verdad: se apuntan.
  await ctx.addInitScript(() => {
    const abrir = window.open.bind(window);
    window.__abiertos = [];
    window.open = (u, ...r) => { if (u) { window.__abiertos.push(String(u)); return null; } return abrir(u, ...r); };
  });
  page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e.stack ?? e)));
  page.on('dialog', d => d.accept());
  await page.goto(`${srv.base}/#/tickets`);
  await page.waitForSelector('a[href="#/tickets/whatsapp"]');
  ok(true, 'tickets: botón «Desde WhatsApp»');

  // ── La ventana fija ──────────────────────────────────────────────────────
  await page.click('#wa-cab');
  await page.waitForSelector('.wa-fila');
  await page.click('.wa-fila >> nth=0');
  await page.waitForFunction(() => document.getElementById('wa-atajos')?.textContent?.includes('Silver'));
  const atajos = await page.textContent('#wa-atajos');
  ok(atajos.includes('Silver') && atajos.includes('Pendiente de pago'), 'chip del plan de la sede y el pago torcido');
  ok(await page.locator('#wa-atajos a[href="#/clientes/cl1"]').count() === 1 && await page.locator('#wa-atajos a[href="#/sitios/l1"]').count() === 1, 'enlaces a la ficha del cliente y de la sede');
  await page.waitForSelector('#wa-msgs img.wa-foto');
  ok(await page.getAttribute('#wa-msgs img.wa-foto', 'src') === 'https://ejemplo.test/foto.jpg' && (await page.textContent('#wa-msgs')).includes('luz roja'), 'la foto con copia se ve en la conversación, con su descripción');
  const popup = ctx.waitForEvent('page');
  await page.click('[data-action="waMedia"]');
  const pp = await popup;
  await pp.waitForSelector('img');
  ok(llamadas.some(l => l.accion === 'media' && l.mensaje_id === 'm3' && l.conversacion_id === 'c1'), '«Ver foto» sin copia: se pide a Meta por el mensaje');
  await pp.close();

  // Remoto: dos AnyDesk → se elige
  await page.click('[data-action="waRemoto"]');
  await page.waitForSelector('#wa-panel [data-action="waRemotoAbrir"]');
  ok(await page.locator('#wa-panel [data-action="waRemotoAbrir"]').count() === 2, 'Remoto: dos equipos → se elige');
  await page.click('#wa-panel [data-action="waRemotoAbrir"] >> nth=0');
  await page.waitForFunction(() => window.__abiertos.includes('anydesk://111222333'));
  ok(await page.isHidden('#wa-panel'), 'Remoto: abre AnyDesk sin espacios y cierra el panel');

  // Factura / presupuesto
  await page.click('[data-action="waDocumentos"]');
  await page.waitForSelector('#wa-panel [data-action="waMandarDoc"]');
  ok(await page.locator('#wa-panel [data-action="waMandarDoc"]').count() === 2 && (await page.textContent('#wa-panel')).includes('F26-0001'), 'documentos del cliente: factura y presupuesto');
  await page.click('#wa-panel [data-action="waMandarDoc"] >> nth=0');
  await page.waitForFunction(() => document.getElementById('wa-msgs')?.textContent?.includes('📎 Factura F26-0001'));
  const env = llamadas.find(l => l.accion === 'enviar_documento');
  ok(env?.tipo === 'factura' && env?.zoho_id === '5001' && env?.conversacion_id === 'c1', 'mandar la factura: tipo, id de Zoho y conversación');

  // Ticket desde la conversación
  await page.click('[data-action="waTicket"]');
  await page.waitForFunction(() => location.hash === '#/tickets/nuevo');
  await page.waitForFunction(() => document.querySelector('#tk-local option[value="l1"]')?.selected);
  ok(await page.inputValue('#tk-titulo') === 'La impresora de cocina no va' && await page.inputValue('#tk-descripcion') === 'La impresora de cocina no va', 'ticket: título y detalle con el último texto del cliente');
  ok(await page.inputValue('#tk-cliente') === 'cl1' && await page.inputValue('#tk-cliente-q') === 'Restaurante Costa SL', 'ticket: cliente puesto');
  ok(await page.inputValue('#tk-contacto') === 'k1' && await page.inputValue('#tk-canal') === 'whatsapp' && await page.inputValue('#tk-email') === 'marta@costa.test', 'ticket: contacto, canal WhatsApp y su correo');
  await page.click('form[data-on-submit="tkCrear"] button[type="submit"]');
  await page.waitForFunction(() => /^#\/tickets\/\d+$/.test(location.hash));
  const tk = base.db.tickets.at(-1);
  ok(tk?.local_id === 'l1' && tk?.canal === 'whatsapp' && tk?.contacto_id === 'k1', 'ticket creado con sede, contacto y canal');

  // Presupuesto desde la sede
  await page.click('[data-action="waPresupuesto"]');
  await page.waitForFunction(() => location.hash === '#/presupuestos/nuevo/l/l1');
  await page.waitForSelector('#pf-sede');
  ok(await page.inputValue('#pf-cliente') === 'cl1' && await page.inputValue('#pf-sede') === 'l1', 'presupuesto: cliente y sede de la conversación');

  // Sin cliente: solo lo que vale
  await page.click('[data-action="waVolver"]');
  await page.click('.wa-fila >> nth=1');
  await page.waitForFunction(() => document.getElementById('wa-atajos')?.textContent?.includes('Sin cliente'));
  ok(await page.locator('#wa-atajos [data-action="waPresupuesto"], #wa-atajos [data-action="waDocumentos"], #wa-atajos [data-action="waRemoto"]').count() === 0
    && await page.locator('#wa-atajos [data-action="waTicket"]').count() === 1, 'sin cliente: «Sin cliente» y solo el ticket');
  await page.screenshot({ path: `${CAPTURAS}/whatsapp-ventana.png` });

  // Agente de Meta (admin): dónde apunta y, sin el cambio, no se repunta
  await page.click('[data-action="waVolver"]');
  await page.click('[data-action="waAgente"]');
  await page.waitForSelector('.wa-agente');
  const ag = await page.textContent('.wa-agente');
  ok(ag.includes('Apunta a la app') && ag.includes('SYNCED') && ag.includes('bloqueada'), 'Agente de Meta: estado del conector (apunta a la app) y sus skills');
  await page.click('[data-action="waAgenteActualizar"]');
  await page.waitForFunction(() => document.body.textContent.includes('se lleva en la app hasta el cambio'));
  ok(llamadas.some(l => l.accion === 'meta_conector'), 'Agente de Meta: sin el cambio de WhatsApp, repuntarlo lo rechaza la función y se dice');
  await page.click('[data-action="waAgenteVolver"]');
  await page.waitForSelector('.wa-fila');
  await page.click('#wa-cab');

  // ── Adjuntos del ticket (los que cuelga el webhook) ──────────────────────
  await page.goto(`${srv.base}/#/tickets/5009`);
  await page.waitForSelector('.tk-adjuntos');
  ok(await page.locator('.tk-adjuntos li').count() === 2 && await page.getAttribute('.tk-adjuntos img', 'src') === 'https://ejemplo.test/datafono.jpg'
    && await page.locator('.tk-adjuntos img').count() === 1, 'ficha del ticket: adjuntos, la foto en miniatura y el PDF como enlace');

  // ── #/tickets/whatsapp ───────────────────────────────────────────────────
  analisis = { tipo: 'ticket', titulo: 'Impresora de cocina sin imprimir', descripcion: 'La impresora de cocina no imprime los pedidos.', prioridad: 'Alta',
    remitente: 'Marta', telefono: '600 111 222', cliente: '', fecha: '', hora: '', texto: '' };
  await abrirDesde();
  await page.fill('#wai-texto', 'Hola, la impresora de cocina no imprime');
  await page.click('#wai-analizar');
  await page.waitForSelector('.wai-cand');
  ok((await page.textContent('.wai-cand >> nth=0')).includes('Costa Adeje') && (await page.textContent('.wai-cand >> nth=0')).includes('teléfono del sitio'), 'sede reconocida por el teléfono, la primera');
  ok(await page.inputValue('#wai-titulo') === 'Impresora de cocina sin imprimir' && await page.inputValue('#wai-prioridad') === 'Alta', 'resumen: título y prioridad de la IA');
  await page.click('[data-action="waiContinuar"]');
  await page.waitForFunction(() => location.hash === '#/tickets/nuevo');
  await page.waitForFunction(() => document.querySelector('#tk-local option[value="l1"]')?.selected);
  const desc = await page.inputValue('#tk-descripcion');
  ok(desc.includes('no imprime los pedidos') && desc.includes('— Mensaje original (WhatsApp) —') && desc.includes('Hola, la impresora'), 'ticket: descripción con el mensaje original');
  ok(await page.inputValue('#tk-prioridad') === 'Alta' && await page.inputValue('#tk-cliente') === 'cl1', 'ticket: prioridad y cliente de la sede');

  // Trabajo con fecha
  analisis = { ...analisis, tipo: 'trabajo', titulo: 'Instalar cámara en la entrada', fecha: '2026-10-10', hora: '10:00' };
  await abrirDesde();
  await page.fill('#wai-texto', 'Queremos poner una cámara el sábado 10 a las 10');
  await page.click('#wai-analizar');
  await page.waitForSelector('#wai-cuando');
  ok((await page.textContent('#wai-cuando')).includes('2026-10-10 10:00') && await page.getAttribute('#wai-tipo-trabajo', 'aria-checked') === 'true', 'trabajo: lo propone la IA y avisa de la fecha');
  await page.click('[data-action="waiContinuar"]');
  await page.waitForFunction(() => location.hash === '#/trabajos/nuevo');
  await page.waitForSelector('#tf-titulo');
  ok(await page.inputValue('#tf-titulo') === 'Instalar cámara en la entrada' && await page.inputValue('#tf-fecha') === '2026-10-10' && await page.inputValue('#tf-hora') === '10:00', 'trabajo: título, fecha y hora');
  ok(await page.inputValue('#tf-cliente') === 'cl1' && await page.inputValue('#tf-local') === 'l1', 'trabajo: cliente y sede');

  // IA caída → análisis de reserva y cliente por nombre
  analisis = null;
  await abrirDesde();
  await page.fill('#wai-texto', '[12/7/26, 9:15] Bar Manolo: hola\n[12/7/26, 9:16] Bar Manolo: la impresora de cocina no imprime, urgente');
  await page.click('#wai-analizar');
  await page.waitForSelector('#wai-titulo');
  ok(await page.inputValue('#wai-titulo') === 'la impresora de cocina no imprime, urgente' && await page.inputValue('#wai-prioridad') === 'Alta', 'reserva: salta el saludo y lo urgente sube la prioridad');
  ok((await page.textContent('#wai-estado')).includes('IA no disponible'), 'reserva: lo dice');
  ok((await page.textContent('#wai-candidatos')).includes('Bar Manolo'), 'reserva: cliente por el remitente');

  // Captura
  analisis = { tipo: 'ticket', titulo: 'TPV bloqueado', descripcion: 'El TPV se queda bloqueado.', prioridad: 'Media', remitente: 'Bar Manolo', telefono: '', cliente: 'Bar Manolo', fecha: '', hora: '',
    texto: 'Hola\nEl TPV se queda bloqueado' };
  await abrirDesde();
  await page.setInputFiles('#wai-file', { name: 'captura.png', mimeType: 'image/png', buffer: PNG });
  await page.waitForSelector('#wai-titulo');
  const pc = llamadas.filter(l => l.fn === 'parse-whatsapp').at(-1);
  ok(/^data:image\/jpeg;base64,/.test(pc?.imagen ?? ''), 'captura: la función recibe la imagen reescalada');
  ok(await page.inputValue('#wai-texto') === 'Hola\nEl TPV se queda bloqueado' && await page.isVisible('#wai-captura'), 'captura: lo leído vuelve al campo y se ve la captura');
  await page.screenshot({ path: `${CAPTURAS}/whatsapp-desde.png`, fullPage: true });

  ok(!errores.length, `sin errores JS${errores.length ? ': ' + errores.join(' | ') : ''}`);

  // ── En el móvil: a pantalla completa y «Enviar» siempre a la vista ─────
  // (paridad con el arreglo de la bandeja de la app del 2026-10-07)
  const ctxM = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 760 }, isMobile: true, hasTouch: true });
  await preparar(ctxM, { email: 'ana@ok.test', base });
  await ctxM.route(`${SB}/functions/v1/whatsapp`, waFalso);
  const pm = await ctxM.newPage();
  const erroresM = [];
  pm.on('pageerror', e => erroresM.push(String(e.stack ?? e)));
  await pm.goto(`${srv.base}/#/tickets`);
  await pm.waitForSelector('#wa-cab');
  await pm.click('#wa-cab');
  await pm.waitForSelector('.wa-fila');
  await pm.click('.wa-fila >> nth=0');
  await pm.waitForSelector('#wa-env', { state: 'visible' });
  await pm.waitForTimeout(600);
  const caja = await pm.locator('#wa').boundingBox();
  ok(caja && Math.round(caja.x) === 0 && Math.round(caja.y) === 0 && Math.round(caja.width) === 390 && Math.round(caja.height) === 760, `móvil: la ventana abierta ocupa la pantalla (${JSON.stringify(caja)})`);
  const envM = await pm.locator('#wa-env').boundingBox();
  ok(envM && envM.y + envM.height <= 760 && envM.height >= 44, 'móvil: «Enviar» dentro de la pantalla y de 44 px');
  ok(await pm.$eval('#wa-in', el => getComputedStyle(el).fontSize) === '16px', 'móvil: el cuadro a 16 px (sin zoom de iOS)');
  const cabAlto = await pm.$eval('#wa-convcab', el => el.getBoundingClientRect().height) + await pm.$eval('#wa-atajos', el => el.getBoundingClientRect().height);
  ok(cabAlto < 140, `móvil: cabecera y atajos no se comen la pantalla (${Math.round(cabAlto)} px)`);
  // Teclado abierto: la pantalla visible encoge y «Enviar» sigue a la vista.
  await pm.setViewportSize({ width: 390, height: 420 });
  await pm.waitForTimeout(600);
  const env2 = await pm.locator('#wa-env').boundingBox();
  ok(env2 && env2.y + env2.height <= 420, `móvil: con menos alto (teclado), «Enviar» sigue a la vista (${env2 && Math.round(env2.y + env2.height)})`);
  await pm.screenshot({ path: `${CAPTURAS}/whatsapp-movil.png` });
  await pm.click('#wa-cab');
  ok(await pm.$eval('#wa', el => el.style.height === '' && el.classList.contains('cerrado')), 'móvil: al plegarla vuelve a la barra');
  ok(!erroresM.length, `móvil: sin errores JS${erroresM.length ? ': ' + erroresM.join(' | ') : ''}`);
} finally {
  await browser.close();
  srv.parar();
}
if (!fallos()) console.log('\nTodo bien');
process.exit(fallos() ? 1 : 0);
