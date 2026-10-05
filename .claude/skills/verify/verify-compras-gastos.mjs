// Arnés del bloque 7, tanda 2: facturas de compra (Almacén → «Facturas de
// compra», del hub: alta con el adjunto leído por Claude —gastos-ocr SIMULADA—
// que rellena y elige el proveedor por NIF, desde un pedido, pagada, vencida,
// eliminar solo admin) y los gastos y cobros de la app UNIFICADOS en Personas →
// Gastos (área de la app: se ven con sus vínculos y no se apuntan; del hub:
// gasto con trabajo y foto, cobro con descripción obligatoria, editar).
// Sin datos reales.
//   npm run build && node .claude/skills/verify/verify-compras-gastos.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS, SB } from './comun.mjs';

const { ok, fallos } = contador();
const srv = await servidor(4202);
const hoy = new Date().toLocaleDateString('sv-SE');
const ayer = new Date(Date.now() - 86_400_000).toLocaleDateString('sv-SE');

const FIX = areas => ({
  usuarios: [{ id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true }, { id: 'u-tito', nombre: 'Tito', email: 'tito@ok.test', rol: 'tecnico', activo: true }],
  areas, sync_estado: [], config: [], tickets_gasto: [],
  proveedores: [{ id: 'p1', nombre: 'Diverso Canarias', nif: 'B-38111222', activo: true }, { id: 'p2', nombre: 'Ingram', nif: 'A1', activo: true }],
  pedidos_compra: [{ id: 'pc1', numero: 12, proveedor_id: 'p2', total: 310, estado: 'Recibido', fecha: hoy, created_at: new Date().toISOString() }],
  pedido_compra_lineas: [],
  facturas_compra: [{ id: 'fv', created_at: new Date().toISOString(), proveedor_id: 'p1', pedido_compra_id: null, numero: 'F-1', fecha: ayer, vence: ayer, base: null, impuesto: null,
    importe: 99, estado: 'Pendiente', pagada_at: null, archivo_path: null, archivo_tipo: null, notas: null }],
  trabajos: [{ id: 'tr1', numero: 331, titulo: 'Instalar TPV' }],
  contactos: [{ id: 'ct1', nombre: 'Marta', activo: true }],
  locales: [{ id: 'l1', nombre: 'Bar Pepe', activo: true }],
  gastos: [
    { id: 'g1', created_at: new Date().toISOString(), tipo: 'gasto', importe: 12.5, fecha: hoy, categoria: 'Material', trabajo_id: 'tr1', tecnico_id: 'Tito', notas: 'Bridas', foto_url: 'https://drive.google.com/x', descripcion: null, contacto_id: null, local_id: null },
    { id: 'g2', created_at: new Date().toISOString(), tipo: 'cobro', importe: 60, fecha: hoy, categoria: null, trabajo_id: null, tecnico_id: 'Tito', notas: null, foto_url: null, descripcion: 'Cobro visita', contacto_id: 'ct1', local_id: 'l1' },
  ],
});
const APP = [{ area: 'gastos', tablas: ['gastos'], dueno: 'app' }];

async function contexto(browser, email, areas) {
  const base = baseMemoria(FIX(areas), {});
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  await preparar(ctx, { email, base });
  const fn = [];
  await ctx.route(`${SB}/functions/v1/gastos-ocr`, async route => {
    const b = route.request().postDataJSON();
    fn.push(b);
    const r = b.accion === 'compra' ? { ruta: 'compras/2026/10/x.pdf', tipo: b.tipo, lectura: { fecha: hoy, proveedor: 'DIVERSO CANARIAS SL', nif: 'B38111222', base: 100, impuesto: 7, total: 107 } }
      : b.accion === 'foto' ? { foto_url: 'hub:gastos/movimientos/2026/10/f.jpg' } : { url: 'https://x.test/firmada' };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r) });
  });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e.stack ?? e)));
  page.on('dialog', d => d.accept());
  return { ctx, page, base, fn, errores };
}
const toastCon = (page, t) => page.waitForFunction(x => document.getElementById('toast')?.textContent.includes(x), t);

