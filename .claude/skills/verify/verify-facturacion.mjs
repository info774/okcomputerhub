// Arnés de la fase 11 (facturación propia, SIN ACTIVAR): aviso de sin activar
// y serie real deshabilitada, borrador de prueba con líneas e IGIC, emitir
// (RPC simulado), factura emitida para imprimir (marca PRUEBA, huella),
// cobro, rectificar, desde trabajos por facturar (línea por trabajo + su
// material), datos del emisor; un técnico no entra. Móvil.
//   npm run build && node .claude/skills/verify/verify-facturacion.mjs
import { servidor, navegador, baseMemoria, preparar, contador } from './comun.mjs';

const { ok, fallos, sumar } = contador();
const srv = await servidor(4190);
const C1 = 'c1111111-1111-1111-1111-111111111111';
const EMITIDA = 'fe111111-1111-1111-1111-111111111111';
const INICIAL = {
  usuarios: [{ id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true }, { id: 'u-tito', nombre: 'Tito', email: 'tito@ok.test', rol: 'tecnico', activo: true }],
  areas: [], sync_estado: [], proyectos: [],
  config: [{ clave: 'facturacion_activa', valor: false }, { clave: 'facturacion_emisor', valor: { nombre: 'Dalmon Sistemas S.L.', nif: '' } }],
  series_factura: [{ codigo: 'F', nombre: 'Facturas', prueba: false, rectificativa: false, activa: true }, { codigo: 'P', nombre: 'PRUEBA (sin valor fiscal)', prueba: true, rectificativa: false, activa: true },
    { codigo: 'R', nombre: 'Rectificativas', prueba: false, rectificativa: true, activa: true }],
  clientes: [{ id: C1, nombre: 'Hotel Playa SL', nif: 'B38111111', direccion: 'Adeje', email: 'h@x.test', activo: true }],
  facturas: [{ id: EMITIDA, created_at: '2026-09-01T10:00:00Z', serie: 'P', codigo: 'P-2026-0001', estado: 'emitida', tipo: 'ordinaria', cliente_id: C1, cliente_nombre: 'Hotel <b>Playa</b> SL', cliente_nif: 'B38111111',
    cliente_direccion: 'Adeje', emisor: { nombre: 'Dalmon Sistemas S.L.', nif: 'B38000000' }, fecha_emision: '2026-09-01', vencimiento: '2026-10-01', forma_pago: 'Transferencia', notas: null,
    base_total: 100, impuesto_total: 7, total: 107, cobrado: 0, huella: 'ab'.repeat(32), huella_anterior: null, trabajo_ids: [] }],
  factura_lineas: [{ id: 'l0', factura_id: EMITIDA, orden: 1, concepto: 'Mantenimiento', detalle: null, cantidad: 1, precio: 100, descuento_pct: 0, impuesto_pct: 7, base: 100 }],
  factura_cobros: [],
  trabajos: [{ id: 't1', numero: 151, titulo: 'Cambiar router', descripcion: 'Se cambia el router y se configura la wifi', estado: 'Para facturar', cliente_id: C1, fecha_programada: '2026-09-20' },
    { id: 't2', numero: 152, titulo: 'Otro', descripcion: null, estado: 'Completado', cliente_id: C1, fecha_programada: null }],
  documento_lineas: [{ trabajo_id: 't1', nombre: 'Router TP-Link', cantidad: 1, precio: 45, descuento: 0, orden: 1 }],
};
const RPC = {
  emitir_factura: (b, db) => { const f = db.facturas.find(x => x.id === b.p_id); if (f.serie !== 'P') throw new Error('La facturación propia no está activada'); Object.assign(f, { estado: 'emitida', codigo: 'P-2026-0002', huella: 'cd'.repeat(32) }); return f; },
  crear_rectificativa: (b, db) => { const id = 'fr111111-1111-1111-1111-111111111111'; db.facturas.push({ ...db.facturas.find(x => x.id === b.p_id), id, estado: 'borrador', codigo: null, tipo: 'rectificativa', motivo_rectificacion: b.p_motivo }); return id; },
};

async function contexto(browser, email, viewport = { width: 1280, height: 900 }) {
  const base = baseMemoria(INICIAL, RPC);
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport });
  await preparar(ctx, { email, base });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
  page.on('dialog', d => d.type() === 'prompt' ? d.accept('Precio mal puesto') : d.accept());
  return { ctx, page, base, errores };
}
const toastCon = (page, t) => page.waitForFunction(x => document.getElementById('toast')?.textContent.includes(x), t);

