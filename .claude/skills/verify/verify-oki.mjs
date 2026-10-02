// Arnés de la portada de Oki y del chat de WhatsApp fijo.
// Cubre: portada con el diagrama (6 áreas con su dato), estadísticas de la
// semana (SLA, cerrados por día), «Oki dice» y «Necesita a una persona» desde
// panorama_direccion, baldosas debajo; chat plegado al entrar, abrir, leer una
// conversación (marca leída), usar la propuesta de Oki y enviar; ventana de 24 h
// cerrada → caja bloqueada; el chat sigue en otra pantalla. Sin datos reales.
//   npm run build && node .claude/skills/verify/verify-oki.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS, SB } from './comun.mjs';

const { ok, fallos } = contador();
const srv = await servidor(4193);
const ahora = Date.now();
const iso = ms => new Date(ms).toISOString();
const lunes = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); })();

const INICIAL = {
  usuarios: [{ id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true }],
  areas: [], sync_estado: [], proyectos: [], proyecto_tareas: [],
  tickets: [
    { id: 't1', estado: 'Cerrado', created_at: iso(lunes + 3600e3), cerrado_at: iso(lunes + 7200e3), sla_respuesta_at: iso(lunes + 9000e3), primera_respuesta_at: iso(lunes + 5000e3) },
    { id: 't2', estado: 'Cerrado', created_at: iso(lunes + 3600e3), cerrado_at: iso(lunes + 9000e3), sla_respuesta_at: iso(lunes + 4000e3), primera_respuesta_at: iso(lunes + 8000e3) },
    { id: 't3', estado: 'Abierto', created_at: iso(ahora - 3600e3), cerrado_at: null, sla_respuesta_at: iso(ahora + 3600e3), primera_respuesta_at: null },
  ],
};
const RPC = {
  panorama_direccion: () => [
    { clave: 'a1', tipo: 'ticket_sin_asignar', gravedad: 'mal', titulo: 'Ticket #5031 sin respuesta', detalle: 'Lleva 3 h', importe: null, enlace: '#/tickets/t3', fecha: null, persona: null, dinero: false },
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
  if (b.accion === 'estado') return r({ envio: true, claude: true });
  if (b.accion === 'conversaciones') return r({ conversaciones: CONVS, envio: true });
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
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
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
  ok(await page.getAttribute('.ok-dice-txt a.btn', 'href') === '#/tickets/t3', 'Oki dice: «Ir a lo más urgente» lleva al aviso grave');
  ok(await page.locator('.ok-aviso').count() === 2, 'Necesita a una persona: 2 avisos');
  ok(await page.locator('.ok-aviso.mal').count() === 1, 'el grave va marcado');
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
  ok(await page.getAttribute('.wa-ticket', 'href') === '#/tickets/t3', 'enlace al ticket del Desk');
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

  // El chat sigue en otra pantalla
  await page.click('#wa-cab');
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
