// Arnés del bloque 3 de paridad: presupuestos con escritura (alta con varias
// plantillas que se juntan, líneas del catálogo y a mano, desde una
// oportunidad, editar, duplicar, imprimible con IGIC, a Zoho, convertir en
// trabajo, plantillas, eliminar solo admin) y facturar trabajos (selección en
// «Por facturar», líneas como la app con fichajes, artículos o los del
// presupuesto y materiales; sede sin cliente; factura nueva, añadir a un
// borrador y presupuesto desde trabajos). Zoho simulado. Sin corte: nada se escribe.
//   npm run build && node .claude/skills/verify/verify-presupuestos-escritura.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS, SB } from './comun.mjs';

const { ok, fallos } = contador();
const srv = await servidor(4175);
const hoy = new Date().toLocaleDateString('sv-SE');
const C1 = 'c1111111-1111-1111-1111-111111111111', C2 = 'c2222222-2222-2222-2222-222222222222';
const L1 = 'a1111111-1111-1111-1111-111111111111', L9 = 'a9999999-9999-9999-9999-999999999999';
const P1 = 'b1111111-1111-1111-1111-111111111111', P3 = 'b3333333-3333-3333-3333-333333333333';
const T1 = 'e1111111-1111-1111-1111-111111111111', T2 = 'e2222222-2222-2222-2222-222222222222', T3 = 'e3333333-3333-3333-3333-333333333333';
const O1 = 'f1111111-1111-1111-1111-111111111111';
const base0 = cortado => ({
  usuarios: [{ id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true }, { id: 'u-tito', nombre: 'Tito Pérez', email: 'tito@ok.test', rol: 'tecnico', activo: true }],
  areas: [
    { area: 'presupuestos', dueno: cortado ? 'hub' : 'app', tablas: ['presupuestos', 'presupuesto_plantillas'] },
    { area: 'trabajos', dueno: cortado ? 'hub' : 'app', tablas: ['trabajos', 'agenda', 'sesiones', 'documento_lineas'] },
    { area: 'clientes', dueno: cortado ? 'hub' : 'app', tablas: ['clientes', 'locales', 'contactos'] },
  ],
  sync_estado: [], proyectos: [], clientes_crm: [], actividades: [], tickets: [], agenda: [], trabajo_comentarios: [], trabajo_fotos: [],
  config: [{ clave: 'facturacion_emisor', valor: { nombre: 'Ok Computer Tenerife', nif: 'B76543210', email: 'info@ok.test', telefono: '922000000' } }],
  clientes: [{ id: C1, nombre: 'Hotel Playa SL', nif: 'B11111111', activo: true, zoho_id: '9001' }, { id: C2, nombre: 'Bar Sol', activo: true, zoho_id: null }],
  locales: [{ id: L1, cliente_id: C1, nombre: 'Hotel Playa Recepción', activo: true }, { id: L9, cliente_id: null, nombre: 'Kiosco suelto', activo: true }],
  contactos: [{ id: 'k1', cliente_id: C1, nombre: 'Marta', activo: true }],
  oportunidades: [{ id: O1, titulo: 'Wifi terraza', descripcion: 'Quiere cobertura en toda la terraza', cliente_id: C1, local_id: L1, contacto_id: 'k1', estado: 'Detectado' }],
  catalogo: [{ id: 'cat1', nombre: 'Punto de acceso WiFi 6', precio: 120, categoria: 'Redes', referencia: 'AP6', unidad: 'ud', activo: true }],
  presupuesto_plantillas: [
    { id: 'pl1', nombre: 'Wifi básico', icono: '📶', activa: true, lineas: [{ nombre: 'Punto de acceso WiFi 6', cantidad: 1, precio: 120, descuento: 0 }, { nombre: 'Instalación', cantidad: 1, precio: 60, descuento: 0 }] },
    { id: 'pl2', nombre: 'Cableado', icono: '🔌', activa: true, lineas: [{ nombre: 'Instalación', cantidad: 1, precio: 60, descuento: 0 }, { nombre: 'Cable UTP (m)', cantidad: 20, precio: 1, descuento: 0 }] },
  ],
  presupuestos: [
    { id: P1, titulo: 'Cámaras cocina', estado: 'Borrador', total: 300, fecha: hoy, created_at: hoy, cliente_id: C1, local_id: L1, tecnico_id: 'Tito Pérez', zoho_estimate_id: null },
    { id: P3, titulo: 'TPV dos puestos', estado: 'Aceptado', total: 900, fecha: hoy, created_at: hoy, cliente_id: C1, numero_presupuesto: 'P-0103' },
  ],
  documento_lineas: [
    { id: 'd1', presupuesto_id: P1, nombre: 'Cámara IP', cantidad: 2, precio: 150, descuento: 0, subtotal: 300, orden: 1 },
    { id: 'd3', presupuesto_id: P3, nombre: 'TPV táctil', cantidad: 1, precio: 900, descuento: 0, subtotal: 900, orden: 1 },
    { id: 'd4', trabajo_id: T1, nombre: 'Router', cantidad: 1, precio: 80, descuento: 0, subtotal: 80, orden: 1 },
  ],
  trabajos: [
    { id: T1, numero: 501, titulo: 'Cambiar router', descripcion: 'Router nuevo en recepción', estado: 'Para facturar', cliente_id: C1, local_id: L1, materiales: '2 latiguillo RJ45\nbridas', tecnicos: ['Tito Pérez'], created_at: hoy },
    { id: T2, numero: 502, titulo: 'Instalar TPV', descripcion: '', estado: 'Completado', cliente_id: C1, local_id: L1, presupuesto_id: P3, tecnicos: ['Tito Pérez'], created_at: hoy },
    { id: T3, numero: 503, titulo: 'Revisar caja', descripcion: 'No abre', estado: 'Para facturar', cliente_id: null, local_id: L9, tecnicos: ['Tito Pérez'], created_at: hoy },
  ],
  sesiones: [{ id: 's1', entidad_tipo: 'trabajo', entidad_id: T1, inicio: `${hoy}T09:00:00Z`, fin: `${hoy}T10:30:00Z`, duracion_min: 90, tecnico_nombre: 'Tito Pérez', created_at: `${hoy}T09:00:00Z` }],
});
const RPC = {
  presupuesto_guardar_lineas: (b, db) => {
    db.documento_lineas = db.documento_lineas.filter(l => l.presupuesto_id !== b.p_presupuesto);
    let total = 0;
    b.p_lineas.filter(l => (l.nombre ?? '').trim()).forEach((l, i) => {
      const sub = Math.round((l.cantidad ?? 1) * (l.precio ?? 0) * (1 - (l.descuento ?? 0) / 100) * 100) / 100;
      total += sub;
      db.documento_lineas.push({ id: `n${Math.random()}`, presupuesto_id: b.p_presupuesto, nombre: l.nombre, cantidad: l.cantidad, precio: l.precio, descuento: l.descuento ?? 0, subtotal: sub, orden: i + 1 });
    });
    const p = db.presupuestos.find(x => x.id === b.p_presupuesto); if (p) p.total = total;
    return total;
  },
  trabajo_desde_presupuesto: (b, db) => { db.trabajos.push({ id: 'nuevo-t', numero: 900, titulo: 'x', estado: 'Pendiente', presupuesto_id: b.p_presupuesto }); return { id: 'nuevo-t', numero: 900 }; },
};

