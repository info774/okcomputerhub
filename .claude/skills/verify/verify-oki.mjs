// Arnés de la portada de Oki y del chat de WhatsApp fijo.
// Cubre: portada con el diagrama (6 áreas con su dato), estadísticas de la
// semana (SLA, cerrados por día), «Oki dice» y «Necesita a una persona» desde
// panorama_direccion, baldosas debajo; chat plegado al entrar, abrir, leer una
// conversación (marca leída), usar la propuesta de Oki y enviar; ventana de 24 h
// cerrada → caja bloqueada y «Mandar plantilla»; el chat sigue en otra pantalla.
// Lo que se añadió del tablero (2026-10-03): cabecera con el estado del sync y
// la campana, «Trabajos completados», «Sí, contéstalo» (Oki redacta en el
// ticket), la voz (pregunta → buscador; encargo → comanda tras confirmar con un
// micrófono de mentira), órdenes rápidas, pie con el último sync y el repaso
// de la mañana. El centro de mando (2026-10-04): barra con marca, estado del
// sistema, reloj, buscar y operador; núcleo de Oki, avisos en vivo con insignia
// (también los informativos), agentes de Oki con su estado, hoy en la agenda,
// memoria (documentos, wiki, comandas) y conexiones. Sin datos reales.
//   npm run build && node .claude/skills/verify/verify-oki.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS, SB } from './comun.mjs';

const { ok, fallos } = contador();
const srv = await servidor(4193);
const ahora = Date.now();
const iso = ms => new Date(ms).toISOString();
const hoy0 = new Date().setHours(0, 0, 0, 0), hoy24 = hoy0 + 86400e3;
const lunes = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); })();

