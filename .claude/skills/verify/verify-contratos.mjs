// Arnés de contratos de mantenimiento (paridad bloque 4, tanda 2): Documentos
// (contratos con su estado y el del cobro; renovaciones a 60 días con preaviso,
// avisado y no renovar; insignia en la pestaña), el contrato de cada sede en
// la tabla maestra, generar desde una sede (plan, cuota NETA con su IGIC por
// periodo, datos del cliente y la sede, código de verificación en el
// documento), editar pendiente (todo; importe vacío = sin cuota) y firmado
// (solo sede, cliente y contacto), enlace, ver firmado, anular y eliminar
// (admin), el mundo sin corte, y la página pública contrato.html (leer,
// firmar con nombre + firma + casilla, estados, pago cuando lo haya) y
// mandato.html. La función firma-contrato va SIMULADA.
//
//   npm run build && node .claude/skills/verify/verify-contratos.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS, SB } from './comun.mjs';

const PUERTO = 4233;
const { ok, fallos, sumar } = contador();
const hoy = new Date();
const iso = d => d.toLocaleDateString('sv-SE');
const mesesAtras = (m, masDias = 0) => { const d = new Date(hoy); d.setMonth(d.getMonth() - m); d.setDate(d.getDate() + masDias); return iso(d); };

const FIX = {
  usuarios: [
    { id: 'u-fran', nombre: 'Fran Admin', email: 'admin@ok.test', rol: 'admin', activo: true },
    { id: 'u-mat', nombre: 'Matteo Monastero', email: 'tec@ok.test', rol: 'tecnico', activo: true },
  ],
  sync_estado: [], config: [], clientes_crm: [], trabajos: [], tickets: [], local_hardware: [], plan_tareas: [], sitio_tarea_seguimiento: [], areas: [],
  local_telefonos: [], contactos: [{ id: 'k1', nombre: 'Lola', cliente_id: 'c1', activo: true }],
  clientes: [{ id: 'c1', nombre: 'Polinesia Restaurante', nif: 'B38123456', activo: true }, { id: 'c2', nombre: 'Bananas Cafetería', nif: 'B38999999', activo: true }],
  locales: [
    { id: 'l1', nombre: 'Polinesia · Playa del Duque', cliente_id: 'c1', activo: true, plan: 'Premium', importe_mantenimiento: 49, frecuencia_pago: 'Anual',
      direccion: 'Av. Bruselas 12, Costa Adeje', codigo_verificacion: '482913', estado_pago: 'Al corriente' },
    { id: 'l2', nombre: 'Polinesia · Los Cristianos', cliente_id: 'c1', activo: true, plan: 'Silver', importe_mantenimiento: 79, estado_pago: 'Al corriente' },
    { id: 'l3', nombre: 'Bananas Cafetería', cliente_id: 'c2', activo: true, plan: 'Silver', importe_mantenimiento: 79, estado_pago: 'Al corriente' },
    { id: 'lb', nombre: 'Sede de baja', cliente_id: 'c2', activo: false, plan: 'Premium' },
  ],
  planes_mantenimiento: [
    { id: 'p1', nombre: 'Premium', orden: 1, precio_mensual: 49, frecuencia_pago: 'Mensual', activo: true, coste_presencial_estandar: 67, coste_presencial_urgente: 85,
      contrato_servicios: { incluidos: ['Soporte remoto ilimitado', 'Copia de seguridad diaria'], no_incluidos: ['Desplazamientos'] }, contrato_plantilla: null },
    { id: 'p2', nombre: 'Silver', orden: 2, precio_mensual: 79, frecuencia_pago: 'Mensual', activo: true, contrato_servicios: { incluidos: ['Todo lo de Premium'], no_incluidos: [] } },
    { id: 'p0', nombre: 'Sin mantenimiento', orden: 0, precio_mensual: null, activo: true },
  ],
  contratos: [
    { id: 'k1', token: 'a'.repeat(32), created_at: `${mesesAtras(12, 20)}T09:00:00Z`, plan_nombre: 'Premium', cliente_id: 'c1', local_id: 'l1', cliente_nombre: 'Polinesia Restaurante',
      precio_mensual: 49, frecuencia_pago: 'Anual', estado: 'firmado', firmante_nombre: 'Lola Pérez', firmado_at: `${mesesAtras(12, 20)}T10:00:00Z`, fecha_inicio: mesesAtras(12, 20),
      vigencia_meses: 12, renovacion_automatica: true, renovacion_avisada_at: null, cuerpo_html: '<div class="contrato-doc"><h1>CONTRATO PREMIUM</h1></div>',
      firma_img: 'data:image/png;base64,iVBORw0KGgo=', firmante_ip: '81.1.2.3', mandato_estado: 'pendiente' },
    { id: 'k2', token: 'b'.repeat(32), created_at: `${iso(hoy)}T08:00:00Z`, plan_nombre: 'Silver', cliente_id: 'c2', local_id: 'l3', cliente_nombre: 'Bananas Cafetería', cliente_nif: 'B38999999',
      precio_mensual: 79, frecuencia_pago: 'Mensual', estado: 'pendiente', cuerpo_html: '<p>Silver</p>', vigencia_meses: 12, renovacion_automatica: true, mandato_estado: 'pendiente' },
    { id: 'k3', token: 'c'.repeat(32), created_at: `${mesesAtras(2)}T08:00:00Z`, plan_nombre: 'Silver', cliente_id: 'c2', local_id: 'l3', cliente_nombre: 'Bananas Cafetería',
      precio_mensual: 79, estado: 'anulado', cuerpo_html: '<p>x</p>', vigencia_meses: 12, renovacion_automatica: true },
    { id: 'k4', token: 'd'.repeat(32), created_at: `${mesesAtras(12, 10)}T08:00:00Z`, plan_nombre: 'Premium', cliente_id: 'c2', local_id: 'lb', cliente_nombre: 'Bananas (cerrada)',
      precio_mensual: 49, estado: 'firmado', firmado_at: `${mesesAtras(12, 10)}T10:00:00Z`, fecha_inicio: mesesAtras(12, 10), vigencia_meses: 12, renovacion_automatica: true, cuerpo_html: '<p>x</p>' },
  ],
};
const RPC = { clases_clientes: () => [], linea_tiempo: () => [] };