const browser = await navegador();
const errores = [];
try {
  // ── Facturas de compra (técnico) ─────────────────────────────────────────
  let C = await contexto(browser, 'tito@ok.test', APP);
  let { page, base, fn } = C;
  await page.goto(`${srv.base}/#/almacen/facturas`);
  await page.waitForSelector('#afc-lista');
  ok((await page.textContent('#afc-lista')).includes('Vencida') && (await page.textContent('.di-cifras')).includes('99'), 'compras: la vencida sale marcada y en las cifras');
  await page.click('a[href="#/almacen/facturas/nueva"]');
  await page.waitForSelector('#afc-form');
  await page.setInputFiles('#afc-archivo', { name: 'factura.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 ' + 'x'.repeat(300)) });
  await page.waitForFunction(() => document.getElementById('afc-leido')?.textContent.includes('Leído por Claude'));
  ok(fn[0]?.accion === 'compra' && fn[0].tipo === 'application/pdf' && await page.inputValue('#afc-proveedor') === 'p1' && await page.inputValue('#afc-importe') === '107',
    'compras: el adjunto va a gastos-ocr, Claude rellena y el proveedor se elige por el NIF');
  await page.fill('#afc-numero', 'F-2026-88');
  await page.fill('#afc-vence', hoy);
  await page.click('#afc-form button[type="submit"]');
  await toastCon(page, 'Factura guardada');
  const nueva = base.db.facturas_compra.find(f => f.numero === 'F-2026-88');
  ok(nueva && nueva.archivo_path === 'compras/2026/10/x.pdf' && nueva.importe === 107 && nueva.base === 100 && nueva.estado === 'Pendiente', 'compras: guardada con su adjunto e importes');
  ok(await page.locator('[data-action="afcBorrar"]').count() === 0, 'compras: un técnico no ve «Eliminar»');
  // Desde un pedido
  await page.goto(`${srv.base}/#/almacen/pedidos/12`);
  await page.waitForSelector('a[href="#/almacen/facturas/nueva/p/pc1"]').catch(() => null);
  if (await page.locator('a[href="#/almacen/facturas/nueva/p/pc1"]').count()) await page.click('a[href="#/almacen/facturas/nueva/p/pc1"]');
  else await page.goto(`${srv.base}/#/almacen/facturas/nueva/p/pc1`);
  await page.waitForSelector('#afc-form');
  ok(await page.inputValue('#afc-proveedor') === 'p2' && await page.inputValue('#afc-pedido') === 'pc1' && await page.inputValue('#afc-importe') === '310', 'compras: desde un pedido, con su proveedor y su total');
  errores.push(...C.errores);
  await C.ctx.close();

  // ── Facturas de compra (admin): pagar y eliminar ─────────────────────────
  C = await contexto(browser, 'ana@ok.test', APP); ({ page, base } = C);
  await page.goto(`${srv.base}/#/almacen/facturas/fv`);
  await page.waitForSelector('#afc-form');
  await page.check('#afc-pagada');
  await page.click('#afc-form button[type="submit"]');
  await toastCon(page, 'Factura guardada');
  ok(base.db.facturas_compra[0].estado === 'Pagada', 'compras: marcarla pagada');
  await page.click('[data-action="afcBorrar"]');
  await page.waitForFunction(() => location.hash === '#/almacen/facturas');
  ok(!base.db.facturas_compra.some(f => f.id === 'fv'), 'compras: el admin la elimina');

  // ── Gastos de la app en Personas, con el área de la app ─────────────────
  await page.goto(`${srv.base}/#/personas/gastos`);
  await page.waitForSelector('#pm-lista');
  const txt = await page.textContent('#pm-lista');
  ok(txt.includes('Bridas') && txt.includes('#331 Instalar TPV') && txt.includes('Cobro visita') && txt.includes('Marta · Bar Pepe') && txt.includes('+60'),
    'personas: los gastos y cobros de la app, con su trabajo, contacto y sede, junto a los tickets');
  ok(await page.isDisabled('[data-action="pmNuevo"][data-p0="gasto"]') && await page.isVisible('#pm-seccion .area-app'), 'personas: con el área de la app, no se apuntan aquí');
  errores.push(...C.errores);
  await C.ctx.close();

  // ── Con el área del hub ──────────────────────────────────────────────────
  C = await contexto(browser, 'tito@ok.test', []); ({ page, base, fn } = C);
  await page.goto(`${srv.base}/#/personas/gastos`);
  await page.waitForSelector('#pm-lista');
  await page.click('[data-action="pmNuevo"][data-p0="gasto"]');
  await page.waitForSelector('#pm-form');
  await page.fill('#pm-importe', '8.40');
  await page.selectOption('#pm-categoria', 'Herramienta');
  await page.fill('#pm-trabajo-q', '331');
  await page.waitForSelector('[data-action="pmElegir"][data-p0="trabajo"]');
  await page.click('[data-action="pmElegir"][data-p0="trabajo"]');
  await page.setInputFiles('#pm-foto', { name: 't.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('x'.repeat(500)) });
  await page.waitForFunction(() => document.getElementById('pm-foto-estado')?.textContent.includes('Foto lista'));
  await page.click('#pm-form button[type="submit"]');
  await toastCon(page, 'Gasto guardado');
  const g = base.db.gastos.find(x => x.importe === 8.4);
  ok(g && g.tipo === 'gasto' && g.categoria === 'Herramienta' && g.trabajo_id === 'tr1' && g.tecnico_id === 'Tito' && g.foto_url === 'hub:gastos/movimientos/2026/10/f.jpg',
    'personas: gasto con trabajo, foto al almacén privado y a nombre de quien lo apunta');
  await page.goto(`${srv.base}/#/personas/gastos/cobro/t/tr1`);
  await page.waitForSelector('#pm-form');
  ok(await page.inputValue('#pm-trabajo-q') === '#331 Instalar TPV' && await page.locator('#pm-categoria').count() === 0, 'personas: el cobro desde un trabajo nace con él (y sin categoría)');
  await page.fill('#pm-importe', '30');
  await page.click('#pm-form button[type="submit"]');
  await page.waitForTimeout(300);
  ok(!base.db.gastos.some(x => x.importe === 30) && await page.$eval('#pm-texto', e => !e.checkValidity()), 'personas: sin descripción, el cobro no se guarda');
  await page.fill('#pm-texto', 'Pago en mano');
  await page.click('#pm-form button[type="submit"]');
  await toastCon(page, 'Cobro guardado');
  ok(base.db.gastos.some(x => x.tipo === 'cobro' && x.importe === 30 && x.descripcion === 'Pago en mano' && x.trabajo_id === 'tr1'), 'personas: cobro con descripción obligatoria');
  await page.goto(`${srv.base}/#/personas/gastos/mov/g1`);
  await page.waitForSelector('#pm-form');
  await page.fill('#pm-texto', 'Bridas y tacos');
  await page.click('#pm-form button[type="submit"]');
  await toastCon(page, 'Gasto guardado');
  ok(base.db.gastos.find(x => x.id === 'g1').notas === 'Bridas y tacos' && await page.locator('[data-action="pmBorrar"]').count() === 0, 'personas: editar; borrar no es del técnico');
  await page.goto(`${srv.base}/#/personas/gastos`);
  await page.waitForSelector('#pm-lista');
  await page.screenshot({ path: `${CAPTURAS}/compras-gastos.png` });
  errores.push(...C.errores);
  await C.ctx.close();

  ok(!errores.length, `sin errores JS${errores.length ? ': ' + errores.join(' | ') : ''}`);
} finally {
  await browser.close();
  srv.parar();
}
if (!fallos()) console.log('\nTodo bien');
process.exit(fallos() ? 1 : 0);
