// Arnés de Inventario (#/inventario): stock por ubicación y «Todas» sumando el
// mismo producto (por catálogo o por nombre), bajo mínimo y agotados, medidor,
// barras por ubicación que la eligen, valor solo para admins; el libro de
// movimientos (tipos, trasvase con destino, trabajo) y lo más gastado; la ficha
// con dónde más lo hay. Solo lectura. Sobre comun.mjs (nunca datos reales).
//
//   npm run build && node .claude/skills/verify/verify-inventario.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS } from './comun.mjs';

const PUERTO = 4196;
const { ok, fallos, sumar } = contador();
const hace = d => new Date(Date.now() - d * 86_400_000).toISOString();

const FIX = {
  usuarios: [
    { id: 'u-fran', nombre: 'Fran Admin', email: 'admin@ok.test', rol: 'admin', activo: true },
    { id: 'u-mat', nombre: 'Matteo Monastero', email: 'tec@ok.test', rol: 'tecnico', activo: true },
  ],
  sync_estado: [], config: [], clientes_crm: [], clientes: [],
  areas: [{ area: 'inventario', tablas: ['catalogo', 'furgonetas', 'furgoneta_inventario', 'furgoneta_movimientos'], dueno: 'app' }],
  furgonetas: [{ id: 'f1', nombre: 'Furgoneta 1', tecnico_responsable: 'Matteo' }, { id: 'f2', nombre: 'Tienda', tecnico_responsable: null }],
  furgoneta_inventario: [
    { id: 'i1', furgoneta_id: 'f1', nombre: 'Cable RJ45 Cat6', categoria: 'Redes', cantidad: 2, stock_minimo: 5, precio: 1.5, catalogo_id: 'cat1', codigo_principal: 'RJ45-6' },
    { id: 'i2', furgoneta_id: 'f2', nombre: 'Cable RJ45 Cat6', categoria: 'Redes', cantidad: 40, stock_minimo: 10, precio: 1.5, catalogo_id: 'cat1' },
    { id: 'i3', furgoneta_id: 'f1', nombre: 'Rollo papel TPV', categoria: 'Consumibles', cantidad: 0, stock_minimo: 4, precio: 2 },
    { id: 'i4', furgoneta_id: 'f2', nombre: 'Rollo papel TPV ', categoria: 'Consumibles', cantidad: 30, stock_minimo: 10, precio: 2 },
    { id: 'i5', furgoneta_id: 'f2', nombre: 'Impresora térmica', categoria: 'Hardware', cantidad: 3, stock_minimo: 1, precio: 120 },
    { id: 'i6', furgoneta_id: 'f1', nombre: '<b>Ratón</b>', categoria: 'Hardware', cantidad: 6, stock_minimo: 2, precio: 9 },
  ],
  trabajos: [{ id: 'tr1', numero: 331, titulo: 'Instalar TPV nuevo' }],
  furgoneta_movimientos: [
    { id: 'm1', created_at: hace(1), furgoneta_id: 'f1', producto_id: 'i1', tipo: 'salida', cantidad: 3, tecnico_id: 'Matteo', trabajo_id: 'tr1' },
    { id: 'm2', created_at: hace(2), furgoneta_id: 'f2', producto_id: 'i2', tipo: 'trasvase', cantidad: 5, destino_id: 'f1', tecnico_id: 'Fran', notas: 'Reponer furgoneta' },
    { id: 'm3', created_at: hace(5), furgoneta_id: 'f2', producto_id: 'i4', tipo: 'entrada', cantidad: 30, tecnico_id: 'Fran', notas: 'Albarán DC' },
    { id: 'm4', created_at: hace(10), furgoneta_id: 'f1', producto_id: 'i3', tipo: 'salida', cantidad: 8, tecnico_id: 'Matteo' },
    { id: 'm5', created_at: hace(200), furgoneta_id: 'f1', producto_id: 'i6', tipo: 'salida', cantidad: 50, tecnico_id: 'Matteo' },
  ],
};

