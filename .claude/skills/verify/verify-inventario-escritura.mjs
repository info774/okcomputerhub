// Arnés de la escritura del inventario (paridad bloque 7, tanda 1), PREPARADA
// para el corte: con el área de la app, botones apagados y «Mover en la app»;
// con el área del hub, alta con el buscador del catálogo, editar, mover
// (trasvase con destino), ubicación nueva, albarán (la lectura de Claude
// SIMULADA en gastos-ocr) e importar CSV, todo por las funciones de la base
// (simuladas aquí), y el «Excel» de la lista. Sin datos reales.
//
//   npm run build && node .claude/skills/verify/verify-inventario-escritura.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS, SB } from './comun.mjs';
import { readFileSync } from 'node:fs';

const { ok, fallos } = contador();
const srv = await servidor(4201);

const FIX = areas => ({
  usuarios: [{ id: 'u-fran', nombre: 'Fran Admin', email: 'admin@ok.test', rol: 'admin', activo: true },
    { id: 'u-mat', nombre: 'Matteo Monastero', email: 'tec@ok.test', rol: 'tecnico', activo: true }],
  sync_estado: [], config: [], areas,
  catalogo: [{ id: 'cat1', nombre: 'Cable RJ45 Cat6', referencia: 'RJ45-6', precio: 1.5, categoria: 'Hardware', activo: true }],
  furgonetas: [{ id: 'f1', nombre: 'Furgoneta 1', tecnico_responsable: 'Matteo' }, { id: 'f2', nombre: 'Tienda', tecnico_responsable: null }],
  furgoneta_inventario: [
    { id: 'i1', furgoneta_id: 'f1', nombre: 'Cable RJ45 Cat6', categoria: 'Material', cantidad: 6, stock_minimo: 5, precio: 1.5, catalogo_id: 'cat1', codigo_principal: 'RJ45-6' },
    { id: 'i2', furgoneta_id: 'f2', nombre: 'Rollo papel TPV', categoria: 'Consumible', cantidad: 30, stock_minimo: 10, precio: 2 },
  ],
  furgoneta_movimientos: [], trabajos: [],
});
const APP = [{ area: 'inventario', tablas: ['catalogo', 'furgonetas', 'furgoneta_inventario', 'furgoneta_movimientos'], dueno: 'app' }];

const llamadas = {};
const apunta = (n, c) => { (llamadas[n] ??= []).push(c); };
const RPC = {
  inventario_guardar: (c, db) => {
    apunta('guardar', c);
    if (c.p_id) { Object.assign(db.furgoneta_inventario.find(p => p.id === c.p_id), c.p_datos); return c.p_id; }
    const id = `nuevo${db.furgoneta_inventario.length}`;
    db.furgoneta_inventario.push({ id, furgoneta_id: c.p_furgoneta, ...c.p_datos, catalogo_id: c.p_catalogo });
    return id;
  },
  inventario_mover: (c, db) => { apunta('mover', c); const p = db.furgoneta_inventario.find(x => x.id === c.p_producto); p.cantidad = Math.max(0, p.cantidad - c.p_cantidad); return p.cantidad; },
  inventario_entradas: c => { apunta('entradas', c); return { altas: c.p_lineas.length, sumadas: 0 }; },
};

