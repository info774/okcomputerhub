// Arnés de la fase 9 (almacén): stock (MRP simulado) con filtro, «Qué pedir»
// → pedido en borrador con sus líneas, ficha del pedido (añadir del catálogo,
// cambiar cantidad, enviar pide proveedor, recibido → entrada dada), proveedor
// nuevo y sus materiales (preferido), envíos (apuntar, enlace de seguimiento,
// estado), técnico sin borrar, móvil. El espejo del inventario no se escribe.
//   npm run build && node .claude/skills/verify/verify-almacen.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS } from './comun.mjs';

const { ok, fallos, sumar } = contador();
const srv = await servidor(4188);
const CAT1 = 'ca111111-1111-1111-1111-111111111111', CAT2 = 'ca222222-2222-2222-2222-222222222222';
const PROV = 'pv111111-1111-1111-1111-111111111111';
const mrp = (db) => [
  { clave: CAT1, catalogo_id: CAT1, nombre: 'Cable RJ45 <b>Cat6</b>', categoria: 'Material', stock: 2, minimo: 5, consumo_90: 45, consumo_dia: 0.5, cobertura_dias: 4, en_camino: 0,
    proveedor_id: PROV, proveedor: 'Distribuidora Canaria', plazo_dias: 5, precio_compra: 0.8, sugerido: 21, urgente: true,
    ubicaciones: [{ ubicacion: 'Almacén', cantidad: 2, minimo: 5 }] },
  { clave: CAT2, catalogo_id: CAT2, nombre: 'Tóner HP 26A', categoria: 'Consumible', stock: 10, minimo: 2, consumo_90: 3, consumo_dia: 0.03, cobertura_dias: 300, en_camino: 0,
    proveedor_id: null, proveedor: null, plazo_dias: null, precio_compra: null, sugerido: 0, urgente: false, ubicaciones: [{ ubicacion: 'Furgo Tito', cantidad: 10, minimo: 2 }] },
  { clave: 'n:ratón', catalogo_id: null, nombre: 'Ratón USB', categoria: 'Material', stock: 0, minimo: 1, consumo_90: 9, consumo_dia: 0.1, cobertura_dias: 0, en_camino: 0,
    proveedor_id: null, proveedor: null, plazo_dias: null, precio_compra: null, sugerido: 4, urgente: true, ubicaciones: [] },
].map(m => ({ ...m, en_camino: (db.pedido_compra_lineas ?? []).filter(l => l.catalogo_id === m.catalogo_id).reduce((a, l) => a + Number(l.cantidad), 0) }));
const INICIAL = {
  usuarios: [{ id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true }, { id: 'u-tito', nombre: 'Tito', email: 'tito@ok.test', rol: 'tecnico', activo: true }],
  areas: [], sync_estado: [], proyectos: [],
  config: [{ clave: 'mrp_cobertura_dias', valor: 30 }],
  catalogo: [{ id: CAT1, nombre: 'Cable RJ45 Cat6', referencia: 'RJ6', activo: true }, { id: CAT2, nombre: 'Tóner HP 26A', referencia: 'CF226A', activo: true }],
  proveedores: [{ id: PROV, nombre: 'Distribuidora Canaria', email: 'pedidos@dc.test', telefono: '922', plazo_dias: 5, activo: true, created_at: '2026-09-01T00:00:00Z' }],
  material_proveedor: [{ id: 'mp1', catalogo_id: CAT1, proveedor_id: PROV, precio_compra: 0.8, preferido: true, ref_proveedor: 'X1', plazo_dias: null }],
  pedidos_compra: [], pedido_compra_lineas: [], envios: [],
};

async function contexto(browser, email, viewport = { width: 1280, height: 900 }) {
  const base = baseMemoria(INICIAL, { mrp: (_b, db) => mrp(db) });
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport });
  await preparar(ctx, { email, base });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
  page.on('dialog', d => d.accept());
  return { ctx, page, base, errores };
}
const toastCon = (page, t) => page.waitForFunction(x => document.getElementById('toast')?.textContent.includes(x), t);

