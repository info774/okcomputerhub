// Arnés de la fase 3: Puesto de mando (cifras, avisos agrupados y «Los míos»,
// gráfica de ventas con hover y tabla, cuentas grandes, lo último), Informes
// (vincular Telegram, programar, vista previa SANEADA, enviar ahora, pausar,
// configurar el bot) y la conexión de Zoho en Datos. Un técnico no ve dinero
// ni puede elegir informes de dinero. Móvil sin desbordar.
//   npm run build && node .claude/skills/verify/verify-mando.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS, SB } from './comun.mjs';

const { ok, fallos, sumar } = contador();
const srv = await servidor(4182);
const hoy = new Date();
const mes = d => { const x = new Date(hoy.getFullYear(), hoy.getMonth() - d, 15); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`; };
const AVISOS_TODOS = [
  { clave: 't1', tipo: 'ticket_sin_asignar', gravedad: 'mal', titulo: 'Ticket sin asignar: #12 Impresora', detalle: 'Bar Pepe', importe: null, enlace: 'https://okcomputertenerife.web.app', fecha: null, persona: null, dinero: false },
  { clave: 'h1', tipo: 'hito_vencido', gravedad: 'aviso', titulo: 'Hito vencido: Maqueta', detalle: '#1 Web', importe: null, enlace: '#/proyectos/1/roadmap', fecha: null, persona: 'Ana', dinero: false },
  { clave: 'p1', tipo: 'presupuesto_sin_respuesta', gravedad: 'aviso', titulo: 'Presupuesto sin respuesta: P-1', detalle: 'Hotel', importe: 1591.52, enlace: 'https://okcomputertenerife.web.app', fecha: null, persona: null, dinero: false },
];
const AVISOS_DINERO = [
  { clave: 'f1', tipo: 'factura_vencida', gravedad: 'mal', titulo: 'Factura vencida: F26-1 · Bar Grande', detalle: 'venció hace 40 días', importe: 800, enlace: 'https://books.zoho.eu/app/20107733530#/invoices/1', fecha: null, persona: null, dinero: true },
];
const RESUMEN = {
  hoy: hoy.toISOString().slice(0, 10), facturado_mes: 12000, facturado_mes_anterior_ano: 10000, cobrado_mes: 9000, pendiente: 41170, vencido: 800,
  facturas_vencidas: 1, presupuestos_enviados: 5377, presupuestos_aceptados: 2000, para_facturar: 38,
  ventas_mensuales: Array.from({ length: 24 }, (_, i) => ({ mes: mes(23 - i), total: 8000 + (i % 12) * 700 + (i >= 12 ? 1500 : 0) })),
  cuentas_grandes: [{ cliente_zoho_id: 'z1', nombre: 'Bar Grande', total: 25000, pendiente: 800, facturas: 12, ultima: '2026-09-20' }],
  zoho: { ultima_ok: new Date().toISOString(), ultimo_error: null },
};
const INICIAL = {
  usuarios: [{ id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true },
             { id: 'u-tito', nombre: 'Tito', email: 'tito@ok.test', rol: 'tecnico', activo: true }],
  areas: [], sync_estado: [], proyectos: [], proyecto_tareas: [],
  auditoria: [{ id: 1, ts: new Date().toISOString(), tabla: 'proyecto_tareas', accion: 'UPDATE', usuario_nombre: 'Tito', titulo: 'Maqueta' }],
  informes_programados: [{ id: 'i1', tipo: 'repaso_matinal', usuario_id: 'u-ana', hora: '07:45:00', dias: [1, 2, 3, 4, 5], activo: true, ultimo_envio_at: null }],
  informes_envios: [{ id: 1, created_at: new Date().toISOString(), tipo: 'avisos', usuario_id: 'u-ana', origen: 'bot', ok: true, error: null }],
  telegram_vinculos: [],
};

async function contexto(browser, email, { viewport = { width: 1280, height: 900 } } = {}) {
  const admin = email.startsWith('ana');
  const rpc = {
    panorama_direccion: () => admin ? [...AVISOS_TODOS, ...AVISOS_DINERO] : AVISOS_TODOS,
    direccion_resumen: () => admin ? RESUMEN : null,
    telegram_codigo: () => 'abc123abc123',
    telegram_desvincular: () => null,
  };
  const base = baseMemoria(INICIAL, rpc);
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport });
  await preparar(ctx, { email, base });
  const fn = [];
  await ctx.route(`${SB}/functions/v1/**`, async route => {
    const nombre = new URL(route.request().url()).pathname.split('/').pop();
    const b = route.request().postDataJSON() ?? {};
    fn.push({ nombre, ...b });
    const r = nombre === 'telegram-bot'
      ? (b.accion === 'estado' ? { configurado: true, usuario: 'OkHubBot', webhook: admin ? { puesto: false, pendientes: 0, ultimo_error: null } : undefined } : { ok: true })
      : nombre === 'informes-enviar'
        ? (b.accion === 'vista_previa' ? { texto: '🔔 <b>Avisos</b>\n• <a href="https://okhub-tenerife.web.app/#/direccion">uno</a>\n<script>alert(1)</script><img src=x onerror=alert(2)>' } : { ok: true, error: null })
        : nombre === 'zoho-lectura'
          ? (b.accion === 'estado' ? { cliente: true, conectado: false, organizacion: '20107733530', sync: null } : { ok: true, organizacion: 'Dalmon Sistemas S.L.', sync: { facturas: 969, cobros: 838 } })
          : { ok: true };
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(r) });
  });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
  page.on('dialog', d => d.accept());
  return { ctx, page, base, fn, errores };
}

const browser = await navegador();
try {
  // ── Admin ────────────────────────────────────────────────────────────────
  const A = await contexto(browser, 'ana@ok.test');
  const { page } = A;
  await page.goto(`${srv.base}/#/direccion`);
  await page.waitForSelector('.di-cifra');
  ok(await page.locator('.di-cifra').count() === 4, 'mando: cuatro tarjetas de dinero');
  ok((await page.textContent('.di-cifras')).includes('▲ 20 %'), 'mando: comparación con el año pasado');
  ok(await page.locator('.di-grupo').count() === 4, 'mando: avisos agrupados por tipo (con los de dinero)');
  ok((await page.locator('.di-grupo').first().getAttribute('data-tipo')) === 'factura_vencida' || (await page.locator('.di-grupo').first().getAttribute('class')).includes('di-g-mal'),
    'mando: lo urgente va primero');
  ok(await page.locator('a[href="#/proyectos/1/roadmap"]').count() === 1 && await page.locator('a[href*="books.zoho.eu"][target="_blank"]').count() >= 1,
    'mando: cada aviso lleva su botón (hub en la misma pestaña, Zoho en otra)');
  ok(await page.locator('.di-col').count() === 12 && await page.locator('.di-marca').count() === 12, 'ventas: 12 barras y la línea del año anterior');
  const g = await page.locator('.di-graf').boundingBox();
  await page.mouse.move(g.x + g.width * 0.9, g.y + g.height / 2);
  await page.waitForSelector('.di-tip:not([hidden])');
  ok((await page.textContent('.di-tip')).includes('un año antes'), 'ventas: hover con los dos valores');
  ok(await page.locator('.di-tabla tbody tr').count() === 12, 'ventas: vista de tabla');
  ok((await page.textContent('.di-lateral')).includes('Bar Grande') && (await page.textContent('.di-lateral')).includes('Maqueta'), 'mando: cuentas grandes y lo último');
  await page.screenshot({ path: `${CAPTURAS}/mando-admin.png`, fullPage: true });
  await page.click('[data-action="diMios"][data-p0="1"]');
  await page.waitForFunction(() => document.querySelectorAll('.di-grupo').length === 1);
  ok((await page.textContent('.di-grupo')).includes('Maqueta'), 'mando: «Los míos» deja solo lo suyo (vale el nombre de pila)');
  await page.click('[data-action="diMios"][data-p0="0"]');

  await page.goto(`${srv.base}/#/informes`);
  await page.waitForSelector('[data-action="inVincular"]');
  await page.click('[data-action="inVincular"]');
  await page.waitForSelector('a[href="https://t.me/OkHubBot?start=abc123abc123"]');
  ok(true, 'telegram: enlace de vincular con el código de un uso');
  ok(await page.isVisible('[data-action="inConfigurarBot"]'), 'telegram: el admin ve «Configurar el bot»');
  await page.click('[data-action="inConfigurarBot"]');
  await page.waitForFunction(() => document.getElementById('toast')?.textContent.includes('Bot configurado'));
  ok(A.fn.some(f => f.nombre === 'telegram-bot' && f.accion === 'configurar'), 'telegram: configurar llama a la función');

  await page.waitForSelector('#in-tipo');
  ok(await page.locator('#in-tipo option[value="cobros_vencidos"]').count() === 1 && await page.isVisible('#in-para'), 'informes: el admin elige informes de dinero y destinatario');
  await page.click('[data-action="inVistaPrevia"]');
  await page.waitForSelector('#in-vista b');
  ok(await page.locator('#in-vista script, #in-vista img').count() === 0 && (await page.textContent('#in-vista')).includes('<script>'),
    'informes: la vista previa enseña el formato pero escapa lo demás (ni script ni img)');
  ok(await page.locator('#in-vista a[href="https://okhub-tenerife.web.app/#/direccion"]').count() === 1, 'informes: los enlaces https se conservan');
  await page.selectOption('#in-tipo', 'cobros_vencidos');
  await page.selectOption('#in-para', 'u-tito');
  await page.fill('#in-hora', '09:30');
  await page.uncheck('input[name="in-dia"][value="5"]');
  await page.click('form[data-on-submit="inCrear"] button[type=submit]');
  await page.waitForFunction(() => document.getElementById('toast')?.textContent.includes('programado'));
  const nuevo = A.base.reg.escrituras.find(e => e.tabla === 'informes_programados' && e.metodo === 'POST');
  ok(nuevo?.cuerpo.tipo === 'cobros_vencidos' && nuevo.cuerpo.usuario_id === 'u-tito' && nuevo.cuerpo.hora === '09:30' && nuevo.cuerpo.dias.join() === '1,2,3,4',
    'informes: programar guarda tipo, destinatario, hora y días');
  await page.waitForSelector('[data-action="inEnviarAhora"][data-p0="i1"]');
  await page.click('[data-action="inEnviarAhora"][data-p0="i1"]');
  await page.waitForFunction(() => document.getElementById('toast')?.textContent.includes('Enviado'));
  ok(A.fn.some(f => f.nombre === 'informes-enviar' && f.accion === 'enviar_ahora' && f.id === 'i1'), 'informes: «Enviar ahora» por la función');
  await page.waitForSelector('[data-action="inPausar"][data-p0="i1"]');
  await page.click('[data-action="inPausar"][data-p0="i1"]');
  await page.waitForFunction(() => document.querySelector('[data-action="inPausar"][data-p0="i1"]')?.textContent.includes('Reanudar'));
  ok(A.base.db.informes_programados.find(i => i.id === 'i1').activo === false, 'informes: pausar');
  await page.screenshot({ path: `${CAPTURAS}/informes-admin.png`, fullPage: true });

  await page.goto(`${srv.base}/#/datos`);
  await page.waitForSelector('#da-zoho-codigo');
  await page.fill('#da-zoho-codigo', '1000.abcdef0123456789');
  await page.click('form[data-on-submit="datosZohoConectar"] button');
  await page.waitForFunction(() => document.getElementById('toast')?.textContent.includes('Dalmon'));
  ok(A.fn.some(f => f.nombre === 'zoho-lectura' && f.accion === 'conectar' && f.codigo === '1000.abcdef0123456789'), 'zoho: conectar manda el código a zoho-lectura');

  ok(A.base.reg.rest.every(r => r.metodo === 'OPTIONS' || r.perfil === 'hub'), 'todas las lecturas con Accept-Profile: hub');
  ok(await page.locator('[onclick],[onchange],[oninput],[onerror]').count() === 0, 'sin on*= inline');
  ok(A.errores.length === 0, `admin: sin errores JS${A.errores.length ? ': ' + A.errores.join(' | ') : ''}`);
  await A.ctx.close();

  // ── Técnico ──────────────────────────────────────────────────────────────
  const T = await contexto(browser, 'tito@ok.test');
  await T.page.goto(`${srv.base}/#/direccion`);
  await T.page.waitForSelector('.di-grupo');
  ok(await T.page.locator('.di-cifra, .di-lateral').count() === 0, 'técnico: ni cifras ni ventas ni lo último');
  ok(!T.base.reg.escrituras.some(e => e.tabla === 'direccion_resumen'), 'técnico: ni siquiera pide el resumen de dinero');
  ok(!(await T.page.textContent('main')).includes('Factura vencida'), 'técnico: sin avisos de dinero');
  await T.page.goto(`${srv.base}/#/informes`);
  await T.page.waitForSelector('#in-tipo');
  ok(await T.page.locator('#in-tipo option[value="cobros_vencidos"], #in-tipo option[value="ventas_ayer"]').count() === 0 && await T.page.locator('#in-para').count() === 0,
    'técnico: ni informes de dinero ni elegir destinatario');
  ok(await T.page.locator('[data-action="inConfigurarBot"]').count() === 0, 'técnico: no configura el bot');
  ok(T.errores.length === 0, 'técnico: sin errores JS');
  await T.ctx.close();

  // ── Móvil ────────────────────────────────────────────────────────────────
  const M = await contexto(browser, 'ana@ok.test', { viewport: { width: 390, height: 844 } });
  for (const ruta of ['direccion', 'informes']) {
    await M.page.goto(`${srv.base}/#/${ruta}`);
    await M.page.waitForSelector(ruta === 'direccion' ? '.di-cifra' : '#in-tipo');
    const ancho = await M.page.evaluate(() => document.documentElement.scrollWidth);
    ok(ancho <= 390, `móvil ${ruta}: sin scroll horizontal (${ancho}px)`);
    await M.page.screenshot({ path: `${CAPTURAS}/${ruta}-movil.png`, fullPage: true });
  }
  ok(M.errores.length === 0, 'móvil: sin errores JS');
  await M.ctx.close();
} catch (e) { console.error('✗ excepción:', e); sumar(); }
finally { await browser.close(); srv.parar(); }
console.log(fallos() ? `\n${fallos()} fallo(s)` : '\nTodo bien');
process.exit(fallos() ? 1 : 0);