const srv = await servidor(PUERTO);
const browser = await navegador();
const esc = (base, m, t) => base.reg.escrituras.filter(e => e.metodo === m && e.tabla === t);
const espera = (fn, ms = 4000) => new Promise((res, rej) => { const t0 = Date.now(); const i = setInterval(() => { if (fn()) { clearInterval(i); res(); } else if (Date.now() - t0 > ms) { clearInterval(i); rej(new Error('no llegó la escritura')); } }, 50); });

try {
  let ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  const base = baseMemoria(FIX, RPC);
  await preparar(ctx, { email: 'admin@ok.test', base });
  let page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
  page.on('dialog', d => d.accept());

  // ── Documentos ─────────────────────────────────────────────────────────
  await page.goto(`${srv.base}/#/mantenimientos/documentos`);
  await page.waitForSelector('#mdo-lista');
  ok((await page.textContent('nav.pestanas a[href="#/mantenimientos/documentos"] .insignia')) === '1', 'la pestaña Documentos cuenta las renovaciones sin avisar (la sede de baja no)');
  ok(await page.$$eval('#mdo-lista > li', l => l.length) === 4, 'los cuatro contratos');
  const k1 = await page.textContent('#mdo-lista li[data-contrato="k1"]');
  ok(k1.includes('Firmado') && k1.includes('Firmado por Lola Pérez') && k1.includes('Sin domiciliar') && k1.includes('49 €/mes · pago anual'), 'firmado: quién, cobro y cuota');
  ok((await page.textContent('#mdo-lista li[data-contrato="k2"]')).includes('Pendiente de firma') && !!(await page.$('#mdo-lista li[data-contrato="k2"] [data-action="mdoAnular"]')), 'pendiente, con «Anular» (admin)');
  ok(!(await page.$('#mdo-lista li[data-contrato="k3"] a[href$="/enlace"]')) && (await page.textContent('#mdo-lista li[data-contrato="k3"]')).includes('Anulado'), 'anulado: sin enlace ni edición');
  const rv = await page.$$eval('#mdo-renov-lista > li', l => l.map(x => x.dataset.renov));
  ok(rv.join(',') === 'k1', `renovaciones a 2 meses: solo la de la sede activa (${rv.join(',')})`);
  const rk1 = await page.textContent('#mdo-renov-lista li[data-renov="k1"]');
  ok(rk1.includes('Renueva el') && rk1.includes('(en 20 días)') && rk1.includes('Año 1') && rk1.includes('Pasado el plazo de preaviso'), 'renueva en 20 días: pasado el preaviso de 30');
  await page.click('[data-action="mdoRenov"][data-p0="todos"]');
  await page.waitForFunction(() => document.querySelectorAll('#mdo-renov-lista > li').length === 2);
  ok(true, '«Todos los firmados» incluye la sede de baja');
  await page.click('[data-action="mdoRenov"][data-p0="proximas"]');
  await page.click('#mdo-renov-lista li[data-renov="k1"] [data-action="mdoAvisado"]');
  await espera(() => esc(base, 'PATCH', 'contratos').length === 1);
  ok(!!esc(base, 'PATCH', 'contratos')[0].cuerpo.renovacion_avisada_at, 'marcar avisado');
  await page.waitForFunction(() => !document.querySelector('nav.pestanas .insignia'));
  ok((await page.textContent('#mdo-renov-lista li[data-renov="k1"]')).includes('Cliente avisado'), 'avisado: deja de contar en la pestaña');
  await page.click('#mdo-renov-lista li[data-renov="k1"] [data-action="mdoAuto"]');
  await espera(() => esc(base, 'PATCH', 'contratos').length === 2);
  ok(esc(base, 'PATCH', 'contratos')[1].cuerpo.renovacion_automatica === false, '«No renovar» (confirmado) apaga la renovación');
  await page.waitForFunction(() => document.querySelector('#mdo-renov-lista li[data-renov="k1"]')?.textContent.includes('No renueva: vence'));
  await page.screenshot({ path: `${CAPTURAS}/contratos-documentos.png`, fullPage: true });

  // ── Tabla maestra: el contrato de cada sede ───────────────────────────
  await page.goto(`${srv.base}/#/mantenimientos/locales`);
  await page.waitForSelector('#mt-tabla tr[data-sede="l1"]');
  ok(!!(await page.$('#mt-tabla tr[data-sede="l1"] a[href="#/mantenimientos/contrato/k1/ver"]')) && !!(await page.$('#mt-tabla tr[data-sede="l3"] a[href="#/mantenimientos/contrato/k2/enlace"]'))
    && !!(await page.$('#mt-tabla tr[data-sede="l2"] a[href="#/mantenimientos/contrato/nuevo/l2"]')), 'cada sede: ver el firmado, firmar el pendiente o crearlo');

  // ── Generar desde la sede ──────────────────────────────────────────────
  await page.goto(`${srv.base}/#/mantenimientos/contrato/nuevo/l1`);
  await page.waitForSelector('#mco-form');
  ok((await page.inputValue('#mco-plan')) === 'Premium' && (await page.inputValue('#mco-importe')) === '49' && (await page.inputValue('#mco-frecuencia')) === 'Anual'
    && (await page.inputValue('#mco-cliente')) === 'c1' && (await page.inputValue('#mco-sede')) === 'l1', 'desde la sede: cliente, sede, plan, cuota y frecuencia ya puestos');
  const nota = await page.textContent('#mco-cuota-nota');
  ok(nota.includes('629,16 €') && nota.includes('cada año') && nota.includes('49 €/mes × 12 meses'), `cuota del periodo con IGIC (${nota})`);
  await page.click('[data-action="mcoBorrador"]');
  await page.waitForSelector('#mco-borrador:not([hidden]) .contrato-doc');
  const doc = await page.textContent('#mco-borrador');
  ok(doc.includes('MODALIDAD PREMIUM') && doc.includes('49 € / mes + IGIC') && doc.includes('La facturación es anual') && doc.includes('588 € + IGIC')
    && doc.includes('Polinesia Restaurante con NIF B38123456') && doc.includes('Av. Bruselas 12') && doc.includes('482913') && doc.includes('Copia de seguridad diaria')
    && doc.includes('Desplazamientos') && doc.includes('67 € estándar / 85 € urgente'), 'el borrador sale con plan, precio, periodo, cliente, dirección, código, servicios y tarifas');
  await page.click('.mco-caracs summary');
  await page.fill('#mco-serv-inc', 'Soporte remoto ilimitado\nUna visita al trimestre');
  await page.fill('#mco-municipio', 'Adeje');
  await page.click('#mco-form button[type=submit]');
  await page.waitForSelector('#mco-enlace');
  const nuevo = esc(base, 'POST', 'contratos')[0]?.cuerpo;
  ok(/^[0-9a-f]{32}$/.test(nuevo?.token) && nuevo.estado === 'pendiente' && nuevo.precio_mensual === 49 && nuevo.frecuencia_pago === 'Anual' && nuevo.local_id === 'l1'
    && nuevo.cliente_nombre === 'Polinesia Restaurante' && nuevo.cliente_nif === 'B38123456' && nuevo.direccion === 'Av. Bruselas 12, Costa Adeje' && nuevo.municipio === 'Adeje'
    && nuevo.servicios.incluidos[1] === 'Una visita al trimestre' && nuevo.cuerpo_html.includes('Una visita al trimestre') && nuevo.created_by === 'u-fran',
    'generar: token, pendiente, condiciones, datos del documento y características pactadas');
  ok((await page.inputValue('#mco-url')).endsWith(`/contrato.html?token=${nuevo.token}`) && (await page.getAttribute('#mco-wa', 'href')).includes(encodeURIComponent('contrato.html?token=')),
    'y a continuación el enlace para firmar (copiar, aquí, WhatsApp, correo)');

  // ── Editar: pendiente (todo) y firmado (solo a quién va) ──────────────
  await page.goto(`${srv.base}/#/mantenimientos/contrato/k2`);
  await page.waitForSelector('#mco-form');
  ok((await page.inputValue('#mco-importe')) === '79' && !(await page.$eval('.mco-impreso', d => d.hidden)), 'pendiente: todo editable');
  await page.fill('#mco-importe', '');
  await page.click('#mco-form button[type=submit]');
  await page.waitForFunction(() => location.hash === '#/mantenimientos/documentos');
  const ep = esc(base, 'PATCH', 'contratos').at(-1).cuerpo;
  // Como en la app: sin cuota en el contrato, el documento imprime el precio del plan.
  ok(ep.precio_mensual === null && ep.cuerpo_html.includes('MODALIDAD SILVER') && ep.plan_nombre === 'Silver', 'editar con el importe vacío = sin cuota (y el documento se rehace)');
  await page.goto(`${srv.base}/#/mantenimientos/contrato/k1`);
  await page.waitForSelector('#mco-form');
  ok(await page.$eval('.mco-impreso', d => d.hidden), 'firmado: lo impreso no se toca');
  await page.selectOption('#mco-sede', 'l2');
  await page.click('#mco-form button[type=submit]');
  await page.waitForFunction(() => location.hash === '#/mantenimientos/documentos');
  const ef = esc(base, 'PATCH', 'contratos').at(-1).cuerpo;
  ok(ef.local_id === 'l2' && !('cuerpo_html' in ef) && !('precio_mensual' in ef), 'firmado: solo cambia a qué sede va');

  // ── Ver firmado, anular y eliminar ─────────────────────────────────────
  await page.goto(`${srv.base}/#/mantenimientos/contrato/k1/ver`);
  await page.waitForSelector('#mco-firmado .contrato-doc');
  ok((await page.textContent('.mco-imprimible')).includes('Lola Pérez') && (await page.textContent('.mco-imprimible')).includes('IP 81.1.2.3') && !!(await page.$('.mco-imprimible img.tr-firma')), 'el firmado con su firma y la evidencia');
  await page.goto(`${srv.base}/#/mantenimientos/documentos`);
  await page.click('#mdo-lista li[data-contrato="k2"] [data-action="mdoAnular"]');
  await espera(() => esc(base, 'PATCH', 'contratos').some(e => e.cuerpo.estado === 'anulado'));
  ok(true, 'anular (admin, confirmado)');
  await page.waitForSelector('#mdo-lista li[data-contrato="k3"] [data-action="mdoEliminar"]');
  await page.click('#mdo-lista li[data-contrato="k3"] [data-action="mdoEliminar"]');
  await espera(() => esc(base, 'DELETE', 'contratos').length === 1);
  ok(esc(base, 'DELETE', 'contratos')[0].url.includes('id=eq.k3'), 'eliminar (admin, confirmado)');
  ok(errores.length === 0, `sin errores JS${errores.length ? ': ' + errores.join(' | ') : ''}`);
  await ctx.close();

  // ── Técnico: ni anular ni eliminar ─────────────────────────────────────
  ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 800 } });
  await preparar(ctx, { email: 'tec@ok.test', base: baseMemoria(FIX, RPC) });
  page = await ctx.newPage();
  await page.goto(`${srv.base}/#/mantenimientos/documentos`);
  await page.waitForSelector('#mdo-lista');
  ok(!(await page.$('[data-action="mdoAnular"], [data-action="mdoEliminar"]')) && !!(await page.$('a[href="#/mantenimientos/contrato/nuevo"]')), 'un técnico genera, pero no anula ni elimina');
  const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
  ok(ancho <= 390, `Documentos no desborda en el móvil (${ancho}px)`);
  await ctx.close();

  // ── Sin el corte: solo lectura ─────────────────────────────────────────
  ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  const baseA = baseMemoria({ ...FIX, areas: [{ area: 'mantenimiento', tablas: ['contratos', 'planes_mantenimiento'], dueno: 'app' }] }, RPC);
  await preparar(ctx, { email: 'admin@ok.test', base: baseA });
  page = await ctx.newPage();
  await page.goto(`${srv.base}/#/mantenimientos/documentos`);
  await page.waitForSelector('#mdo-lista');
  ok(!!(await page.$('.aviso.area-app')) && !(await page.$('a[href="#/mantenimientos/contrato/nuevo"], a[href$="/k2"], [data-action="mdoAvisado"]')), 'sin corte: se ven los contratos, sin generar, editar ni marcar');
  await ctx.close();

  // ── Página pública: contrato.html ──────────────────────────────────────
  ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  const llamadas = [];
  let estadoPub = 'pendiente', pagoPub = null;
  await ctx.route(`${SB}/functions/v1/firma-contrato`, async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
    const b = route.request().postDataJSON();
    llamadas.push(b);
    const h = { 'Access-Control-Allow-Origin': '*' };
    if (b.token === 'x'.repeat(32)) return route.fulfill({ status: 404, headers: h, contentType: 'application/json', body: '{"error":"Contrato no encontrado."}' });
    if (b.accion === 'ver') return route.fulfill({ status: 200, headers: h, contentType: 'application/json', body: JSON.stringify({ contrato: { estado: estadoPub, plan_nombre: 'Premium', cliente_nombre: 'Polinesia',
      cuerpo_html: '<div class="contrato-doc"><h1>CONTRATO DE MANTENIMIENTO – MODALIDAD PREMIUM</h1><p>Cláusulas…</p></div>', firmante_nombre: 'Lola', firmado_at: '2026-10-01T10:00:00Z' }, pago: pagoPub }) });
    if (b.accion === 'firmar') return route.fulfill({ status: 200, headers: h, contentType: 'application/json', body: JSON.stringify({ ok: true, pago: pagoPub }) });
    if (b.accion === 'pagar') return route.fulfill({ status: 200, headers: h, contentType: 'application/json', body: JSON.stringify({ ok: true, url: 'https://pago.test/checkout' }) });
    return route.fulfill({ status: 400, headers: h, body: '{}' });
  });
  await ctx.route('https://pago.test/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<p id="stripe">Stripe</p>' }));
  page = await ctx.newPage();
  const errPub = [];
  page.on('pageerror', e => errPub.push(String(e)));
  const T = 'f'.repeat(32);
  await page.goto(`${srv.base}/contrato.html?token=${T}`);
  await page.waitForSelector('#ct-doc .contrato-doc');
  ok((await page.textContent('.ct-estado')).includes('Pendiente de firma') && await page.isDisabled('#ct-firmar'), 'contrato.html: el documento a firmar, con el botón apagado');
  await page.fill('#ct-nombre', 'María Hernández');
  await page.check('#ct-acepta');
  ok(await page.isDisabled('#ct-firmar'), 'sin firma dibujada no se puede firmar');
  const caja = await page.locator('#ct-lienzo').boundingBox();
  await page.mouse.move(caja.x + 20, caja.y + 40); await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(caja.x + 20 + i * 20, caja.y + 40 + (i % 2) * 30);
  await page.mouse.up();
  ok(!(await page.isDisabled('#ct-firmar')), 'nombre + firma + casilla: se puede firmar');
  await page.screenshot({ path: `${CAPTURAS}/contrato-publico-firma.png`, fullPage: true });
  await page.click('#ct-firmar');
  await page.waitForSelector('.ct-centro h1');
  const f = llamadas.find(l => l.accion === 'firmar');
  ok(f?.token === T && f.firmante_nombre === 'María Hernández' && f.acepta === true && /^data:image\/png;base64,/.test(f.firma_img), 'firma: nombre, casilla y la firma en PNG');
  ok((await page.textContent('.ct-centro h1')) === '¡Contrato firmado!', 'acuse de firma');
  estadoPub = 'firmado';
  await page.goto(`${srv.base}/contrato.html?token=${T}`);
  await page.waitForSelector('.ct-centro h1');
  ok((await page.textContent('.ct-centro')).includes('ya fue firmado por Lola'), 'firmado: lo dice y no deja refirmar');
  estadoPub = 'anulado';
  await page.goto(`${srv.base}/contrato.html?token=${T}`);
  await page.waitForSelector('.ct-centro h1');
  ok((await page.textContent('.ct-centro h1')) === 'Contrato anulado', 'anulado');
  await page.goto(`${srv.base}/contrato.html?token=${'x'.repeat(32)}`);
  await page.waitForSelector('.ct-centro h1');
  ok((await page.textContent('.ct-centro h1')) === 'Contrato no encontrado', 'token que no existe');
  await page.goto(`${srv.base}/contrato.html?token=<script>`);
  await page.waitForSelector('.ct-centro h1');
  ok((await page.textContent('.ct-centro h1')) === 'Enlace no válido', 'token mal formado: ni se pregunta');
  // Con el cobro conectado: la primera cuota tras firmar.
  estadoPub = 'firmado';
  pagoPub = { metodos: ['card', 'sepa'], importe: 629.16, importe_neto: 588, importe_mes: 49, meses: 12, impuesto_pct: 7, frecuencia: 'Anual', plan: 'Premium', sede: 'Playa del Duque' };
  await page.goto(`${srv.base}/contrato.html?token=${T}`);
  await page.waitForSelector('.ct-metodos');
  const pv = (await page.textContent('.ct-centro')).replace(/\u00a0/g, ' ');
  ok(pv.includes('588,00 € + 7 % de impuestos = 629,16 €') && pv.includes('(49,00 €/mes × 12 meses)') && await page.$$eval('.ct-metodo', b => b.length) === 2, 'firmado sin pagar: la primera cuota con su desglose y tarjeta / SEPA');
  await page.click('.ct-metodo[data-metodo="sepa"]');
  await page.waitForURL('https://pago.test/checkout');
  ok(llamadas.at(-1).accion === 'pagar' && llamadas.at(-1).metodo === 'sepa', 'pagar lleva a la página segura de Stripe');
  ok(errPub.length === 0, `contrato.html sin errores JS${errPub.length ? ': ' + errPub.join(' | ') : ''}`);
  await page.goto(`${srv.base}/mandato.html?estado=cancelado`);
  await page.waitForSelector('.ct-centro h1');
  ok((await page.textContent('.ct-centro h1')) === 'Pago no completado', 'mandato.html: la vuelta de Stripe (cancelado)');
  const anchoP = await page.evaluate(() => document.documentElement.scrollWidth);
  ok(anchoP <= 390, `las páginas públicas no desbordan en el móvil (${anchoP}px)`);
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