const INICIAL = {
  usuarios: [{ id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true }],
  areas: [], proyectos: [], proyecto_tareas: [],
  sync_estado: [{ clave: 'audit', ultima_ok: iso(ahora - 5 * 60e3), ultimo_error_at: null },
    { clave: 'zoho', ultima_ok: iso(ahora - 20 * 60e3), ultimo_error_at: null },
    { clave: 'correo', ultima_ok: iso(ahora - 60e3), ultimo_error_at: iso(ahora) , ultimo_error: 'falló' }],
  sesiones: [{ id: 's1', entidad_tipo: 'trabajo', entidad_id: 'w1', fin: iso(ahora - 3600e3) }, { id: 's2', entidad_tipo: 'trabajo', entidad_id: 'w2', fin: iso(ahora - 3600e3) },
    { id: 's3', entidad_tipo: 'trabajo', entidad_id: 'w3', fin: iso(lunes - 86400e3) }],
  trabajos: [{ id: 'w1', numero: 1, estado: 'Completado' }, { id: 'w2', numero: 2, estado: 'En progreso' }, { id: 'w3', numero: 3, estado: 'Facturado' }],
  clientes: [], ticket_comentarios: [], plantillas_respuesta: [],
  // Paneles del centro de mando
  // Anclados al día de HOY (no a «ahora ± horas»): cerca de la medianoche se
  // salían del día y el arnés fallaba según la hora a la que corriera.
  agenda: [
    { id: 'b1', trabajo_id: 'w1', titulo: 'Revisión TPV Costa Adeje', inicio: iso(hoy0 + 60e3), fin: iso(hoy0 + 120e3), tecnicos: ['Matteo'], estado: 'Completado', todo_el_dia: false },
    { id: 'b2', trabajo_id: 'w2', titulo: 'Cambiar router La Laguna', inicio: iso(ahora - 600e3), fin: iso(Math.min(ahora + 3000e3, hoy24 - 120e3)), tecnicos: ['Ana'], estado: 'En progreso', todo_el_dia: false },
    { id: 'b3', trabajo_id: null, titulo: 'Reunión con proveedor', inicio: iso(Math.min(ahora + 2 * 3600e3, hoy24 - 90e3)), fin: iso(Math.min(ahora + 3 * 3600e3, hoy24 - 60e3)), tecnicos: [], estado: null, todo_el_dia: false },
    { id: 'b4', trabajo_id: 'w3', titulo: 'Ayer', inicio: iso(ahora - 30 * 3600e3), fin: iso(ahora - 29 * 3600e3), tecnicos: [], estado: null, todo_el_dia: false },
  ],
  claude_peticiones: [{ id: 'cp1', estado: 'en_curso' }, { id: 'cp2', estado: 'pendiente' }, { id: 'cp3', estado: 'hecha' }],
  documentos: [
    { id: 'd1', estado: 'indexado', fragmentos: 12, indexado_at: iso(ahora - 86400e3) },
    { id: 'd2', estado: 'indexado', fragmentos: 8, indexado_at: iso(ahora - 3 * 86400e3) },
    { id: 'd3', estado: 'pendiente', fragmentos: 0, indexado_at: null },
  ],
  paginas: [{ id: 'p1', archivada: false }, { id: 'p2', archivada: false }, { id: 'p3', archivada: true }],
  comanda_tareas: [{ id: 'ct1', estado: 'hecha', hecha_at: iso(ahora - 3600e3) }, { id: 'ct2', estado: 'pendiente', hecha_at: null }],
  telegram_vinculos: [{ usuario_id: 'u-ana', chat_id: 123, activo: true }],
  informes_programados: [{ id: 'ip1', activo: true }, { id: 'ip2', activo: false }],
  rmm_equipos: [{ id: 'e1', conectado: true }, { id: 'e2', conectado: true }, { id: 'e3', conectado: false }],
  rmm_alertas: [],
  tickets: [
    { id: 't1', estado: 'Cerrado', created_at: iso(lunes + 3600e3), cerrado_at: iso(lunes + 7200e3), sla_respuesta_at: iso(lunes + 9000e3), primera_respuesta_at: iso(lunes + 5000e3) },
    { id: 't2', estado: 'Cerrado', created_at: iso(lunes + 3600e3), cerrado_at: iso(lunes + 9000e3), sla_respuesta_at: iso(lunes + 4000e3), primera_respuesta_at: iso(lunes + 8000e3) },
    { id: 't3', numero: 5031, titulo: 'TPV no enciende', estado: 'Abierto', created_at: iso(ahora - 3600e3), cerrado_at: null, sla_respuesta_at: iso(ahora + 3600e3), primera_respuesta_at: null },
  ],
};
const RPC = {
  panorama_direccion: () => [
    { clave: 'a1', tipo: 'ticket_sin_asignar', gravedad: 'mal', titulo: 'Ticket #5031 sin respuesta', detalle: 'Lleva 3 h', importe: null, enlace: '#/tickets/5031', fecha: null, persona: null, dinero: false },
    { clave: 'a2', tipo: 'alerta_rmm', gravedad: 'aviso', titulo: 'TPV-Barra sin conexión', detalle: 'Desde las 9:40', importe: null, enlace: null, fecha: null, persona: null, dinero: false },
    { clave: 'a3', tipo: 'hito_vencido', gravedad: 'info', titulo: 'Algo informativo', detalle: null, importe: null, enlace: null, fecha: null, persona: null, dinero: false },
  ],
};