const browser = await navegador();
try {
  const A = await contexto(browser, 'ana@ok.test');
  const { page, base } = A;
  await page.goto(`${srv.base}/#/almacen`);
  await page.waitForSelector('.al-tabla');
  ok(await page.locator('.al-tabla tbody tr').count() === 3 && await page.locator('.al-urgente').count() === 2, 'stock: todos los materiales, los urgentes marcados');
  ok(await page.locator('.al-tabla b').count() === 0 && (await page.textContent('.al-tabla')).includes('<b>Cat6</b>'), 'stock: nombres escapados');
  await page.check('.pr-barra input[type=checkbox]');
  await page.waitForFunction(() => document.querySelectorAll('.al-tabla tbody tr').length === 2);
  await page.fill('#al-q', 'ratón');
  await page.waitForFunction(() => document.querySelectorAll('.al-tabla tbody tr').length === 1);
  ok(true, 'stock: filtros «lo que falta» y buscar');
  await page.fill('#al-q', '');
  await page.uncheck('.pr-barra input[type=checkbox]');

  // Qué pedir → pedido
  await page.goto(`${srv.base}/#/almacen/compras`);
  await page.waitForSelector('[data-action="alPrepararPedido"]');
  ok((await page.textContent('main')).includes('Sin proveedor asignado') && (await page.textContent('main')).includes('Ratón USB'), 'qué pedir: agrupado por proveedor (y lo que no tiene)');
  await page.fill(`.al-cant[data-cat="${CAT1}"]`, '25');
  await page.click('[data-action="alPrepararPedido"]');
  await page.waitForSelector('#al-texto');
  const ped = base.db.pedidos_compra[0];
  const lin = base.db.pedido_compra_lineas.filter(l => l.pedido_compra_id === ped.id);
  ok(ped?.proveedor_id === PROV && ped.estado === 'Borrador' && lin.length === 1 && lin[0].cantidad === 25 && lin[0].precio === 0.8 && lin[0].catalogo_id === CAT1,
    'qué pedir: pedido en borrador con la cantidad elegida y el precio del proveedor');
  ok((await page.inputValue('#al-texto')).includes('25 x Cable RJ45') && await page.locator('a[href^="mailto:pedidos@dc.test"]').count() === 1, 'pedido: texto para el proveedor y correo');

  // Ficha: añadir línea del catálogo, cambiar cantidad
  await page.fill('#al-linea-q', 'tón');
  await page.click(`[data-action="alElegirCat"][data-p0="${CAT2}"]`);
  await page.fill('#al-linea-cant', '3');
  await page.fill('#al-linea-precio', '40');
  await page.click('form[data-on-submit="alAnadirLinea"] button[type=submit]');
  await page.waitForFunction(() => document.querySelectorAll('input[aria-label="Cantidad"]').length === 2);
  ok(base.db.pedido_compra_lineas.some(l => l.catalogo_id === CAT2 && l.cantidad === 3 && l.precio === 40), 'pedido: añadir un material del catálogo');
  const primera = base.db.pedido_compra_lineas.find(l => l.catalogo_id === CAT1);
  await page.fill(`input[data-on-change="alLinea:${primera.id},cantidad,$value"]`, '30');
  await page.press(`input[data-on-change="alLinea:${primera.id},cantidad,$value"]`, 'Tab');
  await page.waitForFunction(() => document.getElementById('al-texto')?.value.includes('30 x Cable'));
  ok(base.db.pedido_compra_lineas.find(l => l.id === primera.id).cantidad === 30, 'pedido: cambiar la cantidad');
  await page.click('[data-action="alEstadoPedido"][data-p0="Enviado"]');
  await toastCon(page, 'Pedido: Enviado');
  await page.waitForSelector('[data-action="alEstadoPedido"][data-p0="Recibido"]');
  await page.click('[data-action="alEstadoPedido"][data-p0="Recibido"]');
  await page.waitForSelector('[data-action="alEntradaDada"]');
  ok(base.db.pedidos_compra[0].estado === 'Recibido', 'pedido: enviado y recibido');
  await page.click('[data-action="alEntradaDada"]');
  await page.waitForFunction(() => !document.querySelector('[data-action="alEntradaDada"]'));
  ok(!!base.db.pedidos_compra[0].entrada_app_at, 'pedido: «entrada dada» en el inventario de la app');
  await page.screenshot({ path: `${CAPTURAS}/almacen-pedido.png`, fullPage: true });

  // Pedido nuevo sin proveedor no se envía
  await page.goto(`${srv.base}/#/almacen/pedidos`);
  await page.click('[data-action="alNuevoPedido"]');
  await page.waitForSelector('[data-action="alEstadoPedido"][data-p0="Enviado"]');
  await page.click('[data-action="alEstadoPedido"][data-p0="Enviado"]');
  await toastCon(page, 'Elige el proveedor');
  ok(base.db.pedidos_compra.at(-1).estado === 'Borrador', 'pedido: sin proveedor no se marca enviado');

  // Proveedor nuevo + material
  await page.goto(`${srv.base}/#/almacen/proveedores`);
  await page.waitForSelector('form[data-on-submit="alGuardarProveedor:$this"] input[name="nombre"]');
  await page.fill('form[data-on-submit="alGuardarProveedor:$this"] input[name="nombre"]', 'Informática Sur');
  await page.fill('form[data-on-submit="alGuardarProveedor:$this"] input[name="plazo_dias"]', '2');
  await page.fill('form[data-on-submit="alGuardarProveedor:$this"] input[name="email"]', 'Ventas@Sur.test');
  await page.click('form[data-on-submit="alGuardarProveedor:$this"] button[type=submit]');
  await page.waitForSelector('#al-mat-ref');
  const sur = base.db.proveedores.find(p => p.nombre === 'Informática Sur');
  ok(sur?.plazo_dias === 2 && sur.email === 'ventas@sur.test', 'proveedor: alta con plazo y correo');
  await page.fill('#al-linea-q', 'cable');
  await page.click(`[data-action="alElegirCat"][data-p0="${CAT1}"]`);
  await page.fill('#al-mat-ref', 'SUR-9');
  await page.fill('#al-linea-precio', '0.7');
  await page.click('form[data-on-submit="alAnadirMaterial"] button[type=submit]');
  await page.waitForFunction(() => document.querySelector('main')?.textContent.includes('SUR-9'));
  const mps = base.db.material_proveedor.filter(m => m.catalogo_id === CAT1);
  ok(mps.find(m => m.proveedor_id === sur.id)?.preferido === true && mps.find(m => m.proveedor_id === PROV)?.preferido === false, 'proveedor: su material, preferido (quita el preferido anterior)');

  // Envíos
  await page.goto(`${srv.base}/#/almacen/envios`);
  await page.waitForSelector('#al-env-seg');
  await page.selectOption('#al-env-agencia', 'Correos Express');
  await page.fill('#al-env-seg', 'CEX123');
  await page.fill('#al-env-dest', 'Hotel Playa');
  await page.click('form[data-on-submit="alNuevoEnvio"] button[type=submit]');
  await page.waitForSelector('a[href*="correosexpress"]');
  ok(base.db.envios[0]?.estado === 'enviado' && base.db.envios[0].agencia === 'Correos Express', 'envíos: apuntar con seguimiento (queda enviado)');
  await page.selectOption('select[aria-label="Estado del envío"]', 'entregado');
  await toastCon(page, 'Entregado');
  ok(base.db.envios[0].estado === 'entregado', 'envíos: cambiar el estado');
  ok(!base.reg.escrituras.some(e => ['catalogo', 'furgonetas', 'furgoneta_inventario', 'furgoneta_movimientos'].includes(e.tabla)), 'no se escribe en el espejo del inventario');
  ok(A.errores.length === 0, `admin: sin errores JS${A.errores.length ? ': ' + A.errores.join(' | ') : ''}`);
  await A.ctx.close();

  const T = await contexto(browser, 'tito@ok.test');
  await T.page.goto(`${srv.base}/#/almacen/proveedores/${PROV}`);
  await T.page.waitForSelector('#al-mat-ref');
  ok(await T.page.locator('[data-action="alBorrarProveedor"]').count() === 0, 'técnico: no borra proveedores');
  ok(T.errores.length === 0, 'técnico: sin errores JS');
  await T.ctx.close();

  const M = await contexto(browser, 'ana@ok.test', { width: 390, height: 844 });
  for (const [r, sel] of [['almacen', '.al-tabla'], ['almacen/compras', '[data-action="alPrepararPedido"]'], ['almacen/pedidos', '.al-pestanas'], ['almacen/proveedores', '.al-pestanas'], ['almacen/envios', '#al-env-seg']]) {
    await M.page.goto(`${srv.base}/#/${r}`);
    await M.page.waitForSelector(sel);
    const ancho = await M.page.evaluate(() => document.documentElement.scrollWidth);
    ok(ancho <= 390, `móvil ${r}: sin scroll horizontal (${ancho}px)`);
  }
  ok(M.errores.length === 0, 'móvil: sin errores JS');
  await M.ctx.close();
} catch (e) { console.error('✗ excepción:', e); sumar(); }
finally { await browser.close(); srv.parar(); }
console.log(fallos() ? `\n${fallos()} fallo(s)` : '\nTodo bien');
process.exit(fallos() ? 1 : 0);