const browser = await navegador();
try {
  const A = await contexto(browser, 'ana@ok.test');
  const { page, base } = A;
  await page.goto(`${srv.base}/#/facturacion`);
  await page.waitForSelector('.fa-banner');
  ok((await page.textContent('.fa-banner')).includes('Sin activar'), 'lista: avisa de que está sin activar');
  await page.click('[data-action="faNueva"]');
  await page.waitForSelector('#fa-serie');
  const nueva = base.db.facturas.find(f => f.estado === 'borrador');
  ok(nueva?.serie === 'P', 'nueva: sin activar, nace en la serie de PRUEBA');
  ok(await page.$eval('#fa-serie option[value="F"]', o => o.disabled), 'nueva: la serie real no se puede elegir');
  await page.fill('#fa-cliente-q', 'hotel');
  await page.click('[data-action="faElegirCliente"]');
  await page.waitForFunction(() => document.getElementById('fa-nif').value === 'B38111111');
  await page.click('form[data-on-submit="faGuardar"] button[type=submit]');
  await toastCon(page, 'Guardado');
  ok(base.db.facturas.find(f => f.id === nueva.id).cliente_nombre === 'Hotel Playa SL', 'nueva: cliente y NIF de su ficha');
  await page.waitForSelector('#fa-l-concepto');
  await page.fill('#fa-l-concepto', 'Revisión de la red');
  await page.fill('#fa-l-precio', '60');
  await page.click('form[data-on-submit="faAnadirLinea"] button[type=submit]');
  await page.waitForSelector('select[aria-label="IGIC"]');
  const l = base.db.factura_lineas.find(x => x.factura_id === nueva.id);
  ok(l?.concepto === 'Revisión de la red' && l.precio === 60, 'nueva: añadir línea');
  await page.selectOption('select[aria-label="IGIC"]', '3');
  await page.waitForFunction(id => true, null);
  for (let i = 0; i < 30 && base.db.factura_lineas.find(x => x.id === l.id).impuesto_pct !== 3; i++) await page.waitForTimeout(100);
  ok(base.db.factura_lineas.find(x => x.id === l.id).impuesto_pct === 3, 'nueva: IGIC por línea');
  await page.waitForSelector('[data-action="faEmitir"]');
  await page.click('[data-action="faEmitir"]');
  await toastCon(page, 'Emitida P-2026-0002');
  ok(base.reg.escrituras.some(e => e.metodo === 'RPC' && e.tabla === 'emitir_factura' && e.cuerpo.p_id === nueva.id), 'emitir: por hub.emitir_factura()');

  // Emitida: imprimir, cobrar, rectificar
  await page.goto(`${srv.base}/#/facturacion/${EMITIDA}`);
  await page.waitForSelector('.fa-factura');
  ok(await page.locator('.fa-marca').count() === 1 && (await page.textContent('.fa-huella')).includes('abab') && await page.locator('.fa-factura b').count() === 0, 'emitida: marca de PRUEBA, huella y datos escapados');
  ok(await page.locator('[data-action="faLinea"], input[aria-label="Concepto"]').count() === 0, 'emitida: no se edita');
  await page.fill('#fa-cobro-imp', '50');
  await page.click('form[data-on-submit="faCobrar"] button[type=submit]');
  await toastCon(page, 'Cobro apuntado');
  ok(base.db.factura_cobros.some(c => c.factura_id === EMITIDA && c.importe === 50), 'emitida: apuntar un cobro');
  await page.waitForSelector('[data-action="faRectificar"]');
  await page.click('[data-action="faRectificar"]');
  await page.waitForSelector('#fa-serie');
  ok(base.reg.escrituras.some(e => e.tabla === 'crear_rectificativa' && e.cuerpo.p_motivo === 'Precio mal puesto'), 'emitida: rectificar con motivo');

  // Desde trabajos
  await page.goto(`${srv.base}/#/facturacion/trabajos`);
  await page.waitForSelector('.fa-tr');
  await page.uncheck('.fa-tr[value="t2"]');
  await page.click(`[data-action="faDesdeTrabajos"][data-p0="${C1}"]`);
  await page.waitForSelector('#fa-serie');
  const deTr = base.db.facturas.find(f => (f.trabajo_ids ?? []).includes('t1'));
  const lts = base.db.factura_lineas.filter(x => x.factura_id === deTr?.id);
  ok(deTr?.cliente_nif === 'B38111111' && !deTr.trabajo_ids.includes('t2') && lts.length === 2 && lts[0].concepto.includes('#151') && lts[0].detalle.includes('wifi') && lts[1].concepto === 'Router TP-Link' && lts[1].precio === 45,
    'desde trabajos: una línea por trabajo con lo que se hizo, más su material');

  // Emisor
  await page.goto(`${srv.base}/#/facturacion/ajustes`);
  await page.waitForSelector('input[name="nif"]');
  await page.fill('input[name="nif"]', 'B38000000');
  await page.click('form[data-on-submit="faGuardarEmisor:$this"] button[type=submit]');
  await toastCon(page, 'Datos del emisor guardados');
  ok(base.db.config.find(c => c.clave === 'facturacion_emisor').valor.nif === 'B38000000', 'ajustes: datos del emisor');
  ok(await page.locator('text=ACTIVADA').count() === 0 && (await page.textContent('main')).includes('sin activar'), 'ajustes: no hay botón de activar');
  ok(!base.reg.escrituras.some(e => ['trabajos', 'documento_lineas', 'clientes'].includes(e.tabla)), 'no se escribe en el espejo de la app');
  ok(A.errores.length === 0, `admin: sin errores JS${A.errores.length ? ': ' + A.errores.join(' | ') : ''}`);
  await A.ctx.close();

  const T = await contexto(browser, 'tito@ok.test');
  await T.page.goto(`${srv.base}/#/facturacion`);
  await T.page.waitForSelector('text=solo para administradores');
  ok(await T.page.locator('.menu-item[data-mod="facturacion"]').count() === 0, 'técnico: ni en el menú ni por URL');
  await T.ctx.close();

  const M = await contexto(browser, 'ana@ok.test', { width: 390, height: 844 });
  for (const [r, sel] of [['facturacion', '.fa-banner'], [`facturacion/${EMITIDA}`, '.fa-factura'], ['facturacion/trabajos', '.fa-tr'], ['facturacion/ajustes', 'input[name="nif"]']]) {
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
