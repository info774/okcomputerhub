// Arnés de los avisos del chat (paridad bloque 8, tanda 5): con un mensaje
// nuevo de otro, suena un tono (AudioContext espiado), sale el aviso con la
// vista previa y «(N)» en el título; silenciar una conversación la calla;
// sin vista previa el aviso no enseña el texto; la conversación abierta
// delante no avisa; el sonido propio se guarda y se ofrece como tono.
// hub.chat_resumen SIMULADA. Sin datos reales.
//   npm run build && node .claude/skills/verify/verify-chat-avisos.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS } from './comun.mjs';

const { ok, fallos } = contador();
const srv = await servidor(4210);
const C1 = 'c1111111-1111-1111-1111-111111111111', C2 = 'c2222222-2222-2222-2222-222222222222';
const ahora = () => new Date().toISOString();
const FIX = {
  usuarios: [{ id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true }, { id: 'u-tito', nombre: 'Tito Pérez', email: 'tito@ok.test', rol: 'tecnico', activo: true }],
  areas: [], sync_estado: [], config: [], proyectos: [], chat_leidos: [],
  chat_canales: [{ id: C1, nombre: 'General', tipo: 'grupo', miembros: [], ficha_ruta: null }, { id: C2, nombre: null, tipo: 'directo', miembros: ['u-ana', 'u-tito'], ficha_ruta: null }],
  chat_mensajes: [{ id: 'm1', canal_id: C1, autor_id: 'u-tito', texto: 'Hola', created_at: ahora(), editado_at: null }],
};
// Lo que devuelve chat_resumen: se cambia desde el arnés (`sinLeer`).
const sinLeer = { [C1]: 0, [C2]: 0 }, ultimo = { [C1]: 'Hola', [C2]: '' };
const RPC = {
  chat_resumen: () => [
    { id: C1, nombre: 'General', tipo: 'grupo', miembros: [], ultimo_at: ahora(), sin_leer: sinLeer[C1], ultimo_texto: ultimo[C1] },
    { id: C2, nombre: null, tipo: 'directo', miembros: ['u-ana', 'u-tito'], ultimo_at: ahora(), sin_leer: sinLeer[C2], ultimo_texto: ultimo[C2] }],
};

const browser = await navegador();
const errores = [];
try {
  const base = baseMemoria(FIX, RPC);
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  await preparar(ctx, { email: 'ana@ok.test', base });
  // Espía de Web Audio: cuenta las notas que suenan.
  await ctx.addInitScript(() => {
    window.__notas = 0;
    const AC = window.AudioContext;
    if (AC) { const o = AC.prototype.createOscillator; AC.prototype.createOscillator = function () { window.__notas++; return o.call(this); }; }
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errores.push(String(e.stack ?? e)));
  const repasar = () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const notas = () => page.evaluate(() => window.__notas);

  await page.goto(`${srv.base}/#/tareas`);
  await page.waitForSelector('.vista');
  await page.waitForTimeout(600);
  ok(!(await page.title()).startsWith('('), 'sin nada nuevo: título limpio y sin aviso');

  // Llega un mensaje a General
  sinLeer[C1] = 2; ultimo[C1] = 'Llevo el router a las 10';
  base.db.chat_mensajes.push({ id: 'm2', canal_id: C1, autor_id: 'u-tito', texto: 'Llevo el router a las 10', created_at: ahora(), editado_at: null });
  await repasar();
  await page.waitForSelector(`#cha-a-${C1}`);
  const txt = await page.textContent(`#cha-a-${C1}`);
  ok(txt.includes('Tito Pérez') && txt.includes('General') && txt.includes('Llevo el router'), 'mensaje nuevo: aviso con quién, dónde y la vista previa');
  ok(await notas() > 0, 'mensaje nuevo: suena su tono');
  ok((await page.title()).startsWith('(2) '), '«(2)» en el título de la pestaña');
  await page.screenshot({ path: `${CAPTURAS}/chat-aviso.png` });

  // Silenciar General 1 hora desde la conversación
  await page.goto(`${srv.base}/#/chat/${C1}`);
  await page.waitForSelector('[data-action="chAvisos"]');
  await page.click('[data-action="chAvisos"]');
  await page.waitForSelector('#cha-panel');
  await page.click(`[data-action="chaSilenciar"][data-p0="${C1}"][data-p1="1h"]`);
  await page.waitForFunction(() => document.getElementById('cha-panel')?.textContent.includes('Silenciada hasta'));
  ok(true, 'silenciar 1 hora desde los avisos de la conversación');
  await page.selectOption('#cha-tono', 'campana');
  const pref = await page.evaluate(() => JSON.parse(localStorage.getItem('hub_chat_avisos_u-ana')));
  ok(pref.canales[ '' + 'c1111111-1111-1111-1111-111111111111'].tono === 'campana' && pref.canales['c1111111-1111-1111-1111-111111111111'].silencio, 'el tono y el silencio se guardan por conversación');
  ok(!(await page.title()).startsWith('(2)'), 'al leerla, el título se limpia');

  await page.goto(`${srv.base}/#/tareas`);
  await page.waitForSelector('.vista');
  await page.evaluate(() => { document.getElementById('cha-avisos')?.replaceChildren(); window.__notas = 0; });
  sinLeer[C1] = 5;
  await repasar();
  await page.waitForTimeout(800);
  ok(!(await page.locator(`#cha-a-${C1}`).count()) && await notas() === 0, 'silenciada: ni suena ni avisa');

  // Sin vista previa
  await page.evaluate(() => { const k = 'hub_chat_avisos_u-ana'; const p = JSON.parse(localStorage.getItem(k)); p.vistaPrevia = false; localStorage.setItem(k, JSON.stringify(p)); });
  sinLeer[C2] = 1; ultimo[C2] = 'Secreto';
  base.db.chat_mensajes.push({ id: 'm3', canal_id: C2, autor_id: 'u-tito', texto: 'Secreto', created_at: ahora(), editado_at: null });
  await repasar();
  await page.waitForSelector(`#cha-a-${C2}`);
  ok(!(await page.textContent(`#cha-a-${C2}`)).includes('Secreto'), 'sin vista previa: el aviso no enseña el texto');

  // La conversación abierta delante no avisa
  await page.goto(`${srv.base}/#/chat/${C2}`);
  await page.waitForSelector('#ch-mensajes');
  await page.evaluate(() => { document.getElementById('cha-avisos')?.replaceChildren(); });
  sinLeer[C2] = 2;
  await repasar();
  await page.waitForTimeout(800);
  ok(!(await page.locator(`#cha-a-${C2}`).count()), 'la conversación que se está leyendo no avisa');

  // Sonido propio
  await page.click('[data-action="chAvisos"]');
  await page.waitForSelector('#cha-fichero', { state: 'attached' });
  await page.setInputFiles('#cha-fichero', { name: 'pitido.wav', mimeType: 'audio/wav', buffer: Buffer.from('RIFF0000WAVEfmt ', 'latin1') });
  await page.waitForFunction(() => document.querySelector('#cha-tono option[value="propio"]'));
  ok((await page.textContent('#cha-tono')).includes('pitido.wav'), 'sonido propio: se guarda y se ofrece como tono');

  await ctx.close();
  ok(!errores.length, `sin errores JS${errores.length ? ': ' + errores.join(' | ') : ''}`);
} finally {
  await browser.close();
  srv.parar();
}
if (!fallos()) console.log('\nTodo bien');
process.exit(fallos() ? 1 : 0);