const srv = await servidor(PUERTO);
const browser = await navegador();
const filas = (page, sel = '#in-tabla') => page.$$eval(`${sel} tbody tr`, trs => trs.map(t => t.textContent.replace(/\s+/g, ' ').trim()));
const cuantas = (page, n, sel = '#in-tabla') => page.waitForFunction(([k, s]) => document.querySelectorAll(`${s} tbody tr:not(:has(.vacio))`).length === k, [n, sel]);
const fila = (fs, txt) => fs.find(f => f.includes(txt)) ?? '';

try {
  let ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  const base = baseMemoria(FIX, { mrp: () => [] });
  await preparar(ctx, { email: 'admin@ok.test', base });
  let page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));

  await page.goto(`${srv.base}/#/inicio`);
  await page.waitForSelector('#menu .menu-item');
  const enlace = await page.$('#menu a[href="#/inventario"]');
  ok(!!enlace && !(await enlace.getAttribute('target')), 'Inventario es pantalla del hub (ya no abre la app)');
  await page.goto(`${srv.base}/#/inventario`);
  await page.waitForSelector('#in-tabla');
  await cuantas(page, 4);
  let fs = await filas(page);
  ok(fila(fs, 'Cable RJ45').includes('Furgoneta 1 2') && fila(fs, 'Cable RJ45').includes('Tienda 40') && fila(fs, 'Cable RJ45').includes('42'), '«Todas» suma el mismo producto por catálogo (2 + 40)');
  ok(fila(fs, 'Rollo papel').includes('30') && fila(fs, 'Rollo papel').includes('Furgoneta 1 0'), 'y por nombre si no tiene catálogo (aunque lleve un espacio de más)');
  ok(fs.some(f => f.includes('<b>Ratón</b>')), 'nombres escapados');
  ok(!!(await page.$('.aviso.area-app')), 'aviso de solo lectura (el área es de la app)');
  const cifras = await page.$$eval('.pp-cifras .di-cifra', cs => cs.map(c => c.textContent.replace(/\s+/g, ' ').trim()));
  ok(cifras[0].startsWith('Productos4') && cifras[0].includes('2 ubicaciones'), `productos distintos (${cifras[0]})`);
  ok(cifras[1].startsWith('Bajo mínimo2') && cifras[2].startsWith('Agotados1'), `bajo mínimo y agotados por ubicación (${cifras[1]} / ${cifras[2]})`);
  ok(cifras[3].replace(/\./g, '').includes('537 €'), `valor del stock (3+60+60+360+54) (${cifras[3]})`);
  const barras = await page.$$eval('#in-barras tr', trs => trs.map(t => t.querySelector('th').textContent));
  ok(barras.join(',') === 'Furgoneta 1,Tienda', 'barras por ubicación');
  await page.screenshot({ path: `${CAPTURAS}/inventario-total.png` });

  await page.click('#in-barras tr:has-text("Furgoneta 1")');
  await cuantas(page, 3);
  fs = await filas(page);
  ok(fs[0].includes('Rollo papel') && fs[0].includes('Agotado') && fs[1].includes('Cable') && fs[1].includes('Bajo mínimo'), 'la barra elige la ubicación; primero lo agotado y lo bajo mínimo');
  ok(!!(await page.$('#in-tabla .in-medidor.bajo')), 'medidor en ámbar bajo mínimo');
  ok((await page.textContent('.pp-cifras')).includes('a cargo de Matteo'), 'la ubicación dice quién la lleva');
  ok((await page.$$eval('#in-barras tr.activa', t => t.map(x => x.textContent))).join().includes('Furgoneta 1'), 'la barra elegida queda marcada (hexágono)');
  await page.screenshot({ path: `${CAPTURAS}/inventario-furgoneta.png` });
  await page.click('#in-barras tr:has-text("Furgoneta 1")');
  await cuantas(page, 4);
  await page.check('#in-bajo');
  await cuantas(page, 0);
  ok(true, '«Solo bajo mínimo» en el total: nada (la tienda cubre a la furgoneta)');
  await page.uncheck('#in-bajo');
  await page.selectOption('#in-cat', 'Hardware');
  await cuantas(page, 2);
  await page.selectOption('#in-cat', '');
  await page.fill('#in-filtro', 'rj45-6');
  await cuantas(page, 1);
  ok(true, 'busca por código');
  await page.fill('#in-filtro', '');
  await cuantas(page, 4);

  // Ficha
  await page.click('.chip-boton[data-action="inUbic"][data-p0="f1"]');
  await cuantas(page, 3);
  await page.click('#in-tabla tbody tr:has-text("Cable RJ45")');
  await page.waitForSelector('#in-ficha-movs');
  ok(await page.evaluate(() => location.hash) === '#/inventario/i1', 'la fila abre la ficha del producto en esa ubicación');
  const ficha = await page.textContent('#pantalla');
  ok(ficha.includes('Tienda') && ficha.includes('En total: 42'), 'dónde más lo hay y el total');
  const mf = await filas(page, '#in-ficha-movs');
  ok(mf.length === 1 && mf[0].includes('Salida') && mf[0].includes('−3') && mf[0].includes('#331'), 'sus movimientos, con el trabajo');
  ok(!!(await page.$('#in-ficha-movs a[href="#/trabajos/tr1"]')), 'enlaza al trabajo');
  await page.screenshot({ path: `${CAPTURAS}/inventario-ficha.png`, fullPage: true });

  // Movimientos
  await page.goto(`${srv.base}/#/inventario/movimientos`);
  await page.waitForSelector('#in-movs');
  await page.selectOption('#in-mov-ubic', '');
  await cuantas(page, 5, '#in-movs');
  fs = await filas(page, '#in-movs');
  ok(fs[0].includes('Salida') && fs[0].includes('Cable'), 'el más reciente primero');
  ok(fila(fs, 'Trasvase').includes('Tienda → Furgoneta 1') && fila(fs, 'Trasvase').includes('Reponer furgoneta'), 'trasvase con destino y motivo');
  ok(fila(fs, 'Entrada').includes('+30'), 'entrada con signo');
  const gasto = await page.$$eval('#in-gasto tr', trs => trs.map(t => t.textContent.replace(/\s+/g, ' ').trim()));
  ok(gasto.length === 2 && gasto[0].includes('Rollo papel') && gasto[0].includes('8') && gasto[1].includes('3'), `lo más gastado en 90 días, sin lo viejo (${gasto.join(' | ')})`);
  await page.click('.chip-boton[data-action="inTipo"][data-p0="salida"]');
  await cuantas(page, 3, '#in-movs');
  ok((await filas(page, '#in-movs')).every(f => f.includes('Salida')), 'filtro por tipo');
  await page.screenshot({ path: `${CAPTURAS}/inventario-movimientos.png`, fullPage: true });

  ok(base.reg.escrituras.filter(e => e.metodo !== 'RPC').length === 0, 'Inventario no escribe nada');
  ok(base.reg.rest.every(r => r.perfil === 'hub'), 'todas las peticiones con Accept-Profile: hub');
  const inline = await page.evaluate(() => [...document.querySelectorAll('*')].filter(e => [...e.attributes].some(a => /^on[a-z]+$/.test(a.name))).length);
  ok(inline === 0, 'ningún on*= inline');
  ok(errores.length === 0, `sin errores JS${errores.length ? ': ' + errores.join(' | ') : ''}`);
  await ctx.close();

  // Técnico en el móvil: sin euros y sin desbordar.
  ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 800 } });
  await preparar(ctx, { email: 'tec@ok.test', base: baseMemoria(FIX, { mrp: () => [] }) });
  page = await ctx.newPage();
  await page.goto(`${srv.base}/#/inventario`);
  await page.waitForSelector('#in-tabla');
  await cuantas(page, 4);
  ok(!(await page.textContent('#pantalla')).includes('€'), 'un técnico no ve precios ni valor');
  ok((await page.textContent('.barras-tarjeta h3')) === 'Productos por ubicación', 'barras por número de productos');
  const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
  ok(ancho <= 390, `en el móvil no desborda (${ancho}px)`);
  await page.screenshot({ path: `${CAPTURAS}/inventario-movil.png`, fullPage: true });
  await ctx.close();
} catch (e) {
  console.error('✗ excepción:', e);
  sumar();
} finally {
  await browser.close();
  srv.parar();
}
const n = fallos();
console.log(n ? `\n${n} fallo(s)` : '\nTodo bien');
process.exit(n ? 1 : 0);
