// Arnés del dock estilo macOS del modo escritorio (shell/dock.ts e iconos.ts),
// sobre comun.mjs (PostgREST en memoria): nunca contra datos reales.
//
//   npm run build && node .claude/skills/verify/verify-dock.mjs
//
// Comprueba: iconos SVG en hexágono (sin emojis) en el dock y en «Todas»;
// aumento al pasar el ratón (el de debajo crece más que el vecino y el lejano
// no cambia) y vuelta al reposo al salir; nombre encima al pasar; rebote y
// punto al abrir; sin fila en la base, las 12 de siempre; clic derecho →
// «Quitar del dock» y «Mantener en el dock» guardan en hub.dock_fijas (upsert
// por usuario_id); arrastrar dentro del dock ordena; arrastrar desde «Todas»
// la fija donde se suelta; sacarla hacia arriba la quita; el clic tras
// arrastrar no abre nada; la fila de la base manda al recargar (otro
// ordenador); tema noche; sin errores JS.
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS } from './comun.mjs';

const PUERTO = 4191;
const { ok, fallos, sumar } = contador();

const FIX = {
  usuarios: [{ id: 'u-fran', nombre: 'Fran Admin', email: 'admin@ok.test', rol: 'admin', activo: true }],
  sync_estado: [], areas: [], config: [], clientes: [], clientes_crm: [], locales: [], trabajos: [], agenda: [],
  tickets: [], tareas: [], cobros_recordatorios: [], rmm_equipos: [], rmm_alertas: [], proyectos: [],
  proyecto_objetivos: [], proyecto_hitos: [], proyecto_paginas: [], proyecto_tareas: [], proyecto_vinculos: [], claude_peticiones: [],
  auditoria: [], zoho_facturas: [], informes_programados: [], paginas: [], documentos: [], mcp_tokens: [], oportunidades: [], presupuestos: [],
  rmm_sitios: [], rmm_acciones: [],
};
const RPC = { panorama_direccion: () => [], direccion_resumen: () => null, clases_clientes: () => [] };

const srv = await servidor(PUERTO);
const browser = await navegador();
const nuevo = async (fix = FIX) => {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1600, height: 900 } });
  const base = baseMemoria(fix, RPC);
  await preparar(ctx, { email: 'admin@ok.test', base, escritorio: 'defecto' });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
  return { ctx, page, base, errores };
};
const fijasEnDock = page => page.$$eval('#os-dock .os-ditem[data-fija]', es => es.map(e => e.dataset.mod));
const ancho = (page, sel) => page.$eval(sel, e => e.getBoundingClientRect().width);
const centro = (page, sel) => page.$eval(sel, e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height - 20 }; });
const esperar = ms => new Promise(r => setTimeout(r, ms));