// La función `whatsapp` falsa: dos conversaciones (una en ventana, otra fuera).
const CONVS = [
  { id: 'c1', telefono: '34600000001', nombre: 'Restaurante Costa', perfil: null, sede: 'Costa Adeje', ticket: { id: 't3', numero: 5031, estado: 'Abierto' },
    ultimo: 'Nos urge', ultimo_at: iso(ahora - 600e3), ultimo_entrante_at: iso(ahora - 600e3), sin_leer: 2, pendiente: true, ventana: true },
  { id: 'c2', telefono: '34600000002', nombre: 'Oficina Laguna', perfil: null, sede: null, ticket: null,
    ultimo: 'Lo miramos', ultimo_at: iso(ahora - 30 * 3600e3), ultimo_entrante_at: iso(ahora - 31 * 3600e3), sin_leer: 0, pendiente: false, ventana: false },
];
const MSGS = { c1: [
  { id: 'm1', created_at: iso(ahora - 700e3), direccion: 'entrante', tipo: 'text', texto: 'El TPV no enciende', media_url: null, media_nombre: null, media_descripcion: null, estado: 'recibido', error: null, usuario: null, automatico: false },
  { id: 'm2', created_at: iso(ahora - 600e3), direccion: 'entrante', tipo: 'text', texto: 'Nos urge', media_url: null, media_nombre: null, media_descripcion: null, estado: 'recibido', error: null, usuario: null, automatico: false },
], c2: [
  { id: 'm3', created_at: iso(ahora - 31 * 3600e3), direccion: 'entrante', tipo: 'text', texto: '¿Revisáis el servidor?', media_url: null, media_nombre: null, media_descripcion: null, estado: 'recibido', error: null, usuario: null, automatico: false },
] };
const llamadas = [];
async function waFalso(route) {
  const b = JSON.parse(route.request().postData() || '{}');
  llamadas.push(b);
  const r = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  if (b.accion === 'estado') return r({ envio: true, claude: true, plantilla: true });
  if (b.accion === 'conversaciones') return r({ conversaciones: CONVS, envio: true, plantilla: true });
  if (b.accion === 'plantilla') {
    const m = { id: 'm8', created_at: new Date().toISOString(), direccion: 'saliente', tipo: 'template', texto: '📨 Plantilla «retomar_conversacion» para retomar la conversación', media_url: null, media_nombre: null, media_descripcion: null, estado: 'enviado', error: null, usuario: 'Ana Admin', automatico: false };
    MSGS[b.conversacion_id].push(m);
    return r({ ok: true, mensaje: m });
  }
  if (b.accion === 'mensajes') return r({ conversacion: CONVS.find(c => c.id === b.conversacion_id), mensajes: MSGS[b.conversacion_id] });
  if (b.accion === 'leida') { CONVS[0].sin_leer = 0; return r({ ok: true }); }
  if (b.accion === 'proponer') return r({ propuesta: 'Hola, ya lo estamos viendo y te decimos algo enseguida.' });
  if (b.accion === 'enviar') {
    const m = { id: 'm9', created_at: new Date().toISOString(), direccion: 'saliente', tipo: 'text', texto: b.texto, media_url: null, media_nombre: null, media_descripcion: null, estado: 'enviado', error: null, usuario: 'Ana Admin', automatico: false };
    MSGS[b.conversacion_id].push(m);
    return r({ ok: true, mensaje: m });
  }
  return route.fulfill({ status: 400, body: '{}' });
}

