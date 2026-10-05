// Arnés del asistente de voz (paridad, tanda 1): el micro de la cabecera abre
// la ventana; lo escrito va a la función `voz` (SIMULADA, con respuestas de
// guion) y el bloque [[ACCION]] se ejecuta en el navegador: resumen del día
// (trabajo por fecha y por bloque de agenda), buscar con local y abrir un
// resultado, abrir directo por número, control remoto (AnyDesk), deshacer sin
// nada, una acción que no existe, el resultado vuelve al historial,
// y sin clave lo dice. La voz de Oki manda lo dictado al asistente.
// Sin datos reales.
//   npm run build && node .claude/skills/verify/verify-voz.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS, SB } from './comun.mjs';

const { ok, fallos } = contador();
const srv = await servidor(4211);
const hoy = new Date().toLocaleDateString('sv-SE');
const at = h => new Date(`${hoy}T${String(h).padStart(2, '0')}:00:00`).toISOString();
const C1 = 'c1111111-1111-1111-1111-111111111111', L1 = 'l1111111-1111-1111-1111-111111111111', L2 = 'l2222222-2222-2222-2222-222222222222';
const FIX = {
  usuarios: [{ id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true }],
  areas: [], sync_estado: [], config: [], proyectos: [],
  clientes: [{ id: C1, nombre: 'Hoteles Oasis SL', activo: true }],
  locales: [{ id: L1, cliente_id: C1, nombre: 'Hotel Oasis', direccion: 'Adeje', activo: true }, { id: L2, cliente_id: null, nombre: 'Bar Manolo', direccion: 'Arona', activo: true }],
  trabajos: [
    { id: 'w1', numero: 151, titulo: 'Cambiar router', descripcion: null, materiales: null, estado: 'Pendiente', fecha_programada: hoy, tecnicos: [], cliente_id: C1, local_id: L1 },
    { id: 'w2', numero: 152, titulo: 'Cableado', descripcion: null, materiales: null, estado: 'En progreso', fecha_programada: '2020-01-01', tecnicos: [], cliente_id: C1, local_id: L1 },
    { id: 'w3', numero: 153, titulo: 'TPV', descripcion: null, materiales: null, estado: 'Completado', fecha_programada: '2020-01-01', tecnicos: [], cliente_id: null, local_id: L2 },
  ],
  agenda: [{ id: 'b2', trabajo_id: 'w2', inicio: at(9), fin: at(12) }],
  tareas: [], tickets: [], presupuestos: [], sesiones: [],
  local_hardware: [{ id: 'h1', local_id: L2, tipo: 'TPV', nombre: 'Caja', anydesk_id: '123 456 789' }], local_software: [], rmm_equipos: [],
};
// Guion: lo que «contesta» el modelo según lo último que se dice.
const GUION = [
  [/qué tengo hoy/i, 'Miro tu día.\n[[ACCION]]{"accion":"resumen","datos":{"que":"dia"}}'],
  [/pendientes del hotel/i, 'Busco.\n[[ACCION]]{"accion":"buscar","datos":{"tipo":"trabajos","estado":"abiertos","local":"hotel oasis"}}'],
  [/abre el 153/i, '[[ACCION]]{"accion":"abrir","datos":{"tipo":"trabajo","texto":"153"}}'],
  [/conéctame/i, '[[ACCION]]{"accion":"control_remoto","datos":{"local":"bar manolo"}}'],
  [/deshaz/i, '[[ACCION]]{"accion":"deshacer","datos":{}}'],
  [/mándale un whatsapp/i, '[[ACCION]]{"accion":"mandar_whatsapp","datos":{"texto":"hola"}}'],
  [/hola/i, 'Hola, ¿en qué te ayudo?'],
];