try {
  const { ctx, page, base, errores } = await nuevo();
  await page.goto(srv.base);
  await page.waitForSelector('#os-dock .os-ditem[data-fija]');

  // Iconos
  ok(await page.$$eval('#os-dock .os-ditem', es => es.every(e => e.querySelector('svg.os-ico polygon.os-ico-hex'))), 'todos los iconos del dock son SVG con su hexágono');
  ok(!(await page.$eval('#os-dock', e => /\p{Extended_Pictographic}/u.test(e.textContent))), 'el dock no lleva emojis');
  const iniciales = await fijasEnDock(page);
  ok(iniciales.length === 12 && !iniciales.includes('inicio'), `sin fila en la base, las 12 de siempre (${iniciales.length})`);
  ok(await page.$$eval('#os-dock .os-ditem[data-fija] .os-ico-trazo', es => es.length) === 12, 'las 12 llevan su dibujo (ninguna cae en la inicial)');

  // Aumento
  const objetivo = `#os-dock .os-ditem[data-mod="${iniciales[5]}"]`;
  const vecino = `#os-dock .os-ditem[data-mod="${iniciales[6]}"]`;
  const lejano = `#os-dock .os-ditem[data-mod="${iniciales[0]}"]`;
  const reposo = await ancho(page, objetivo);
  const c = await centro(page, objetivo);
  await page.mouse.move(c.x - 40, c.y);
  await page.mouse.move(c.x, c.y, { steps: 5 });
  await esperar(250);
  const [a1, a2, a3] = [await ancho(page, objetivo), await ancho(page, vecino), await ancho(page, lejano)];
  ok(a1 > reposo * 1.6, `el icono bajo el puntero crece (${reposo.toFixed(0)} → ${a1.toFixed(0)} px)`);
  ok(a2 > reposo && a2 < a1, `el vecino crece menos (${a2.toFixed(0)} px)`);
  ok(Math.abs(a3 - reposo) < 1, 'el lejano no cambia');
  ok(await page.$eval(`${objetivo} .os-dlabel`, e => getComputedStyle(e).opacity === '1'), 'el nombre sale encima al pasar el ratón');
  await page.screenshot({ path: `${CAPTURAS}/dock-aumento.png`, clip: { x: 0, y: 650, width: 1600, height: 250 } });
  await page.mouse.move(800, 300);
  await esperar(350);
  ok(Math.abs(await ancho(page, objetivo) - reposo) < 1, 'al salir del dock vuelve al reposo');

  // Abrir: rebote y punto
  await page.click(lejano);
  await page.waitForSelector(`#os-win-${iniciales[0]}`);
  ok(await page.$eval(lejano, e => e.classList.contains('os-rebota') && e.classList.contains('abierta')), 'al abrir, el icono rebota y lleva el punto de abierta');

  // Clic derecho → Quitar
  await page.mouse.move(800, 300);
  await esperar(300);
  await page.click(`#os-dock .os-ditem[data-mod="${iniciales[3]}"]`, { button: 'right' });
  await page.waitForSelector('#os-dmenu [data-action="osDockQuitar"]');
  await esperar(200);
  await page.screenshot({ path: `${CAPTURAS}/dock-menu.png`, clip: { x: 0, y: 550, width: 1600, height: 350 } });
  await page.click('#os-dmenu [data-action="osDockQuitar"]');
  await page.waitForFunction(m => !document.querySelector(`#os-dock .os-ditem[data-mod="${m}"]`), iniciales[3]);
  ok(!(await page.$('#os-dmenu')), 'el menú se cierra tras elegir');
  let fila = base.db.dock_fijas?.[0];
  ok(fila?.usuario_id === 'u-fran' && fila.modulos.length === 11 && !fila.modulos.includes(iniciales[3]), '«Quitar del dock» guarda en hub.dock_fijas sin ella');
  ok(base.reg.escrituras.some(w => w.tabla === 'dock_fijas' && w.url.includes('on_conflict=usuario_id')), 'se guarda con upsert por usuario_id');

  // «Todas»: clic derecho → Mantener
  await page.click('[data-action="osLanzador"][data-p0="1"]');
  await page.waitForSelector('#os-lanzador .os-litem[data-mod] svg.os-ico');
  ok(true, 'el lanzador «Todas» usa los mismos iconos');
  // Dos pantallas que no están en el dock: una para el clic derecho y otra para arrastrar.
  const [X, Y] = await page.$$eval('#os-lanzador .os-litem[data-mod]', (es, f) => es.map(e => e.dataset.mod).filter(m => m !== 'inicio' && !f.includes(m)), await fijasEnDock(page));
  await page.click(`#os-lanzador .os-litem[data-mod="${X}"]`, { button: 'right' });
  await page.click('#os-dmenu [data-action="osDockFijar"]');
  await page.waitForSelector(`#os-dock .os-ditem[data-mod="${X}"][data-fija]`);
  ok((await fijasEnDock(page)).at(-1) === X && base.db.dock_fijas[0].modulos.at(-1) === X, '«Mantener en el dock» la fija al final y la guarda');
  ok(!(await page.$(`#os-win-${X}`)), 'el clic derecho no abre la pantalla');

  // Arrastrar dentro del dock: ordenar
  await page.click('.os-lanzador-fondo', { position: { x: 8, y: 8 } });
  ok(await page.$eval('#os-lanzador', e => e.hidden), 'un clic fuera cierra «Todas»');
  await page.mouse.move(800, 300);
  await esperar(300);
  const antes = await fijasEnDock(page);
  const origen = await centro(page, `#os-dock .os-ditem[data-mod="${antes.at(-1)}"]`);
  const destino = await centro(page, `#os-dock .os-ditem[data-mod="${antes[0]}"]`);
  await page.mouse.move(origen.x, origen.y);
  await page.mouse.down();
  await page.mouse.move(origen.x - 20, origen.y - 10, { steps: 3 });
  ok(!!(await page.$('.os-dfantasma')) && !!(await page.$('#os-dock .os-dhueco')), 'al arrastrar sale el icono que sigue al puntero y el hueco en el dock');
  await page.mouse.move(destino.x - 20, destino.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(x => document.querySelector('#os-dock .os-ditem[data-fija]')?.dataset.mod === x, X);
  ok(base.db.dock_fijas[0].modulos[0] === X, 'arrastrar dentro del dock la pone delante y guarda el orden');
  await esperar(50);
  ok(!(await page.$(`#os-win-${X}`)), 'soltar tras arrastrar no abre la pantalla');

  // Arrastrar desde «Todas»
  await page.click('[data-action="osLanzador"][data-p0="1"]');
  await page.waitForSelector(`#os-lanzador .os-litem[data-mod="${Y}"]`);
  const desde = await centro(page, `#os-lanzador .os-litem[data-mod="${Y}"]`);
  const fijasAhora = await fijasEnDock(page);
  await page.mouse.move(desde.x, desde.y);
  await page.mouse.down();
  await page.mouse.move(desde.x + 10, desde.y + 10, { steps: 3 });
  ok(await page.$eval('#os-lanzador', e => e.hidden), 'al empezar a arrastrar se cierra «Todas» y se ve el dock');
  const sobre = await centro(page, `#os-dock .os-ditem[data-mod="${fijasAhora[2]}"]`);
  await page.mouse.move(sobre.x - 30, sobre.y, { steps: 15 });
  await page.mouse.up();
  await page.waitForSelector(`#os-dock .os-ditem[data-mod="${Y}"][data-fija]`);
  const conTablero = await fijasEnDock(page);
  ok(conTablero.indexOf(Y) === 2 && base.db.dock_fijas[0].modulos[2] === Y, `desde «Todas» se fija donde se suelta (posición ${conTablero.indexOf(Y)})`);
  ok(!(await page.$(`#os-win-${Y}`)), 'arrastrar desde «Todas» no abre la pantalla');

  // Sacar hacia arriba: quitar
  await page.mouse.move(800, 300);
  await esperar(300);
  const t = await centro(page, `#os-dock .os-ditem[data-mod="${Y}"]`);
  await page.mouse.move(t.x, t.y);
  await page.mouse.down();
  await page.mouse.move(t.x, t.y - 40, { steps: 4 });
  await page.mouse.move(t.x, t.y - 220, { steps: 8 });
  ok(await page.$eval('.os-dfantasma', e => e.classList.contains('quitar')), 'fuera del dock el icono avisa «Quitar»');
  await page.screenshot({ path: `${CAPTURAS}/dock-quitar.png`, clip: { x: 0, y: 450, width: 1600, height: 450 } });
  await page.mouse.up();
  await page.waitForFunction(y => !document.querySelector(`#os-dock .os-ditem[data-mod="${y}"]`), Y);
  ok(!base.db.dock_fijas[0].modulos.includes(Y), 'sacarla hacia arriba la quita del dock y de la base');

  // Lo abierto que no es fijo sale mientras dure, sin data-fija
  await page.goto(`${srv.base}/#/${Y}`);
  await page.waitForSelector(`#os-win-${Y}`);
  ok(await page.$eval(`#os-dock .os-ditem[data-mod="${Y}"]`, e => !e.dataset.fija && e.classList.contains('abierta')), 'una pantalla abierta sin fijar sale en el dock mientras está abierta');

  // Tema noche
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.screenshot({ path: `${CAPTURAS}/dock-noche.png`, clip: { x: 0, y: 650, width: 1600, height: 250 } });
  ok(await page.$eval('#os-dock .os-ditem[data-fija] .os-ico-trazo', e => getComputedStyle(e).stroke === 'rgb(255, 255, 255)'), 'en noche el trazo pasa a blanco');
  ok(errores.length === 0, `sin errores JS${errores.length ? ': ' + errores.join(' | ') : ''}`);
  const guardadas = base.db.dock_fijas[0].modulos;
  await ctx.close();

  // Otro ordenador: sin copia local, manda la fila de la base
  {
    const fix = { ...FIX, dock_fijas: [{ id: 'd1', usuario_id: 'u-fran', modulos: guardadas }] };
    const { ctx: c2, page: p2, errores: e2 } = await nuevo(fix);
    await p2.goto(srv.base);
    await p2.waitForFunction(g => [...document.querySelectorAll('#os-dock .os-ditem[data-fija]')].map(e => e.dataset.mod).join() === g.join(), guardadas).catch(() => {});
    const vistas = await fijasEnDock(p2);
    ok(JSON.stringify(vistas) === JSON.stringify(guardadas), `en otro ordenador sale el mismo dock (lo guardado en la base)${JSON.stringify(vistas) === JSON.stringify(guardadas) ? '' : ': ' + vistas + ' ≠ ' + guardadas}`);
    ok(e2.length === 0, `sin errores JS en el segundo ordenador${e2.length ? ': ' + e2.join(' | ') : ''}`);
    await c2.close();
  }

  // Insignias: el contador de la pantalla pide atención → hexágono de color y
  // el nombre lo cuenta; el menú del clic derecho trae el estado y las acciones.
  {
    const urgente = { grupo: 'dinero', gravedad: 'mal', titulo: 'Factura vencida: F26-0891', detalle: 'Polinesia', enlace: '#/cobros', persona: null, fecha: new Date().toISOString(), importe: 1240, dinero: true };
    const ctx3 = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1600, height: 900 } });
    const base3 = baseMemoria(FIX, { ...RPC, panorama_direccion: () => [urgente] });
    await preparar(ctx3, { email: 'admin@ok.test', base: base3, escritorio: 'defecto' });
    const p3 = await ctx3.newPage();
    const e3 = [];
    p3.on('pageerror', e => e3.push(String(e)));
    await p3.goto(srv.base);
    await p3.waitForSelector('#os-dock .os-ditem[data-mod="direccion"] .os-dinsignia.g-mal', { timeout: 5000 }).catch(() => {});
    ok(!!(await p3.$('#os-dock .os-ditem[data-mod="direccion"] .os-dinsignia.g-mal')), 'un aviso urgente pone la insignia roja en Puesto de mando');
    await p3.screenshot({ path: `${CAPTURAS}/dock-insignia-reposo.png`, clip: { x: 250, y: 780, width: 1100, height: 120 } });
    ok((await p3.textContent('#os-dock .os-ditem[data-mod="direccion"] .os-dlabel small')) === '1 urgente', 'y el nombre del icono lo cuenta («1 urgente», sin repetir la cifra)');
    ok(await p3.$$eval('#os-dock .os-dinsignia', es => es.length) === 1, 'lo que no pide atención no lleva insignia');
    await p3.mouse.move(800, 300);
    await p3.click('#os-dock .os-ditem[data-mod="direccion"]', { button: 'right' });
    await p3.waitForSelector('#os-dmenu [data-action="osAbrir"]');
    ok((await p3.textContent('#os-dmenu')).includes('Sin abrir') && !(await p3.$('#os-dmenu [data-action="osCerrar"]')), 'el menú dice que no está abierta y no ofrece cerrarla');
    ok(await p3.$eval('#os-root .os-ditem[data-mod="direccion"] .os-dlabel', e => getComputedStyle(e).opacity === '0'), 'con el menú abierto no sale el nombre encima');
    await esperar(200);
    await p3.screenshot({ path: `${CAPTURAS}/dock-insignia.png`, clip: { x: 0, y: 550, width: 1600, height: 350 } });
    await p3.click('#os-dmenu [data-action="osAbrir"]');
    await p3.waitForSelector('#os-win-direccion');
    await p3.click('#os-dock .os-ditem[data-mod="direccion"]', { button: 'right' });
    await p3.waitForSelector('#os-dmenu [data-action="osCerrar"]');
    ok(!!(await p3.$('#os-dmenu [data-action="osMinimizar"]')) && (await p3.textContent('#os-dmenu')).includes('Delante'), 'abierta y delante: el menú ofrece Minimizar y Cerrar');
    await p3.click('#os-dmenu [data-action="osMinimizar"]');
    await p3.waitForSelector('#os-win-direccion', { state: 'hidden' });
    ok(await p3.$eval('#os-dock .os-ditem[data-mod="direccion"]', e => e.classList.contains('minimizada')), 'minimizada: el icono la marca (punto hueco)');
    ok(e3.length === 0, `sin errores JS con insignias${e3.length ? ': ' + e3.join(' | ') : ''}`);
    await ctx3.close();
  }
} catch (e) {
  console.error(e);
  sumar();
} finally {
  await browser.close();
  srv.parar();
}
console.log(fallos() ? `\n${fallos()} fallo(s)` : '\nTodo bien');
process.exit(fallos() ? 1 : 0);
