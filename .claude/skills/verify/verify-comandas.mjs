// Arnés de la fase 8 (comandas): escribir una comanda → función `comandas`
// (simulada: devuelve y guarda las tareas), grabar audio con el micrófono
// falso de Chromium → la función recibe el audio, tablero Pendiente / En curso
// / Hecho (botones y arrastre), repartir a otra persona, tarea suelta, filtro
// por persona, borrar solo lo propio, móvil.
//   npm run build && node .claude/skills/verify/verify-comandas.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS, SB } from './comun.mjs';

const { ok, fallos, sumar } = contador();
const srv = await servidor(4187);
const ahora = new Date().toISOString();
const INICIAL = {
  usuarios: [{ id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true },
             { id: 'u-tito', nombre: 'Tito Pérez', email: 'tito@ok.test', rol: 'tecnico', activo: true }],
  areas: [], sync_estado: [], proyectos: [],
  comandas: [{ id: 'cm0', created_at: ahora, creada_por: 'u-ana', origen: 'telegram', transcripcion: 'Tito revisa el <b>NAS</b>', con_claude: true, n_tareas: 1 }],
  comanda_tareas: [
    { id: 't1', comanda_id: 'cm0', created_at: ahora, texto: 'Revisar el NAS del hotel', persona_id: 'u-tito', estado: 'pendiente', prioridad: true, fecha_limite: null, origen: 'telegram', creada_por: 'u-ana', hecha_at: null },
    { id: 't2', comanda_id: null, created_at: ahora, texto: 'Pedir tóner <img src=x onerror=alert(1)>', persona_id: null, estado: 'pendiente', prioridad: false, fecha_limite: '2020-01-01', origen: 'manual', creada_por: 'u-ana', hecha_at: null },
  ],
};

async function contexto(browser, email, viewport = { width: 1280, height: 900 }) {
  const base = baseMemoria(INICIAL, {});
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport, permissions: ['microphone'] });
  await preparar(ctx, { email, base });
  const fn = [];
  await ctx.route(`${SB}/functions/v1/comandas`, async route => {
    const b = route.request().postDataJSON() ?? {};
    fn.push(b);
    let r = { audio: true, claude: true };
    if (b.accion === 'crear') {
      const nuevas = [{ texto: 'Cambiar el router del Bar Pepe', persona_id: 'u-tito', prioridad: false }, { texto: 'Llamar al Hotel por la factura', persona_id: 'u-ana', prioridad: true }]
        .map((t, i) => ({ id: `n${fn.length}-${i}`, comanda_id: 'cmx', created_at: new Date().toISOString(), estado: 'pendiente', fecha_limite: null, origen: 'voz', creada_por: 'u-ana', hecha_at: null, ...t }));
      base.db.comanda_tareas.push(...nuevas);
      r = { comanda_id: 'cmx', tareas: nuevas, con_claude: true, transcripcion: b.texto ?? '(audio)' };
    }
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(r) });
  });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
  page.on('dialog', d => d.accept());
  return { ctx, page, base, fn, errores };
}
const toastCon = (page, t) => page.waitForFunction(x => document.getElementById('toast')?.textContent.includes(x), t);