const browser = await navegador();
try {
  const base = baseMemoria(INICIAL, RPC);
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
  await preparar(ctx, { email: 'ana@ok.test', base });
  await ctx.route(`${SB}/functions/v1/whatsapp`, waFalso);
  // Voz: lo que «se dicta» lo decide la prueba; comandas crea y transcribe.
  let dictado = '¿Qué tickets tengo abiertos?';
  await ctx.route(`${SB}/functions/v1/comandas`, route => {
    const b = JSON.parse(route.request().postData() || '{}');
    llamadas.push({ fn: 'comandas', ...b });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b.accion === 'transcribir' ? { texto: dictado } : { tareas: [{}, {}], con_claude: false }) });
  });
  await ctx.route(`${SB}/functions/v1/documentos-preguntar`, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ respuesta: 'Tienes 1 ticket abierto.', fuentes: [], con_claude: false }) }));
  await ctx.route(`${SB}/functions/v1/informes-enviar`, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ texto: '<b>Buenos días, Ana</b>\nHoy tienes 2 trabajos.' }) }));
  await ctx.route(`${SB}/functions/v1/oki`, route => { llamadas.push({ fn: 'oki', ...JSON.parse(route.request().postData() || '{}') }); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ propuesta: 'Buenos días, ya estamos revisando el TPV.' }) }); });
  await ctx.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ac = new AudioContext(); const o = ac.createOscillator(); const d = ac.createMediaStreamDestination();
      o.connect(d); o.start(); return d.stream;
    };
  });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e.stack ?? e)));
  await page.goto(`${srv.base}/#/inicio`);

  // Portada
  await page.waitForSelector('.ok-escena');
  ok(await page.locator('.ok-area').count() === 6, 'portada: 6 áreas en el diagrama');
  ok(await page.isVisible('.ok-cerebro'), 'portada: Oki en el centro');
  await page.waitForFunction(() => document.getElementById('ok-dato-whatsapp')?.textContent === '1 por contestar');
  ok(true, 'área WhatsApp: 1 por contestar');
  await page.waitForSelector('.ok-titular');
  ok((await page.textContent('.ok-titular')).includes('2 tickets cerrados'), 'estadísticas: 2 tickets cerrados esta semana');
  ok((await page.textContent('.ok-med-txt b')).trim() === '67 %', 'estadísticas: SLA 67 % (2 de 3 en plazo)');
  ok((await page.textContent('.ok-med-txt small')).includes('1 fuera de plazo'), 'estadísticas: 1 fuera de plazo');
  ok(await page.locator('.ok-barra').count() === 7, 'estadísticas: 7 barras por día');
  await page.waitForSelector('.ok-dice-txt');
  ok((await page.textContent('.ok-dice-txt')).includes('2 cosas que necesitan'), 'Oki dice: 2 cosas (sin contar los informativos)');
  ok(await page.getAttribute('.ok-dice-txt a.btn', 'href') === '#/tickets/5031/responder' && await page.getAttribute('.ok-dice-txt a.btn.secundario', 'href') === '#/tickets/5031',
    'Oki dice: lo más urgente es un ticket → «Sí, contéstalo» (Oki redacta) y «Lo miro yo»');
  // Cabecera, estadística nueva, órdenes y pie
  await page.waitForFunction(() => document.querySelector('#ok-estado b')?.textContent === 'En marcha');
  ok((await page.textContent('#ok-sync')).includes('5 min'), 'cabecera «En marcha» y pie «Último sync» desde sync_estado');
  await page.waitForFunction(() => document.getElementById('ok-campana-n')?.textContent === '2');
  await page.click('.ok-campana summary');
  ok(await page.locator('.ok-campana-op').count() === 2 && await page.isVisible('.ok-campana-menu'), 'campana: 2 avisos de Oki en el desplegable');
  await page.click('.ok-campana summary');
  ok((await page.textContent('a.ok-fila-dato span')) === 'Trabajos completados' && (await page.textContent('a.ok-fila-dato b')) === '1', 'estadísticas: 1 trabajo completado (fichaje acabado esta semana y completado)');
  ok(await page.locator('.ok-orden').count() === 6 && await page.locator('.ok-orden[href="#/lista-dia"]').count() === 1, 'órdenes rápidas');
  ok(await page.locator('.ok-aviso').count() === 3, 'avisos en vivo: 3 (los 2 que necesitan a una persona y el informativo detrás)');
  ok(await page.locator('.ok-aviso.mal').count() === 1 && (await page.textContent('.ok-aviso.mal .ok-insignia')).trim() === 'Urgente', 'el grave va marcado con la insignia «Urgente»');
  ok((await page.textContent('.ok-aviso.info .ok-insignia')).trim() === 'Para saber' && await page.locator('.ok-aviso').last().evaluate(e => e.classList.contains('info')), 'el informativo va el último, «Para saber»');
  // Barra de mando
  ok((await page.textContent('.ok-marca-txt')).includes('OKI') && /\d\d:\d\d:\d\d/.test(await page.textContent('#ok-hora')), 'barra: marca OKI y reloj con segundos');
  ok((await page.textContent('.ok-operador-txt')).includes('Ana') && (await page.textContent('.ok-operador-txt')).includes('al mando'), 'barra: operador con su nombre (admin = «al mando»)');
  ok(await page.locator('.ok-buscar[data-action="abrirBuscador"]').count() === 1, 'barra: «Buscar o pedir algo» abre la paleta');
  // Núcleo de Oki
  await page.waitForFunction(() => document.querySelector('#ok-nuc-conexiones small')?.textContent.includes('de 9'));
  const nuc = async id => (await page.textContent(`#ok-nuc-${id} small`)).trim();
  ok(await nuc('oki') === 'En marcha' && await nuc('claude') === '1 en curso' && await nuc('memoria') === '2 documentos indexados', `núcleo: Oki en marcha, Claude 1 en curso, 2 documentos (${await nuc('oki')} · ${await nuc('claude')} · ${await nuc('memoria')})`);
  ok(await nuc('sistema') === '1 urgente' && await page.getAttribute('#ok-nuc-sistema', 'data-tono') === 'mal', 'núcleo: sistema con 1 urgente en rojo');
  ok(await nuc('voz') === 'Lista para escuchar', 'núcleo: la voz está lista');
  // Agentes
  await page.waitForFunction(() => document.querySelector('#ok-ag-vigia .ok-ag-est')?.textContent.includes('equipos'));
  const ag = async id => [await page.getAttribute(`#ok-ag-${id}`, 'data-estado'), (await page.textContent(`#ok-ag-${id} .ok-ag-est`)).trim()];
  ok((await ag('sync')).join('|').startsWith('activo|Última pasada'), 'agentes: el sincronizador está activo con su última pasada');
  ok((await ag('claude')).join('|') === 'activo|Trabajando en 1 petición', 'agentes: el trabajador de Claude trabaja en 1 petición');
  ok((await ag('vigia')).join('|') === 'activo|2 de 3 equipos en línea', 'agentes: el vigía ve 2 de 3 equipos');
  ok((await ag('indexador')).join('|') === 'activo|Indexando 1', 'agentes: el indexador tiene 1 pendiente');
  ok((await ag('bot')).join('|') === 'activo|1 informe programado', 'agentes: el bot con 1 informe programado');
  ok(await page.locator('.ok-agente').count() === 6, 'agentes: 6 tarjetas');
  // Hoy en la agenda
  await page.waitForSelector('.ok-hito');
  ok(await page.locator('.ok-hito').count() === 3, 'agenda de hoy: 3 bloques (el de ayer no)');
  ok(await page.locator('.ok-hito.hecho').count() === 1 && await page.locator('.ok-hito.ahora').count() === 1, 'agenda de hoy: uno hecho y uno ahora');
  ok((await page.textContent('.ok-hito:last-child em')).startsWith('En ') && await page.getAttribute('.ok-hito.ahora .ok-hito-txt', 'href') === '#/trabajos/w2', 'agenda de hoy: el que viene dice cuánto falta y el bloque enlaza a su trabajo');
  // Memoria
  await page.waitForSelector('.ok-mem-cifra');
  const cifras = await page.$$eval('.ok-mem-cifra', els => els.map(e => `${e.querySelector('small').textContent}=${e.querySelector('b').textContent}`));
  ok(cifras.join(' ') === 'Documentos=2 Fragmentos=20 Páginas de la wiki=2 Proyectos abiertos=0 Comandas hechas esta semana=1', `memoria: ${cifras.join(' · ')}`);
  ok(await page.locator('.ok-constelacion polygon').count() === 14 && await page.locator('.ok-constelacion polygon.con').count() === 2, 'memoria: constelación de 14 días con 2 con documentos');
  // Conexiones
  await page.waitForFunction(() => document.querySelector('#ok-cx-claude small')?.textContent !== '…');
  const cx = async id => [await page.getAttribute(`#ok-cx-${id}`, 'data-tono'), (await page.textContent(`#ok-cx-${id} small`)).trim()];
  ok((await cx('app'))[1] === 'Conectada' && (await cx('zoho'))[0] === 'bien' && (await cx('whatsapp'))[1] === '1 por contestar', 'conexiones: app, Zoho y WhatsApp conectados');
  ok((await cx('correo')).join('|') === 'aviso|El último repaso falló', 'conexiones: el correo avisa de que el último repaso falló');
  ok((await cx('drive')).join('|') === 'aviso|Sin carpeta' && (await cx('telegram')).join('|') === 'bien|1 persona' && (await cx('breeze')).join('|') === 'bien|3 equipos' && (await cx('claude'))[0] === 'bien', 'conexiones: Drive sin carpeta; Telegram, Breeze y Claude conectados');
  ok((await page.textContent('#ok-conex-n')) === '7 conectadas' && await nuc('conexiones') === '7 de 9 conectadas', 'conexiones: 7 de 9, también en el núcleo');
  ok((await page.textContent('#ok-red b')) === 'En línea' && (await page.textContent('#ok-pie-hora')).match(/\d\d:\d\d/), 'pie: red en línea y la hora de Tenerife');
  ok(await page.locator('.baldosa').count() > 5, 'las baldosas siguen debajo');
  await page.screenshot({ path: `${CAPTURAS}/oki-portada.png`, fullPage: true });

  // Chat: plegado al entrar
  ok(await page.getAttribute('#wa', 'class') === 'wa cerrado', 'chat: plegado al entrar');
  await page.waitForFunction(() => document.getElementById('wa-num')?.textContent === '1');
  ok((await page.textContent('#wa-resumen')).includes('1 conversación por contestar'), 'chat plegado: 1 conversación por contestar');
  await page.click('#wa-cab');
  await page.waitForSelector('.wa-fila');
  ok(await page.locator('.wa-fila').count() === 2, 'chat abierto: lista con 2 conversaciones');
  ok(await page.locator('.wa-fila.pendiente').count() === 1, 'la pendiente va marcada');
  await page.click('.wa-fila[data-p0="c1"]');
  await page.waitForSelector('.wa-msg');
  ok(await page.locator('.wa-msg.ellos').count() === 2, 'hilo: 2 mensajes del cliente');
  ok(llamadas.some(l => l.accion === 'leida' && l.conversacion_id === 'c1'), 'al abrir se marca leída');
  ok((await page.textContent('.wa-ventana')).includes('Quedan'), 'ventana de 24 h abierta con lo que queda');
  ok(await page.getAttribute('.wa-ticket', 'href') === '#/tickets/5031', 'enlace al ticket del Desk (por su número)');
  await page.waitForSelector('.wa-pedir');
  await page.click('.wa-pedir');
  await page.waitForSelector('#wa-propuesta');
  await page.click('[data-action="waUsar"]');
  ok((await page.inputValue('#wa-in')).startsWith('Hola, ya lo estamos viendo'), 'usar la propuesta de Oki la copia en la caja');
  await page.click('#wa-env');
  await page.waitForFunction(() => document.querySelectorAll('.wa-msg.yo').length === 1);
  ok(llamadas.some(l => l.accion === 'enviar' && l.conversacion_id === 'c1' && l.texto.startsWith('Hola')), 'enviar: llama a la función con el texto');
  ok(await page.inputValue('#wa-in') === '', 'tras enviar, la caja se vacía');
  ok((await page.textContent('#wa-resumen')).includes('Todo contestado'), 'tras contestar: todo contestado');
  await page.screenshot({ path: `${CAPTURAS}/oki-chat.png` });

  // Fuera de ventana
  await page.click('[data-action="waVolver"]');
  await page.click('.wa-fila[data-p0="c2"]');
  await page.waitForFunction(() => document.querySelector('.wa-ventana')?.textContent.includes('Fuera'));
  ok(await page.isDisabled('#wa-in'), 'fuera de 24 h: la caja queda bloqueada');
  ok(await page.isDisabled('#wa-env'), 'fuera de 24 h: el botón de enviar también');
  page.once('dialog', d => d.accept());
  await page.click('[data-action="waPlantilla"]');
  await page.waitForFunction(() => document.getElementById('wa-msgs')?.textContent.includes('Plantilla'));
  ok(llamadas.some(l => l.accion === 'plantilla' && l.conversacion_id === 'c2'), 'fuera de 24 h: «Mandar plantilla» la manda y sale en el hilo');

  await page.click('#wa-cab');

  // Voz: una pregunta va al buscador
  await page.click('.ok-voz-btn[data-voz="portada"]');
  await page.waitForSelector('.ok-voz.escuchando');
  ok((await page.textContent('.ok-hablar-sub')).includes('Escuchando'), 'voz: escuchando (también en la barra del pie)');
  await page.waitForTimeout(1200);
  await page.click('.ok-voz-btn[data-voz="portada"]');
  await page.waitForFunction(() => location.hash.startsWith('#/buscar/'));
  ok(decodeURIComponent(page.url().split('#/buscar/')[1]) === '¿Qué tickets tengo abiertos?', 'voz: una pregunta va al buscador');
  // Un encargo se reparte como comanda, pero solo tras confirmarlo
  dictado = 'Llamar a Costa Adeje para cambiar el router mañana';
  await page.goto(`${srv.base}/#/inicio`);
  await page.waitForSelector('.ok-hablar');
  await page.click('.ok-hablar');
  await page.waitForSelector('.ok-hablar.escuchando');
  await page.waitForTimeout(1200);
  await page.click('.ok-hablar');
  await page.waitForSelector('[data-action="okComanda"]');
  ok(!llamadas.some(l => l.fn === 'comandas' && l.accion === 'crear'), 'voz: un encargo NO se reparte sin confirmar');
  await page.click('[data-action="okComanda"]');
  await page.waitForFunction(() => document.querySelector('.ok-voz-res[data-voz="portada"]')?.textContent.includes('Repartida en 2'));
  ok(llamadas.some(l => l.fn === 'comandas' && l.accion === 'crear' && l.texto.startsWith('Llamar a Costa')), 'voz: confirmado, se reparte como comanda');
  // Repaso de la mañana
  await page.click('[data-action="okRepaso"]');
  await page.waitForSelector('.ok-repaso-txt b');
  ok((await page.textContent('.ok-repaso-txt')).includes('Hoy tienes 2 trabajos'), 'pie: «Repaso de la mañana» lo enseña aquí');
  await page.screenshot({ path: `${CAPTURAS}/oki-portada-completa.png`, fullPage: true });

  // «Sí, contéstalo»: Oki redacta en el ticket y la persona manda
  await page.goto(`${srv.base}/#/tickets/5031/responder`);
  await page.waitForFunction(() => document.getElementById('tk-texto')?.value.startsWith('Buenos días'));
  ok(llamadas.some(l => l.fn === 'oki' && l.accion === 'proponer_ticket' && l.ticket_id === 't3'), '«Sí, contéstalo»: Oki redacta la respuesta en la caja del ticket');

  // El chat sigue en otra pantalla
  await page.goto(`${srv.base}/#/tickets`);
  await page.waitForSelector('#wa');
  ok(await page.isVisible('#wa-cab'), 'el chat sigue a mano en otra pantalla');
  ok(await page.locator('[onclick],[oninput],[onchange]').count() === 0, 'sin manejadores inline');

  // Móvil: el chat no desborda
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${srv.base}/#/inicio`);
  await page.waitForSelector('.ok-escena');
  const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
  ok(ancho <= 390, `móvil: sin desbordar a lo ancho (${ancho} px)`);
  await page.screenshot({ path: `${CAPTURAS}/oki-movil.png`, fullPage: true });

  ok(errores.length === 0, `sin errores de página${errores.length ? ': ' + errores.join(' | ') : ''}`);
} finally {
  await browser.close();
  srv.parar();
}
process.exit(fallos() ? 1 : 0);
