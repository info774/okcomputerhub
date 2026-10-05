// Arnés de la fase 10 (personas): jornada (RPC simulado) con corrección de un
// admin, conformidad y CSV; ausencias (pedir, aprobar); gastos (subir → la
// función gastos-ocr simulada → revisar y confirmar); cierre del mes; firmas
// (crear con vista previa segura, enviar) y las páginas públicas firmar.html
// (firmar con el dedo) y gestoria.html (portal simulado). Móvil.
//   npm run build && node .claude/skills/verify/verify-personas.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS, SB } from './comun.mjs';

const { ok, fallos, sumar } = contador();
const srv = await servidor(4189);
const mes = new Date().toLocaleDateString('sv-SE').slice(0, 7);
const UT = 'u-tito';
const dias = [
  { usuario_id: UT, nombre: 'Tito', fecha: `${mes}-05`, entrada: `${mes}-05T08:00:00Z`, salida: `${mes}-05T17:00:00Z`, trabajado_min: 300, pausas_min: 240, sesiones: 3, ajustado: false, motivo_ajuste: null, ausencia: null },
  { usuario_id: UT, nombre: 'Tito', fecha: `${mes}-06`, entrada: null, salida: null, trabajado_min: null, pausas_min: null, sesiones: 0, ajustado: false, motivo_ajuste: null, ausencia: 'vacaciones' },
];
const INICIAL = {
  usuarios: [{ id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true }, { id: UT, nombre: 'Tito', email: 'tito@ok.test', rol: 'tecnico', activo: true }],
  areas: [], sync_estado: [], proyectos: [], config: [{ clave: 'vacaciones_dias', valor: 22 }],
  jornada_ajustes: [], jornada_cierres: [], cierres_mes: [], portal_accesos: [{ email: 'asesor@gestoria.test', nombre: 'Asesoría', tipo: 'gestoria', activo: true, ultima_entrada_at: null }],
  ausencias: [{ id: 'a1', created_at: new Date().toISOString(), usuario_id: UT, tipo: 'vacaciones', desde: `${mes}-20`, hasta: `${mes}-22`, dias: 3, estado: 'solicitada', nota: 'Boda', respuesta: null }],
  tickets_gasto: [], firmas: [], clientes: [{ id: 'c1', nombre: 'Hotel Playa SL', activo: true }],
};

async function contexto(browser, email, viewport = { width: 1280, height: 900 }) {
  const base = baseMemoria(INICIAL, { jornada: () => dias });
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport, acceptDownloads: true });
  await preparar(ctx, { email, base });
  const fn = [];
  await ctx.route(`${SB}/functions/v1/**`, async route => {
    const nombre = new URL(route.request().url()).pathname.split('/').pop();
    const b = route.request().postDataJSON() ?? {};
    fn.push({ ...b, nombre }); // (el cuerpo de gastos-ocr trae su propio `nombre`: el del fichero)
    let r = { ok: true };
    if (nombre === 'gastos-ocr' && b.accion === 'subir') {
      const g = { id: 'g1', created_at: new Date().toISOString(), subido_por: email === 'ana@ok.test' ? 'u-ana' : UT, archivo_path: '2026/09/x.jpg', archivo_tipo: 'image/jpeg', fecha: `${mes}-03`, proveedor: 'Gasolinera <b>Sur</b>',
        nif: 'B1234', concepto: 'Gasoil', base: 46.73, impuesto_pct: 7, impuesto: 3.27, total: 50, categoria: 'Combustible', forma_pago: 'Tarjeta', estado: 'revisar', leido_por_claude: true, error: null, notas: null };
      base.db.tickets_gasto.push(g); r = g;
    } else if (nombre === 'gastos-ocr') r = { url: 'https://x.test/firmada' };
    else if (nombre === 'firma') r = { ok: true, para: 'marta@x.test' };
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(r) });
  });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
  page.on('dialog', d => d.type() === 'prompt' ? d.accept('No hay cobertura') : d.accept());
  return { ctx, page, base, fn, errores };
}
const toastCon = (page, t) => page.waitForFunction(x => document.getElementById('toast')?.textContent.includes(x), t);