const browser = await navegador(['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']);
try {
  const A = await contexto(browser, 'ana@ok.test', { width: 1280, height: 2200 }); // alto: que arrastrar no desplace la página
  const { page, base, fn } = A;
  await page.goto(`${srv.base}/#/comandas`);
  await page.waitForSelector('.co-tablero');
  ok(await page.locator('.pr-columna[data-estado="pendiente"] .co-tarjeta').count() === 2, 'tablero: las pendientes en su columna');
  ok(await page.locator('.co-tarjeta img').count() === 0 && (await page.textContent('.co-tablero')).includes('<img'), 'tablero: el texto va escapado');
  ok(await page.locator('.co-prioridad').count() === 1 && await page.locator('.co-tarjeta .mal').count() >= 1, 'tablero: prioridad y fecha vencida marcadas');
  await page.fill('#co-texto', 'Tito, cambia el router del Bar Pepe. Ana, llama al Hotel por la factura.');
  await page.click('#co-enviar');
  await toastCon(page, 'repartida en 2');
  ok(fn.some(f => f.accion === 'crear' && f.texto.startsWith('Tito, cambia')), 'dictar: el texto va a la función comandas');
  await page.waitForFunction(() => document.querySelectorAll('.pr-columna[data-estado="pendiente"] .co-tarjeta').length === 4);
  ok(true, 'dictar: las tareas nuevas salen en el tablero');

  // Grabar con el micrófono falso
  await page.click('#co-grabar');
  await page.waitForFunction(() => document.getElementById('co-grabar')?.getAttribute('aria-pressed') === 'true');
  await page.waitForTimeout(1500);
  await page.click('#co-grabar');
  for (let i = 0; i < 100 && !fn.some(f => f.audio); i++) await page.waitForTimeout(100);
  const audio = fn.find(f => f.accion === 'crear' && f.audio);
  ok(audio && audio.audio.length > 500 && /^audio\//.test(audio.mime), 'grabar: el audio (base64) va a la función');

  // Mover
  await page.waitForSelector('[data-action="coMover"][data-p0="t1"][data-p1="en_curso"]');
  await page.click('[data-action="coMover"][data-p0="t1"][data-p1="en_curso"]');
  await page.waitForSelector('.pr-columna[data-estado="en_curso"] .co-tarjeta[data-id="t1"]');
  ok(base.db.comanda_tareas.find(t => t.id === 't1').estado === 'en_curso', 'mover: Empezar');
  await page.click('[data-action="coMover"][data-p0="t1"][data-p1="hecha"]');
  // (la hora de «hecha» la pone un trigger de la base; el PostgREST de memoria no la pone)
  await page.waitForFunction(() => !document.querySelector('.pr-columna[data-estado="en_curso"] .co-tarjeta[data-id="t1"]'));
  ok(base.db.comanda_tareas.find(t => t.id === 't1').estado === 'hecha', 'mover: Hecha');
  await page.dragAndDrop('.co-tarjeta[data-id="t2"] .co-texto', '.pr-columna[data-estado="en_curso"]');
  await page.waitForSelector('.pr-columna[data-estado="en_curso"] .co-tarjeta[data-id="t2"]');
  ok(base.db.comanda_tareas.find(t => t.id === 't2').estado === 'en_curso', 'mover: arrastrar a En curso');
  await page.selectOption('.co-tarjeta[data-id="t2"] select', 'u-tito');
  await toastCon(page, 'Repartida');
  ok(base.db.comanda_tareas.find(t => t.id === 't2').persona_id === 'u-tito', 'repartir: pasar la tarea a otra persona');
  await page.fill('#co-manual-texto', 'Comprar cable HDMI');
  await page.selectOption('#co-manual-persona', 'u-tito');
  await page.check('#co-manual-prio');
  await page.click('.co-manual button[type=submit]');
  await page.waitForFunction(() => document.querySelector('.co-tablero')?.textContent.includes('Comprar cable HDMI'));
  const man = base.db.comanda_tareas.find(t => t.texto === 'Comprar cable HDMI');
  ok(man?.persona_id === 'u-tito' && man.prioridad === true && man.origen === 'manual', 'tarea suelta con persona y prioridad');
  await page.click('[data-action="coFiltro"][data-p0="u-tito"]');
  await page.waitForFunction(() => [...document.querySelectorAll('.co-tarjeta select')].every(s => s.value === 'u-tito'));
  ok(true, 'filtro: solo las de una persona');
  await page.click('[data-action="coFiltro"][data-p0=""]');
  await page.screenshot({ path: `${CAPTURAS}/comandas.png`, fullPage: true });
  ok((await page.textContent('details')).includes('<b>NAS</b>'), 'últimas comandas con su transcripción (escapada)');
  ok(A.errores.length === 0, `admin: sin errores JS${A.errores.length ? ': ' + A.errores.join(' | ') : ''}`);
  await A.ctx.close();

  const T = await contexto(browser, 'tito@ok.test');
  await T.page.goto(`${srv.base}/#/comandas`);
  await T.page.waitForSelector('.co-tablero');
  ok(await T.page.locator('[data-action="coBorrar"]').count() === 0, 'técnico: no borra lo que le mandaron');
  ok(T.errores.length === 0, 'técnico: sin errores JS');
  await T.ctx.close();

  const M = await contexto(browser, 'ana@ok.test', { width: 390, height: 844 });
  await M.page.goto(`${srv.base}/#/comandas`);
  await M.page.waitForSelector('.co-tablero');
  const ancho = await M.page.evaluate(() => document.documentElement.scrollWidth);
  ok(ancho <= 390, `móvil: sin scroll horizontal (${ancho}px)`);
  ok(M.errores.length === 0, 'móvil: sin errores JS');
  await M.ctx.close();
} catch (e) { console.error('✗ excepción:', e); sumar(); }
finally { await browser.close(); srv.parar(); }
console.log(fallos() ? `\n${fallos()} fallo(s)` : '\nTodo bien');
process.exit(fallos() ? 1 : 0);