const browser = await navegador();
const errores = [];
try {
  const base = baseMemoria(FIX, {});
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  await preparar(ctx, { email: 'ana@ok.test', base });
  await ctx.addInitScript(() => { localStorage.setItem('hub_voz_leer', '0'); window.__abiertos = []; window.open = u => { window.__abiertos.push(String(u)); return null; }; });
  const peticiones = [];
  let sinClave = false;
  await ctx.route(`${SB}/functions/v1/voz`, route => {
    const b = route.request().postDataJSON();
    if (b.accion === 'estado') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ groq: !sinClave, claude: false }) });
    peticiones.push(b);
    if (sinClave) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'El asistente no está configurado todavía (falta la clave de Groq).' }) });
    const ultimo = [...b.messages].reverse().find(m => m.role === 'user')?.content ?? '';
    const reply = GUION.find(([re]) => re.test(ultimo))?.[1] ?? 'No te he entendido.';
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reply }) });
  });
  await ctx.route(`${SB}/functions/v1/comandas`, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ texto: '¿qué tengo hoy?' }) }));
  const page = await ctx.newPage();
  page.on('pageerror', e => errores.push(String(e.stack ?? e)));
  const decir = async t => { await page.fill('#vz-texto', t); await page.press('#vz-texto', 'Enter'); };
  const ultimaBurbuja = () => page.evaluate(() => [...document.querySelectorAll('.vz-assistant')].pop()?.textContent ?? '');

  await page.goto(`${srv.base}/#/tareas`);
  await page.click('#voz-btn');
  await page.waitForSelector('#vz[open] #vz-texto');
  ok(true, 'el micro de la cabecera abre el asistente');

  await decir('hola');
  await page.waitForFunction(() => document.querySelector('.vz-assistant')?.textContent.includes('Hola'));
  ok(true, 'conversación: la respuesta sale en la ventana');

  await decir('¿qué tengo hoy?');
  await page.waitForFunction(() => document.querySelectorAll('.vz-res button').length === 2);
  const res = await page.textContent('#vz-conv');
  ok(res.includes('#151') && res.includes('#152') && res.includes('Hotel Oasis') && !res.includes('[[ACCION]]'), 'resumen del día: el trabajo de hoy y el del bloque de agenda, sin el bloque interno');
  ok((await ultimaBurbuja()).includes('2 trabajos'), 'resumen del día: lo dice');

  await decir('busca los trabajos pendientes del hotel oasis');
  await page.waitForFunction(() => [...document.querySelectorAll('.vz-res')].pop()?.querySelectorAll('button').length === 2);
  const hist = peticiones[peticiones.length - 1].messages.map(m => m.content).join('\n');
  ok(hist.includes('Plan de hoy') && hist.includes('#151'), 'el resultado de la acción anterior vuelve al historial (para «abre el segundo»)');
  await page.click('.vz-res:last-of-type button >> nth=0');
  await page.waitForFunction(() => location.hash.startsWith('#/trabajos/15'));
  ok(!(await page.isVisible('#vz')), 'tocar un resultado abre su ficha y cierra el asistente');

  await page.click('#voz-btn');
  await decir('abre el 153');
  await page.waitForFunction(() => location.hash === '#/trabajos/153');
  ok(true, 'abrir por número: va directo a la ficha');

  await page.click('#voz-btn');
  await decir('conéctame al bar manolo');
  await page.waitForFunction(() => window.__abiertos.length > 0);
  ok((await page.evaluate(() => window.__abiertos[0])) === 'anydesk://123456789', 'control remoto: abre el AnyDesk del sitio');

  await decir('deshaz eso');
  await page.waitForFunction(() => [...document.querySelectorAll('.vz-assistant')].pop()?.textContent.includes('nada reciente'));
  ok(true, 'deshacer sin nada hecho: lo dice');

  await decir('mándale un whatsapp a Bar Manolo');
  await page.waitForFunction(() => [...document.querySelectorAll('.vz-assistant')].pop()?.textContent.includes('todavía no'));
  ok(true, 'una orden que el hub no tiene: lo dice y no hace nada');
  await page.screenshot({ path: `${CAPTURAS}/voz.png` });

  sinClave = true;
  await decir('hola');
  await page.waitForFunction(() => !document.getElementById('vz-aviso')?.hidden && document.getElementById('vz-aviso')?.textContent.includes('clave de Groq'));
  ok(true, 'sin la clave de Groq: lo dice en la ventana');
  sinClave = false;
  await page.click('[data-action="vozCerrar"]');

  // La voz de Oki manda lo dictado al asistente (grabación simulada: se para al momento).
  await page.addInitScript(() => {});
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => new MediaStream();
    window.MediaRecorder = class { constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; } start() { this.state = 'recording'; setTimeout(() => { this.ondataavailable?.({ data: new Blob([new Uint8Array(2000)]) }); this.state = 'inactive'; this.onstop?.(); }, 50); } stop() {} };
  });
  await page.goto(`${srv.base}/#/inicio`);
  await page.waitForSelector('.ok-voz-btn[data-voz="portada"]');
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => new MediaStream();
    window.MediaRecorder = class { constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; } start() { this.state = 'recording'; setTimeout(() => { this.ondataavailable?.({ data: new Blob([new Uint8Array(2000)]) }); this.state = 'inactive'; this.onstop?.(); }, 50); } stop() {} };
  });
  await page.click('.ok-voz-btn[data-voz="portada"]');
  await page.waitForSelector('#vz[open]');
  await page.waitForFunction(() => [...document.querySelectorAll('.vz-user')].pop()?.textContent.includes('qué tengo hoy') && document.querySelectorAll('.vz-user').length > 7);
  ok(true, 'Oki: lo dictado va al mismo asistente');

  await ctx.close();
  ok(!errores.length, `sin errores JS${errores.length ? ': ' + errores.join(' | ') : ''}`);
} finally {
  await browser.close();
  srv.parar();
}
if (!fallos()) console.log('\nTodo bien');
process.exit(fallos() ? 1 : 0);