const browser = await navegador();
try {
  const A = await contexto(browser, 'ana@ok.test');
  const { page, base, fn } = A;
  // Jornada
  await page.goto(`${srv.base}/#/personas`);
  await page.waitForSelector('.pe-jornada');
  await page.selectOption('#pe-persona', UT);
  await page.waitForFunction(() => document.querySelector('.pe-jornada')?.textContent.includes('5:00'));
  ok((await page.textContent('.pe-jornada')).includes('Vacaciones') && await page.locator('.pe-jornada .pe-ausencia svg.ico').count() === 1 && await page.locator('.pe-ausencia').count() === 1, 'jornada: horas del día y las ausencias');
  const csv = page.waitForEvent('download');
  await page.click('[data-action="peCsv"]');
  ok((await csv).suggestedFilename().startsWith(`jornada-${mes}`), 'jornada: se descarga en CSV');
  await page.click(`[data-action="peCorregir"][data-p0="${mes}-05"]`);
  await page.fill('#pe-cor-entrada', '08:30');
  await page.fill('#pe-cor-salida', '17:00');
  await page.fill('#pe-cor-pausa', '60');
  await page.fill('#pe-cor-motivo', 'No fichó la primera visita');
  await page.click('#pe-corregir button[type=submit]');
  await toastCon(page, 'Corrección guardada');
  const aj = base.reg.escrituras.find(e => e.tabla === 'jornada_ajustes');
  ok(decodeURIComponent(aj?.url ?? '').includes('on_conflict=usuario_id,fecha') && aj.cuerpo.usuario_id === UT && aj.cuerpo.motivo === 'No fichó la primera visita' && aj.cuerpo.pausa_min === 60,
    'jornada: un admin corrige un día con motivo');
  ok(/T0[78]:30:00/.test(aj.cuerpo.entrada), `jornada: la hora se guarda en hora de Canarias (${aj.cuerpo.entrada})`);

  // Ausencias
  await page.goto(`${srv.base}/#/personas/ausencias`);
  await page.waitForSelector('[data-action="peDecidir"]');
  await page.click('[data-action="peDecidir"][data-p0="a1"][data-p1="aprobada"]');
  await page.waitForFunction(() => !document.querySelector('[data-action="peDecidir"][data-p0="a1"]'));
  ok(base.db.ausencias.find(a => a.id === 'a1').estado === 'aprobada', 'ausencias: un admin aprueba');

  // Gastos
  await page.goto(`${srv.base}/#/personas/gastos`);
  await page.waitForSelector('#pe-archivo');
  await page.setInputFiles('#pe-archivo', { name: 'ticket.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(3000, 1) });
  await page.click('#pe-subir-btn');
  await page.waitForSelector('#pe-gasto');
  const sub = fn.find(f => f.nombre === 'gastos-ocr' && f.accion === 'subir');
  ok(sub?.tipo === 'image/jpeg' && sub.archivo.length > 3000, 'gastos: la foto va (en base64) a gastos-ocr');
  ok(await page.inputValue('#pe-gasto input[name="total"]') === '50' && await page.inputValue('#pe-gasto input[name="proveedor"]') === 'Gasolinera <b>Sur</b>', 'gastos: el formulario sale relleno con lo leído (escapado)');
  await page.fill('#pe-gasto input[name="total"]', '50.5');
  await page.click('#pe-gasto button[type=submit]');
  await toastCon(page, 'Gasto confirmado');
  ok(base.db.tickets_gasto[0].estado === 'ok' && base.db.tickets_gasto[0].total === 50.5, 'gastos: confirmado con la corrección');

  // Cierre
  await page.goto(`${srv.base}/#/personas/cierre`);
  await page.waitForSelector('#pe-cierre-nota');
  ok((await page.textContent('main')).includes('asesor@gestoria.test'), 'cierre: se ve el acceso de la gestoría');
  await page.fill('#pe-cierre-nota', 'Todo cuadra');
  await page.click('form[data-on-submit="peCerrarMes"] button[type=submit]');
  await toastCon(page, 'Mes cerrado');
  ok(base.db.cierres_mes[0]?.estado === 'cerrado', 'cierre: un admin cierra el mes');

  // Firmas
  await page.goto(`${srv.base}/#/firmas/nueva`);
  await page.waitForSelector('#fi-titulo');
  await page.fill('#fi-titulo', 'Acta de entrega');
  await page.fill('#fi-nombre', 'Marta Díaz');
  await page.fill('#fi-email', 'marta@x.test');
  await page.fill('#fi-contenido', '# Entrega\n\nSe entrega **un portátil** <script>alert(1)</script>');
  await page.waitForFunction(() => document.getElementById('fi-previa')?.innerHTML.includes('<strong>un portátil</strong>'));
  ok(await page.locator('#fi-previa script').count() === 0, 'firmas: vista previa segura');
  await page.click('form[data-on-submit="fiGuardar"] button[type=submit]');
  await page.waitForSelector('#fi-enlace');
  const f = base.db.firmas[0];
  ok(f?.firmante_email === 'marta@x.test' && (await page.inputValue('#fi-enlace')).includes(`/firmar.html?t=${f.token ?? ''}`), 'firmas: creada con su enlace');
  await page.click('[data-action="fiEnviar"]');
  await toastCon(page, 'Enviado a marta@x.test');
  ok(fn.some(x => x.nombre === 'firma' && x.accion === 'enviar' && x.id === f.id), 'firmas: mandar el enlace por correo');
  ok(A.errores.length === 0, `admin: sin errores JS${A.errores.length ? ': ' + A.errores.join(' | ') : ''}`);
  await A.ctx.close();

  // Técnico: pide días y da su conformidad
  const T = await contexto(browser, 'tito@ok.test');
  await T.page.goto(`${srv.base}/#/personas/ausencias`);
  await T.page.waitForSelector('#pe-aus-desde');
  ok(await T.page.locator('#pe-aus-persona').count() === 0 && await T.page.locator('[data-action="peDecidir"]').count() === 0, 'técnico: no elige persona ni aprueba');
  await T.page.fill('#pe-aus-desde', `${mes}-27`);
  await T.page.fill('#pe-aus-hasta', `${mes}-27`);
  await T.page.click('form[data-on-submit="pePedir"] button[type=submit]');
  await toastCon(T.page, 'Pedida');
  ok(T.base.db.ausencias.some(a => a.usuario_id === UT && a.estado === 'solicitada' && a.desde === `${mes}-27`), 'técnico: pide sus días');
  ok(await T.page.locator('.al-pestanas a[href="#/personas/cierre"]').count() === 0, 'técnico: sin la pestaña de cierre');
  ok(T.errores.length === 0, 'técnico: sin errores JS');
  await T.ctx.close();

  // Página pública de firma
  const P = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, hasTouch: true });
  const firmas = [];
  await P.route(`${SB}/functions/v1/firma`, async route => {
    const b = route.request().postDataJSON(); firmas.push(b);
    const r = b.accion === 'ver' ? { titulo: 'Acta <i>x</i>', contenido: 'Se entrega **un portátil** <img src=x onerror=alert(1)>', contenido_hash: 'a'.repeat(64), estado: 'pendiente', firmante_nombre: 'Marta', caducado: false }
      : { ok: true, firmado_at: new Date().toISOString() };
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(r) });
  });
  const pp = await P.newPage();
  const errP = []; pp.on('pageerror', e => errP.push(String(e)));
  await pp.goto(`${srv.base}/firmar.html?t=11111111-1111-4111-8111-111111111111`);
  await pp.waitForSelector('#fr-lienzo');
  ok(await pp.locator('.md img').count() === 0 && (await pp.textContent('h1')).includes('Acta <i>x</i>'), 'firmar: el documento se enseña sin HTML');
  await pp.check('#fr-acepto');
  await pp.click('#fr-form button[type=submit]');
  await pp.waitForFunction(() => document.getElementById('fr-aviso')?.textContent.includes('Falta la firma'));
  ok(true, 'firmar: sin dibujar no se firma');
  const box = await pp.locator('#fr-lienzo').boundingBox();
  await pp.mouse.move(box.x + 20, box.y + 40); await pp.mouse.down();
  for (let i = 0; i < 20; i++) await pp.mouse.move(box.x + 20 + i * 12, box.y + 40 + (i % 5) * 15);
  await pp.mouse.up();
  await pp.click('#fr-form button[type=submit]');
  await pp.waitForSelector('text=✅ Firmado');
  const fr = firmas.find(x => x.accion === 'firmar');
  ok(fr?.hash === 'a'.repeat(64) && fr.nombre === 'Marta' && fr.firma.startsWith('data:image/png;base64,'), 'firmar: manda la huella, el nombre y la firma en PNG');
  ok(await pp.evaluate(() => document.documentElement.scrollWidth) <= 390, 'firmar: móvil sin scroll horizontal');
  ok(errP.length === 0, 'firmar: sin errores JS');
  await P.close();

  // Página de la gestoría
  const G = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  const gl = [];
  await G.route(`${SB}/functions/v1/portal`, async route => {
    const b = route.request().postDataJSON(); gl.push(b);
    const r = { entrar: { token: 'tg', tipo: 'gestoria' }, yo: { nombre: 'Asesoría', email: 'asesor@gestoria.test', tipo: 'gestoria' }, g_personas: [{ id: UT, nombre: 'Tito' }],
      g_jornada: { dias, conformidad: [], ajustes: [] }, g_ausencias: [{ usuario_id: UT, tipo: 'vacaciones', desde: `${mes}-06`, hasta: `${mes}-06`, dias: 1 }],
      g_gastos: { tickets: [{ id: 'g1', fecha: `${mes}-03`, proveedor: 'Gasolinera <b>Sur</b>', nif: 'B1', base: 46.73, impuesto_pct: 7, impuesto: 3.27, total: 50, categoria: 'Combustible', estado: 'ok', archivo: true }],
        app: [{ id: 'x', fecha: `${mes}-04`, importe: 12, descripcion: 'Parking', foto_url: 'javascript:alert(1)' }] },
      g_facturas: [{ numero: 'F26-1', fecha: `${mes}-02`, cliente_nombre: 'Hotel', total: 107, saldo: 0, estado: 'paid' }],
      g_cierre: b.estado ? { ok: true } : { mes: `${mes}-01`, estado: 'abierto' }, g_gasto_url: { url: 'https://x.test/f' } }[b.accion] ?? { ok: true };
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(r) });
  });
  const gp = await G.newPage();
  const errG = []; gp.on('pageerror', e => errG.push(String(e)));
  await gp.goto(`${srv.base}/gestoria.html?c=codigo-bueno-123456789012345678901234`);
  await gp.waitForSelector('#ge-mes');
  await gp.waitForSelector('.po-tabla');
  ok((await gp.textContent('main')).includes('5:00') && !gp.url().includes('c='), 'gestoría: entra con el enlace y ve la jornada');
  await gp.click('.po-menu a[href="#/gastos"]');
  await gp.waitForSelector('button[data-ver="g1"]');
  ok(await gp.locator('main b').count() === 0 && await gp.locator('a[href^="javascript"]').count() === 0, 'gestoría: gastos escapados y sin enlaces peligrosos');
  const dl = gp.waitForEvent('download');
  await gp.click('#ge-csv');
  ok((await dl).suggestedFilename() === `gastos-${gl.find(x => x.accion === 'g_gastos').mes}.csv`, 'gestoría: CSV de lo que ve');
  await gp.click('.po-menu a[href="#/cierre"]');
  await gp.waitForSelector('#ge-nota');
  await gp.fill('#ge-nota', 'Falta la factura de Movistar');
  await gp.click('#ge-cierre button[type=submit]');
  await gp.waitForFunction(() => true);
  for (let i = 0; i < 50 && !gl.some(x => x.accion === 'g_cierre' && x.estado); i++) await gp.waitForTimeout(100);
  ok(gl.some(x => x.accion === 'g_cierre' && x.estado === 'revisado' && x.nota === 'Falta la factura de Movistar'), 'gestoría: marca el mes revisado con su nota');
  ok(errG.length === 0, `gestoría: sin errores JS${errG.length ? ': ' + errG.join(' | ') : ''}`);
  await G.close();

  // Móvil del equipo
  const M = await contexto(browser, 'ana@ok.test', { width: 390, height: 844 });
  for (const [r, sel] of [['personas', '.pe-jornada'], ['personas/ausencias', '#pe-aus-desde'], ['personas/gastos', '#pe-archivo'], ['personas/cierre', '#pe-cierre-nota'], ['firmas', '.pr-barra'], ['firmas/nueva', '#fi-titulo']]) {
    await M.page.goto(`${srv.base}/#/${r}`);
    await M.page.waitForSelector(sel);
    const ancho = await M.page.evaluate(() => document.documentElement.scrollWidth);
    ok(ancho <= 390, `móvil ${r}: sin scroll horizontal (${ancho}px)`);
  }
  ok(M.errores.length === 0, 'móvil: sin errores JS');
  await M.ctx.close();
  await (await browser.newContext()).close();
  void CAPTURAS;
} catch (e) { console.error('✗ excepción:', e); sumar(); }
finally { await browser.close(); srv.parar(); }
console.log(fallos() ? `\n${fallos()} fallo(s)` : '\nTodo bien');
process.exit(fallos() ? 1 : 0);