const browser = await navegador();
const errores = [];
try {
  // ── Con el área de la app: se ve, no se escribe ─────────────────────────
  let base = baseMemoria(FIX(APP), RPC);
  let ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  await preparar(ctx, { email: 'admin@ok.test', base });
  let page = await ctx.newPage();
  page.on('pageerror', e => errores.push(String(e.stack ?? e)));
  await page.goto(`${srv.base}/#/inventario`);
  await page.waitForSelector('#in-tabla');
  ok(await page.isDisabled('[data-action="inNuevo"]') && await page.isDisabled('[data-action="inIr"][data-p0="albaran"]'), 'área de la app: los botones de escribir, apagados');
  await page.goto(`${srv.base}/#/inventario/i1`);
  await page.waitForSelector('.tarjeta-cab');
  ok((await page.textContent('.tarjeta-cab')).includes('Mover en la app') && await page.locator('a[href="#/inventario/i1/mover"]').count() === 0, 'área de la app: la ficha manda a mover en la app');
  await page.goto(`${srv.base}/#/inventario/nuevo`);
  await page.waitForSelector('#inw-form');
  ok(await page.isDisabled('#inw-nombre') && await page.isVisible('.area-app'), 'área de la app: el alta se ve pero no se rellena');
  await ctx.close();

  // ── Con el área del hub ───────────────────────────────────────────────
  base = baseMemoria(FIX([]), RPC);
  ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await preparar(ctx, { email: 'tec@ok.test', base });
  await ctx.route(`${SB}/functions/v1/gastos-ocr`, async route => {
    const b = route.request().postDataJSON();
    apunta('ocr', b);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ productos: [
      { nombre: 'Switch 8 puertos', cantidad: 2, precio: 25, referencia: 'SW8' }, { nombre: 'Portes', cantidad: 1, precio: 6, referencia: '' }] }) });
  });
  page = await ctx.newPage();
  page.on('pageerror', e => errores.push(String(e.stack ?? e)));
  page.on('dialog', d => d.accept());
  await page.goto(`${srv.base}/#/inventario`);
  await page.waitForSelector('#in-tabla');
  await page.click('[data-action="inUbic"][data-p0="f1"]');
  await page.waitForSelector('[data-action="inUbic"][data-p0="f1"].activo');

  // Excel de lo que hay en pantalla
  const [desc] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="inExcel"]')]);
  const csv = readFileSync(await desc.path(), 'utf8');
  ok(csv.includes('"Nombre";"Categoría";"Cantidad"') && csv.includes('Cable RJ45 Cat6') && !csv.includes('Rollo papel'), 'Excel: la ubicación elegida, con las columnas de la app');

  // Alta con el buscador del catálogo
  await page.click('[data-action="inNuevo"]');
  await page.waitForSelector('#inw-form');
  ok(await page.inputValue('#inw-ubic') === 'f1', 'alta: nace en la ubicación elegida');
  await page.fill('#inw-cat-buscar', 'rj45');
  await page.waitForSelector('[data-action="inwElegirCat"][data-p0="cat1"]');
  await page.click('[data-action="inwElegirCat"][data-p0="cat1"]');
  ok(await page.inputValue('#inw-nombre') === 'Cable RJ45 Cat6' && await page.inputValue('#inw-codigo') === 'RJ45-6' && (await page.textContent('#inw-vinculo')).includes('Enlazado'),
    'alta: elegir del catálogo rellena nombre, código y precio y lo enlaza');
  await page.fill('#inw-cantidad', '3');
  await page.click('#inw-form button[type="submit"]');
  await page.waitForFunction(() => /#\/inventario\/nuevo\d/.test(location.hash));
  const g = llamadas.guardar?.[0];
  ok(g && g.p_id === null && g.p_furgoneta === 'f1' && g.p_catalogo === 'cat1' && g.p_datos.cantidad === 3, 'alta: va por hub.inventario_guardar con la ficha del catálogo');

  // Mover: trasvase
  await page.goto(`${srv.base}/#/inventario/i1`);
  await page.waitForSelector('a[href="#/inventario/i1/mover"]');
  await page.click('a[href="#/inventario/i1/mover"]');
  await page.waitForSelector('#inw-mover');
  ok(await page.isHidden('#inw-dest-wrap'), 'mover: el destino solo sale en el trasvase');
  await page.click('[data-action="inwTipo"][data-p0="trasvase"]');
  ok(await page.isVisible('#inw-dest-wrap') && await page.inputValue('#inw-dest') === 'f2', 'mover: trasvase → elige destino (sin la propia ubicación)');
  await page.fill('#inw-mov-cant', '2');
  await page.fill('#inw-mov-notas', 'Para la tienda');
  await page.click('#inw-mover button[type="submit"]');
  await page.waitForFunction(() => location.hash === '#/inventario/i1');
  const mv = llamadas.mover?.[0];
  ok(mv && mv.p_tipo === 'trasvase' && mv.p_cantidad === 2 && mv.p_destino === 'f2' && mv.p_notas === 'Para la tienda', 'mover: va por hub.inventario_mover con destino y motivo');

  // Editar
  await page.goto(`${srv.base}/#/inventario/i1/editar`);
  await page.waitForSelector('#inw-form');
  ok(await page.inputValue('#inw-nombre') === 'Cable RJ45 Cat6' && await page.locator('#inw-ubic').count() === 0, 'editar: con sus datos y sin cambiar de ubicación');
  await page.fill('#inw-minimo', '8');
  await page.click('#inw-form button[type="submit"]');
  await page.waitForFunction(() => location.hash === '#/inventario/i1');
  ok(llamadas.guardar?.[1]?.p_id === 'i1' && llamadas.guardar[1].p_datos.stock_minimo === 8, 'editar: hub.inventario_guardar con su id');

  // Ubicación nueva
  await page.goto(`${srv.base}/#/inventario/vehiculo`);
  await page.waitForSelector('#inw-vehiculo');
  await page.fill('#inw-v-nombre', 'Furgoneta 2');
  await page.selectOption('#inw-v-tecnico', 'Matteo Monastero');
  await page.click('#inw-vehiculo button[type="submit"]');
  await page.waitForFunction(() => location.hash === '#/inventario');
  ok(base.db.furgonetas.some(f => f.nombre === 'Furgoneta 2' && f.tecnico_responsable === 'Matteo Monastero'), 'ubicación nueva: con quién la lleva');

  // Albarán
  await page.goto(`${srv.base}/#/inventario/albaran`);
  await page.waitForSelector('#inw-fichero');
  await page.selectOption('#inw-dest-lote', 'f2');
  await page.setInputFiles('#inw-fichero', { name: 'albaran.png', mimeType: 'image/png', buffer: readFileSync('public/iconos/icono-192.png') });
  await page.waitForSelector('#inw-lineas tbody tr');
  ok(await page.locator('#inw-lineas tbody tr').count() === 2 && llamadas.ocr?.[0]?.accion === 'albaran' && llamadas.ocr[0].tipo === 'image/png', 'albarán: Claude lee las líneas (gastos-ocr, acción albaran)');
  await page.uncheck('#inw-lineas tbody tr:nth-child(2) input[type="checkbox"]');
  await page.fill('#inw-lineas tbody tr:nth-child(1) td:nth-child(4) input', '3');
  await page.locator('#inw-lineas tbody tr:nth-child(1) td:nth-child(4) input').blur();
  await page.click('[data-action="inwConfirmar"]');
  await page.waitForFunction(() => location.hash === '#/inventario');
  const en = llamadas.entradas?.[0];
  ok(en && en.p_modo === 'albaran' && en.p_furgoneta === 'f2' && en.p_lineas.length === 1 && en.p_lineas[0].cantidad === 3 && en.p_lineas[0].referencia === 'SW8',
    'albarán: solo lo marcado, con lo corregido, por hub.inventario_entradas');

  // Importar CSV (con «;» y BOM, como el Excel que saca la lista)
  await page.goto(`${srv.base}/#/inventario/importar`);
  await page.waitForSelector('#inw-fichero');
  await page.setInputFiles('#inw-fichero', { name: 'inv.csv', mimeType: 'text/csv',
    buffer: Buffer.from('﻿"Nombre";"Categoría";"Cantidad";"Stock mínimo";"Notas"\r\n"Brida 20cm";"Consumible";"100";"20";""\r\n"Crimpadora";"Herramienta";"1";"0";"La buena"\r\n') });
  await page.waitForSelector('#inw-lineas tbody tr');
  await page.click('[data-action="inwConfirmar"]');
  await page.waitForFunction(() => location.hash === '#/inventario');
  const ex = llamadas.entradas?.[1];
  ok(ex && ex.p_modo === 'excel' && ex.p_lineas.length === 2 && ex.p_lineas[0].cantidad === 100 && ex.p_lineas[1].categoria === 'Herramienta' && ex.p_lineas[1].notas === 'La buena',
    'importar: lee el CSV de Excel y da de alta cada fila');
  await page.screenshot({ path: `${CAPTURAS}/inventario-escritura.png` });

  ok(!errores.length, `sin errores JS${errores.length ? ': ' + errores.join(' | ') : ''}`);
} finally {
  await browser.close();
  srv.parar();
}
if (!fallos()) console.log('\nTodo bien');
process.exit(fallos() ? 1 : 0);