async function contexto(browser, { cortado = true, email = 'ana@ok.test' } = {}) {
  const base = baseMemoria(base0(cortado), RPC);
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  await preparar(ctx, { email, base });
  const fn = [];
  await ctx.route(`${SB}/functions/v1/zoho-ventas`, route => {
    const b = JSON.parse(route.request().postData() || '{}');
    fn.push(b);
    const r = b.accion === 'presupuesto' ? { zoho_estimate_id: '777', numero: 'EST-0042', actualizado: false }
      : b.accion === 'borradores' ? { facturas: [{ invoice_id: '55501', invoice_number: 'F26-0100', reference_number: 'Octubre', total: 120 }] }
      : { invoice_id: b.invoice_id ?? '55599', invoice_number: b.accion === 'anadir' ? 'F26-0100' : 'F26-0101' };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r) });
  });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
  page.on('dialog', d => d.accept());
  return { ctx, page, base, fn, errores };
}
const escr = (base, m, t) => base.reg.escrituras.filter(e => e.metodo === m && e.tabla === t);
const toast = (page, txt) => page.waitForFunction(t => document.getElementById('toast')?.textContent.includes(t), txt);

const browser = await navegador();
try {
  // ── Sin corte ───────────────────────────────────────────────────────────
  const A = await contexto(browser, { cortado: false });
  await A.page.goto(`${srv.base}/#/presupuestos`);
  await A.page.waitForSelector('#pp-tabla');
  ok(await A.page.locator('a[href="#/presupuestos/nuevo"]').count() === 0, 'sin corte: sin alta de presupuestos');
  await A.page.goto(`${srv.base}/#/presupuestos/${P1}`);
  await A.page.waitForSelector('#pp-lineas');
  ok(await A.page.locator('[data-action="ppZoho"]').count() === 0 && await A.page.locator(`a[href="#/presupuestos/${P1}/pdf"]`).count() === 1, 'sin corte: la ficha imprime, pero ni edita ni manda a Zoho');
  await A.page.goto(`${srv.base}/#/presupuestos/nuevo`);
  await A.page.waitForSelector('#pf-form');
  ok(await A.page.isDisabled('#pf-form button[type=submit]'), 'sin corte: el formulario no guarda');
  await A.page.goto(`${srv.base}/#/trabajos/501`);
  await A.page.waitForSelector('.tarjeta-cab');
  ok(await A.page.locator('a[href^="#/trabajos/facturar/"]').count() === 0, 'sin corte: el trabajo no ofrece facturar');
  ok(A.base.reg.escrituras.filter(e => e.metodo !== 'RPC').length === 0 && A.fn.length === 0 && A.errores.length === 0, `sin corte: nada escrito y sin errores${A.errores.length ? ': ' + A.errores.join(' | ') : ''}`);
  await A.ctx.close();

  // ── Presupuestos con corte ──────────────────────────────────────────────
  const B = await contexto(browser);
  let { page, base, fn } = B;
  await page.goto(`${srv.base}/#/presupuestos`);
  await page.click('a[href="#/presupuestos/nuevo"]');
  await page.waitForSelector('#pf-form');
  await page.fill('#pf-cliente-q', 'Hotel');
  await page.click('[data-action="pfElegirCliente"]');
  await page.waitForFunction(() => document.querySelectorAll('#pf-sede option').length === 2);
  await page.selectOption('#pf-sede', L1);
  await page.click('[data-action="pfPlantilla"][data-p0="pl1"]');
  await page.click('[data-action="pfPlantilla"][data-p0="pl2"]');
  ok((await page.inputValue('#pf-titulo')) === 'Pack Wifi básico + Cableado' && await page.locator('#pf-lin tbody tr').count() === 3
    && (await page.textContent('#pf-lin-total')).includes('260'), 'plantillas: dos se juntan (la misma «Instalación» suma) y dan el asunto');
  await page.fill('#pf-lin-cat', 'wifi');
  await page.waitForSelector('[data-action="lnCatElegir"]');
  await page.click('[data-action="lnCatElegir"]');
  await page.waitForFunction(() => document.querySelector('#pf-lin tr[data-linea="0"] input[aria-label="cantidad"]')?.value === '2');
  ok(true, 'catálogo: elegir un artículo que ya está suma su cantidad');
  await page.click('[data-action="lnAnadir"]');
  await page.fill('#pf-lin tr[data-linea="3"] input[aria-label="Concepto"]', 'Desplazamiento');
  await page.dispatchEvent('#pf-lin tr[data-linea="3"] input[aria-label="Concepto"]', 'change');
  await page.fill('#pf-lin tr[data-linea="3"] input[aria-label="precio"]', '25');
  await page.dispatchEvent('#pf-lin tr[data-linea="3"] input[aria-label="precio"]', 'change');
  await page.click('#pf-lin tr[data-linea="2"] [data-action="lnQuitar"]');
  await page.click('#pf-form button[type=submit]');
  await page.waitForSelector('#pp-lineas');
  const np = escr(base, 'POST', 'presupuestos').at(-1)?.cuerpo;
  const rpcL = base.reg.escrituras.filter(e => e.metodo === 'RPC' && e.tabla === 'presupuesto_guardar_lineas').at(-1)?.cuerpo;
  ok(np?.cliente_id === C1 && np?.local_id === L1 && np?.estado === 'Borrador' && np?.titulo === 'Pack Wifi básico + Cableado', 'alta: presupuesto en borrador con cliente y sede');
  ok(JSON.stringify(rpcL?.p_lineas.map(l => [l.nombre, l.cantidad, l.precio])) === JSON.stringify([['Punto de acceso WiFi 6', 2, 120], ['Instalación', 2, 60], ['Desplazamiento', 1, 25]]),
    `alta: las líneas van por presupuesto_guardar_lineas (${JSON.stringify(rpcL?.p_lineas.map(l => l.nombre))})`);
  ok((await page.textContent('.pp-total')).includes('385'), 'alta: la ficha enseña el total que dejó la base');
  // Desde una oportunidad
  await page.goto(`${srv.base}/#/presupuestos/nuevo/o/${O1}`);
  await page.waitForSelector('#pf-form');
  ok((await page.inputValue('#pf-titulo')) === 'Wifi terraza' && (await page.inputValue('#pf-exigencias')).includes('terraza') && (await page.inputValue('#pf-cliente')) === C1
    && (await page.inputValue('#pf-sede')) === L1 && (await page.inputValue('#pf-contacto')) === 'k1', 'desde la oportunidad: asunto, lo que pide, cliente, sede y contacto');
  await page.click('#pf-form button[type=submit]');
  await page.waitForSelector('#pp-lineas');
  ok(escr(base, 'POST', 'presupuestos').at(-1)?.cuerpo?.oportunidad_id === O1, 'desde la oportunidad: queda enlazado');
  // Editar: estado
  await page.goto(`${srv.base}/#/presupuestos/${P1}/editar`);
  await page.waitForSelector('#pf-form');
  ok(await page.locator('#pf-lin tbody tr').count() === 1, 'editar: trae sus líneas');
  await page.selectOption('#pf-estado', 'Aceptado');
  await page.click('#pf-form button[type=submit]');
  await page.waitForSelector('#pp-lineas');
  ok(escr(base, 'PATCH', 'presupuestos').at(-1)?.cuerpo?.estado === 'Aceptado', 'editar: el estado se guarda');
  // Duplicar, Zoho, a trabajo
  await page.click('[data-action="ppDuplicar"]');
  await page.waitForFunction(id => !location.hash.includes(id), P1);
  const dup = escr(base, 'POST', 'presupuestos').at(-1)?.cuerpo;
  ok(dup?.titulo === 'Cámaras cocina (copia)' && dup?.estado === 'Borrador' && !('zoho_estimate_id' in dup)
    && base.reg.escrituras.filter(e => e.tabla === 'presupuesto_guardar_lineas').at(-1)?.cuerpo?.p_lineas.length === 1, 'duplicar: copia en borrador, sin Zoho, con sus líneas');
  await page.goto(`${srv.base}/#/presupuestos/${P1}`);
  await page.waitForSelector('[data-action="ppZoho"]');
  await page.click('[data-action="ppZoho"]');
  await toast(page, 'EST-0042');
  ok(fn.at(-1)?.accion === 'presupuesto' && fn.at(-1)?.presupuesto_id === P1, 'Zoho: «Enviar a Zoho» llama a zoho-ventas con el presupuesto');
  await page.click(`a[href="#/presupuestos/${P1}/trabajo"]`);
  await page.waitForSelector('#pat-form');
  await page.fill('#pat-fecha', '2026-11-02');
  await page.fill('#pat-hora', '09:30');
  await page.click('#pat-form button[type=submit]');
  await page.waitForFunction(() => location.hash === '#/trabajos/900');
  const at = base.reg.escrituras.filter(e => e.tabla === 'trabajo_desde_presupuesto').at(-1)?.cuerpo;
  ok(at?.p_presupuesto === P1 && at?.p_datos?.descripcion === 'Cámaras cocina' && at?.p_datos?.tipo === 'Instalación' && at?.p_datos?.fecha === '2026-11-02'
    && JSON.stringify(at?.p_datos?.tecnicos) === '["Tito Pérez"]' && !!at?.p_datos?.hora_llegada, 'a trabajo: con descripción, tipo, fecha, hora y quien lo lleva');
  // Imprimible
  await page.goto(`${srv.base}/#/presupuestos/${P3}/pdf`);
  await page.waitForSelector('#ppd-doc');
  ok((await page.textContent('#ppd-total')).includes('963') && (await page.textContent('#ppd-doc')).includes('P-0103') && (await page.textContent('#ppd-doc')).includes('validez de 30 días'),
    'imprimible: número, IGIC del 7 % (900 → 963) y condiciones');
  // Plantillas
  await page.goto(`${srv.base}/#/presupuestos/plantillas/nueva`);
  await page.waitForSelector('#ppl-form');
  await page.fill('#ppl-nombre', 'Alarma básica');
  await page.click('[data-action="lnAnadir"]');
  await page.fill('#ppl-lin tr[data-linea="0"] input[aria-label="Concepto"]', 'Hub alarma');
  await page.dispatchEvent('#ppl-lin tr[data-linea="0"] input[aria-label="Concepto"]', 'change');
  await page.click('#ppl-form button[type=submit]');
  await page.waitForSelector('#ppl-tabla');
  const pl = escr(base, 'POST', 'presupuesto_plantillas').at(-1)?.cuerpo;
  ok(pl?.nombre === 'Alarma básica' && pl?.lineas?.[0]?.nombre === 'Hub alarma' && pl?.activa === true, 'plantillas: se crean con sus líneas');
  await page.click('[data-action="pplQuitar"][data-p0="pl2"]');
  await toast(page, 'quitada');
  ok(escr(base, 'PATCH', 'presupuesto_plantillas').at(-1)?.cuerpo?.activa === false && escr(base, 'DELETE', 'presupuesto_plantillas').length === 0, 'plantillas: quitar = activa false');
  // Eliminar (admin)
  await page.goto(`${srv.base}/#/presupuestos/${P3}`);
  await page.click('[data-action="ppEliminar"]');
  await page.waitForFunction(() => location.hash === '#/presupuestos');
  ok(escr(base, 'DELETE', 'presupuestos').at(-1)?.url.includes(P3), 'eliminar: un admin lo borra');
  ok(B.errores.length === 0, `presupuestos: sin errores${B.errores.length ? ': ' + B.errores.join(' | ') : ''}`);
  await B.ctx.close();

  // ── Facturar trabajos ───────────────────────────────────────────────────
  const F = await contexto(browser);
  ({ page, base, fn } = F);
  await page.goto(`${srv.base}/#/trabajos`);
  await page.click('[data-action="trFiltro"][data-p0="facturar"]');
  await page.waitForSelector('[data-action="trSel"]');
  await page.click(`[data-action="trSel"][data-p0="${T1}"]`);
  await page.click(`[data-action="trSel"][data-p0="${T2}"]`);
  ok(page.url().endsWith('#/trabajos') && (await page.textContent('#tr-sel')).includes('2 trabajos'), 'por facturar: marcar no abre la ficha y cuenta los marcados');
  await page.click('[data-action="trFacturarSel"]');
  await page.waitForSelector('#ft-form');
  await page.screenshot({ path: `${CAPTURAS}/facturar-pantalla.png`, fullPage: true });
  const filas = await page.$$eval('#ft-lineas tbody tr', trs => trs.map(t => [...t.querySelectorAll('input,textarea')].map(i => i.value).join(' | ')));
  ok(filas[0].startsWith('#501 - Hotel Playa Recepción') && filas[0].includes('Router nuevo en recepción') && filas[0].includes('1h 30min') && filas[0].includes('Total: 1h 30min'),
    `facturar: la línea del trabajo lleva sede, descripción y fichajes (${filas[0].slice(0, 90)}…)`);
  ok(filas.some(f => f.startsWith('Router | 1 | 80')) && filas.some(f => f.startsWith('latiguillo RJ45 | 2 | 0')) && filas.some(f => f.startsWith('bridas | 1 | 0'))
    && filas.some(f => f.startsWith('TPV táctil | 1 | 900')), 'facturar: artículos del trabajo, materiales escritos y, sin artículos, los del presupuesto');
  await page.fill('#ft-lineas tr[data-linea="0"] input[aria-label="Precio"]', '45');
  await page.dispatchEvent('#ft-lineas tr[data-linea="0"] input[aria-label="Precio"]', 'change');
  await page.click('#ft-form button[type=submit]');
  await toast(page, 'F26-0101');
  const fac = fn.at(-1);
  ok(fac?.accion === 'factura' && fac?.cliente_id === C1 && JSON.stringify(fac?.trabajo_ids) === JSON.stringify([T1, T2]) && fac?.lineas[0]?.precio === 45
    && fac?.lineas[0]?.nombre === '#501 - Hotel Playa Recepción' && fac?.lineas[0]?.detalle.includes('Router nuevo'), 'factura nueva: rótulo y detalle aparte, precios cambiados y los dos trabajos');
  // Sede sin cliente → añadir a un borrador
  await page.goto(`${srv.base}/#/trabajos/facturar/${T3}`);
  await page.waitForSelector('#ft-form');
  ok((await page.inputValue('#ft-cliente')) === '' && (await page.textContent('#ft-aviso-sedes')).includes('Kiosco suelto'), 'sede sin cliente: avisa y pide elegirlo');
  await page.click('#ft-form button[type=submit]');
  await toast(page, 'Elige el cliente');
  await page.fill('#ft-cliente-q', 'Hotel');
  await page.click('[data-action="ftElegirCliente"]');
  await page.check('input[name="ft-destino"][value="anadir"]');
  await page.waitForFunction(() => document.querySelector('#ft-borrador option')?.value === '55501');
  await page.click('#ft-form button[type=submit]');
  await toast(page, 'añadidos a la factura F26-0100');
  ok(fn.some(f => f.accion === 'borradores' && f.cliente_id === C1) && fn.at(-1)?.accion === 'anadir' && fn.at(-1)?.invoice_id === '55501' && JSON.stringify(fn.at(-1)?.trabajo_ids) === JSON.stringify([T3]),
    'añadir a borrador: lista los del cliente y añade el trabajo');
  ok(escr(base, 'PATCH', 'locales').at(-1)?.url.includes(L9) && escr(base, 'PATCH', 'locales').at(-1)?.cuerpo?.cliente_id === C1
    && escr(base, 'PATCH', 'trabajos').at(-1)?.url.includes(T3), 'sede sin cliente: el elegido se queda en la sede y en el trabajo');
  // Presupuesto desde trabajos (y a Zoho)
  await page.goto(`${srv.base}/#/trabajos/facturar/${T1}`);
  await page.waitForSelector('#ft-form');
  await page.check('input[name="ft-destino"][value="presupuesto"]');
  await page.check('#ft-zoho');
  await page.click('#ft-form button[type=submit]');
  await page.waitForSelector('#pp-lineas');
  const lp = base.reg.escrituras.filter(e => e.tabla === 'presupuesto_guardar_lineas').at(-1)?.cuerpo?.p_lineas;
  ok(escr(base, 'POST', 'presupuestos').at(-1)?.cuerpo?.titulo.startsWith('Trabajos #501') && lp?.[0]?.nombre.startsWith('#501 - Hotel Playa Recepción — Cambiar router')
    && fn.at(-1)?.accion === 'presupuesto', 'presupuesto desde trabajos: rótulo y detalle en una línea, y a Zoho');
  await page.goto(`${srv.base}/#/trabajos/501`);
  await page.waitForSelector('.tarjeta-cab');
  ok(await page.locator(`a[href="#/trabajos/facturar/${T1}"]`).count() === 1, 'ficha del trabajo: «💶 Facturar»');
  await page.goto(`${srv.base}/#/trabajos/${T2}`);
  await page.waitForSelector('.tarjeta-cab');
  ok((await page.textContent('.tarjeta-cab')).includes('#502'), 'la ficha del trabajo también se abre por su id');
  ok(F.errores.length === 0, `facturar: sin errores${F.errores.length ? ': ' + F.errores.join(' | ') : ''}`);
  await F.ctx.close();

  // ── Técnico: no elimina presupuestos ────────────────────────────────────
  const T = await contexto(browser, { email: 'tito@ok.test' });
  await T.page.goto(`${srv.base}/#/presupuestos/${P1}`);
  await T.page.waitForSelector('[data-action="ppDuplicar"]');
  ok(await T.page.locator('[data-action="ppEliminar"]').count() === 0, 'un técnico no tiene «Eliminar»');
  await T.ctx.close();
} finally {
  await browser.close();
  srv.parar();
}
process.exit(fallos() ? 1 : 0);
