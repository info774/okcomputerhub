// Arnés de la fase 7 (portal de clientes): la página portal.html (pedir
// enlace, entrar con el código —que se quita de la URL—, resumen, tickets con
// mensajes escapados, abrir aviso, escribir, aceptar presupuesto, PDF de
// factura, mantenimiento, equipos, sesión caducada → vuelta a entrar, salir)
// con la función `portal` simulada, y la pantalla del equipo #/portal
// (invitar, generar enlace, revocar, aceptaciones; solo admins). Móvil.
//   npm run build && node .claude/skills/verify/verify-portal.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS, SB } from './comun.mjs';

const { ok, fallos, sumar } = contador();
const srv = await servidor(4186);
const C1 = 'c1111111-1111-1111-1111-111111111111';

// Estado del «servidor» del portal simulado.
function portalFalso() {
  const st = { token: null, llamadas: [], tickets: [{ numero: 60, titulo: 'Impresora', estado: 'Abierto', created_at: '2026-09-20T10:00:00Z', descripcion: 'No va',
    mensajes: [{ fecha: '2026-09-20T11:00:00Z', de: 'Ok Computer', texto: 'Vamos **mañana** <img src=x onerror=alert(1)>' }] }], aceptados: [], caducada: false };
  const resp = (b, cab) => {
    st.llamadas.push({ ...b, token: cab['x-portal-token'] ?? null });
    const conSesion = cab['x-portal-token'] === 'tok-1' && !st.caducada;
    switch (b.accion) {
      case 'pedir_enlace': return [200, { ok: true, mensaje: 'Si ese correo tiene acceso, en unos minutos te llega un enlace para entrar.' }];
      case 'entrar': return b.codigo === 'codigo-bueno-123456789012345678901234' ? [200, { token: 'tok-1', nombre: 'Marta' }] : [401, { error: 'El enlace no vale o ya caducó. Pide otro.' }];
      case 'enlace_admin': return [200, { url: 'https://x/portal.html?c=abc', caduca_min: 30 }];
    }
    if (!conSesion) return [401, { error: 'Tu sesión ha caducado: vuelve a pedir el enlace.', sesion: false }];
    switch (b.accion) {
      case 'yo': return [200, { nombre: 'Marta Díaz', email: 'marta@cliente.es', cliente: 'Hotel Playa SL' }];
      case 'resumen': return [200, { tickets_abiertos: 1, presupuestos_pendientes: 1, facturas_pendientes: 1, saldo_pendiente: 120.5, equipos: 3, equipos_conectados: 2, alertas: 1, sedes: 1 }];
      case 'tickets': return [200, st.tickets];
      case 'ticket': { const t = st.tickets.find(x => x.numero === Number(b.numero)); return t ? [200, t] : [400, { error: 'No encontramos ese ticket' }]; }
      case 'ticket_crear': { const t = { numero: 5001, titulo: b.titulo, estado: 'Abierto', created_at: new Date().toISOString(), descripcion: b.descripcion, mensajes: [] }; st.tickets.unshift(t); return [200, { numero: 5001 }]; }
      case 'ticket_mensaje': st.tickets.find(x => x.numero === Number(b.numero)).mensajes.push({ fecha: new Date().toISOString(), de: 'tú', texto: b.texto }); return [200, { ok: true }];
      case 'presupuestos': return [200, [{ id: 'p1', numero: 'P-9', titulo: 'Cámaras', estado: 'Enviado', total: 900, fecha: '2026-09-01', pdf: true, aceptado: st.aceptados.includes('p1') ? { created_at: new Date().toISOString() } : null }]];
      case 'presupuesto_aceptar': st.aceptados.push(b.id); return [200, { ok: true }];
      case 'facturas': return [200, [{ invoice_id: '123456789', numero: 'F26-1', fecha: '2026-08-01', vence: '2026-08-31', estado: 'overdue', total: 500, saldo: 120.5 }, { invoice_id: '223456789', numero: 'F26-2', fecha: '2026-07-01', estado: 'paid', total: 90, saldo: 0 }]];
      case 'mantenimiento': return [200, [{ local_id: 'l1', nombre: 'Hotel Playa', direccion: 'Adeje', plan: 'Premium', importe: 90, frecuencia: 'Mensual', estado_pago: 'Al corriente', proxima_cuota: '2026-10-01' }]];
      case 'equipos': return [200, [{ hostname: 'CAJA-1', nombre: null, so: 'Windows 11', conectado: true, visto_ultimo: new Date().toISOString(), alertas_abiertas: 1, reinicio_pendiente: false, sede: 'Hotel Playa' },
        { hostname: 'OFICINA', nombre: 'PC Oficina', so: 'Windows 10', conectado: false, visto_ultimo: '2026-09-01T00:00:00Z', alertas_abiertas: 0, reinicio_pendiente: true, sede: 'Hotel Playa' }]];
      case 'salir': return [200, { ok: true }];
    }
    return [400, { error: 'Acción desconocida' }];
  };
  return { st, async manejar(route) {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
    const b = req.postDataJSON() ?? {};
    if (b.accion === 'pdf') { st.llamadas.push(b); return route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/pdf' }, body: Buffer.from('%PDF-1.4 falso') }); }
    const [status, cuerpo] = resp(b, req.headers());
    return route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(cuerpo) });
  } };
}

async function contextoPortal(browser, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport, acceptDownloads: true });
  const pf = portalFalso();
  await ctx.route(`${SB}/functions/v1/portal`, r => pf.manejar(r));
  await ctx.route(`${SB}/rest/v1/**`, r => r.fulfill({ status: 403, body: 'el portal no toca PostgREST' }));
  const page = await ctx.newPage();
  const errores = [], rest = [];
  page.on('pageerror', e => errores.push(String(e)));
  page.on('request', r => { if (r.url().includes('/rest/v1/') || r.url().includes('/auth/v1/')) rest.push(r.url()); });
  page.on('dialog', d => d.type() === 'prompt' ? d.accept('Marta Díaz') : d.accept());
  return { ctx, page, pf, errores, rest };
}

const browser = await navegador();
try {
  // ── Portal ───────────────────────────────────────────────────────────────
  const P = await contextoPortal(browser);
  const { page, pf } = P;
  await page.goto(`${srv.base}/portal.html`);
  await page.waitForSelector('#po-email');
  await page.fill('#po-email', 'marta@cliente.es');
  await page.click('#po-form-entrar button');
  await page.waitForSelector('text=te llega un enlace');
  ok(pf.st.llamadas.some(l => l.accion === 'pedir_enlace' && l.email === 'marta@cliente.es'), 'portal: pedir el enlace por correo');
  await page.goto(`${srv.base}/portal.html?c=codigo-malo`);
  await page.waitForSelector('text=El enlace no vale');
  ok(true, 'portal: un código malo no entra');
  await page.goto(`${srv.base}/portal.html?c=codigo-bueno-123456789012345678901234`);
  await page.waitForSelector('.po-cifras');
  ok(!page.url().includes('c=') && await page.evaluate(() => localStorage.getItem('okc_portal_token')) === 'tok-1', 'portal: entra con el enlace, guarda la sesión y quita el código de la URL');
  ok((await page.textContent('.po-cifras')).includes('120,50 €') && (await page.textContent('main')).includes('Hotel Playa SL'), 'portal: resumen del cliente');
  await page.click('.po-menu a[href="#/tickets"]');
  await page.click('a[href="#/tickets/60"] >> nth=0');
  await page.waitForSelector('.po-msg');
  ok(await page.locator('.po-msg img').count() === 0 && (await page.locator('.po-msg strong').first().textContent()) === 'mañana', 'portal: los mensajes del equipo en markdown seguro');
  await page.fill('#po-msg', 'Gracias, os espero');
  await page.click('#po-form-msg button');
  await page.waitForFunction(() => document.querySelectorAll('.po-msg.tu').length >= 2);
  ok(pf.st.llamadas.some(l => l.accion === 'ticket_mensaje' && l.numero === '60' && l.texto === 'Gracias, os espero'), 'portal: escribir en un ticket');
  await page.goto(`${srv.base}/portal.html#/nuevo`);
  await page.waitForSelector('#po-titulo');
  await page.fill('#po-titulo', 'Sin internet en recepción');
  await page.fill('#po-desc', 'Desde esta mañana');
  await page.click('#po-form-nuevo button');
  await page.waitForFunction(() => location.hash === '#/tickets/5001');
  ok(pf.st.llamadas.some(l => l.accion === 'ticket_crear' && l.titulo === 'Sin internet en recepción'), 'portal: abrir un aviso');
  await page.click('.po-menu a[href="#/presupuestos"]');
  await page.waitForSelector('[data-aceptar="p1"]');
  await page.click('[data-aceptar="p1"]');
  await page.waitForSelector('text=Aceptado por ti');
  ok(pf.st.llamadas.some(l => l.accion === 'presupuesto_aceptar' && l.id === 'p1' && l.nombre === 'Marta Díaz'), 'portal: aceptar un presupuesto con su nombre');
  await page.click('.po-menu a[href="#/facturas"]');
  await page.waitForSelector('[data-pdf="factura"]');
  ok((await page.textContent('main')).includes('Pendiente de pago') && (await page.textContent('main')).includes('Pagada'), 'portal: facturas con lo pendiente');
  const descarga = page.waitForEvent('download');
  await page.click('[data-pdf="factura"][data-id="123456789"]');
  ok((await descarga).suggestedFilename() === 'factura.pdf', 'portal: descarga el PDF de una factura');
  await page.click('.po-menu a[href="#/mantenimiento"]');
  await page.waitForSelector('text=Premium');
  ok((await page.textContent('main')).includes('Al corriente'), 'portal: mantenimiento de sus sedes');
  await page.click('.po-menu a[href="#/equipos"]');
  await page.waitForSelector('text=CAJA-1');
  ok((await page.textContent('main')).includes('Sin conexión') && (await page.textContent('main')).includes('Reinicio pendiente'), 'portal: estado de sus equipos');
  await page.screenshot({ path: `${CAPTURAS}/portal.png`, fullPage: true });
  ok(P.rest.length === 0, `portal: no toca PostgREST ni la Auth del equipo${P.rest.length ? ' (' + P.rest[0] + ')' : ''}`);
  pf.st.caducada = true;
  await page.click('.po-menu a[href="#/tickets"]');
  await page.waitForSelector('#po-email');
  ok((await page.textContent('main')).includes('caducado') && await page.evaluate(() => localStorage.getItem('okc_portal_token')) === null, 'portal: sesión caducada → vuelve a pedir el enlace');
  pf.st.caducada = false;
  await page.evaluate(() => localStorage.setItem('okc_portal_token', 'tok-1'));
  await page.goto(`${srv.base}/portal.html`);
  await page.waitForSelector('#po-salir');
  await page.click('#po-salir');
  await page.waitForSelector('#po-email');
  ok(pf.st.llamadas.some(l => l.accion === 'salir'), 'portal: salir cierra la sesión');
  ok(P.errores.length === 0, `portal: sin errores JS${P.errores.length ? ': ' + P.errores.join(' | ') : ''}`);
  await P.ctx.close();

  // Móvil
  const PM = await contextoPortal(browser, { width: 390, height: 844 });
  await PM.page.goto(`${srv.base}/portal.html?c=codigo-bueno-123456789012345678901234`);
  await PM.page.waitForSelector('.po-cifras');
  for (const s of ['inicio', 'tickets', 'tickets/60', 'nuevo', 'presupuestos', 'facturas', 'mantenimiento', 'equipos']) {
    await PM.page.evaluate(h => { location.hash = h; }, `#/${s}`);
    await PM.page.waitForFunction(() => !document.querySelector('#po-cuerpo .po-cargando'));
    const ancho = await PM.page.evaluate(() => document.documentElement.scrollWidth);
    ok(ancho <= 390, `móvil portal ${s}: sin scroll horizontal (${ancho}px)`);
  }
  ok(PM.errores.length === 0, 'móvil portal: sin errores JS');
  await PM.ctx.close();

  // ── Pantalla del equipo ──────────────────────────────────────────────────
  const INICIAL = {
    usuarios: [{ id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true }, { id: 'u-tito', nombre: 'Tito', email: 'tito@ok.test', rol: 'tecnico', activo: true }],
    areas: [], sync_estado: [], proyectos: [],
    clientes: [{ id: C1, nombre: 'Hotel Playa SL', nif: 'B1', telefono: '612', email: 'h@x.test', activo: true }],
    contactos: [{ id: 'k1', nombre: 'Marta Díaz', email: 'marta@cliente.es', cliente_id: C1, favorito: true, activo: true }],
    portal_accesos: [{ id: 'a1', email: 'viejo@cliente.es', nombre: null, cliente_id: C1, activo: true, created_at: '2026-09-01T00:00:00Z', ultima_entrada_at: null, revocado_at: null }],
    portal_traza: [{ id: 1, acceso_id: 'a1', email: 'viejo@cliente.es', accion: 'aceptar_presupuesto', detalle: { presupuesto: 'P-9' }, created_at: '2026-09-20T10:00:00Z' }],
    portal_aceptaciones: [{ id: 'ac1', presupuesto_id: 'p1', acceso_id: 'a1', nombre: 'Juan <b>x</b>', comentario: null, created_at: '2026-09-20T10:00:00Z', revisada_at: null }],
    presupuestos: [{ id: 'p1', numero_presupuesto: 'P-9', titulo: 'Cámaras', total: 900, cliente_id: C1 }],
  };
  const base = baseMemoria(INICIAL, {});
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  await preparar(ctx, { email: 'ana@ok.test', base });
  const pf2 = portalFalso();
  await ctx.route(`${SB}/functions/v1/portal`, r => pf2.manejar(r));
  const A = await ctx.newPage();
  const errA = [];
  A.on('pageerror', e => errA.push(String(e)));
  A.on('dialog', d => d.accept());
  await A.goto(`${srv.base}/#/portal`);
  await A.waitForSelector('#pt-email');
  ok((await A.textContent('main')).includes('Juan <b>x</b>') && (await A.textContent('main')).includes('P-9'), 'equipo: presupuestos aceptados en el portal (escapados)');
  await A.fill('#pt-cliente-q', 'Hotel');
  await A.click('[data-action="ptElegirCliente"]');
  await A.waitForFunction(() => document.getElementById('pt-email').value === 'marta@cliente.es');
  await A.click('form[data-on-submit="ptInvitar"] button[type=submit]');
  await A.waitForFunction(() => document.getElementById('toast')?.textContent.includes('Acceso dado'));
  ok(base.db.portal_accesos.some(a => a.email === 'marta@cliente.es' && a.cliente_id === C1 && a.nombre === 'Marta Díaz'), 'equipo: invitar con el correo del contacto');
  await A.waitForSelector('[data-action="ptEnlace"][data-p0="a1"]');
  await A.click('[data-action="ptEnlace"][data-p0="a1"]');
  await A.waitForSelector('#pt-url');
  ok(await A.inputValue('#pt-url') === 'https://x/portal.html?c=abc' && pf2.st.llamadas.some(l => l.accion === 'enlace_admin' && l.acceso_id === 'a1'), 'equipo: generar el enlace para mandarlo a mano');
  await A.click('[data-action="ptActivo"][data-p0="a1"][data-p1="0"]');
  await A.waitForSelector('[data-action="ptActivo"][data-p0="a1"][data-p1="1"]');
  ok(base.db.portal_accesos.find(a => a.id === 'a1').activo === false, 'equipo: revocar un acceso');
  await A.click('[data-action="ptRevisada"][data-p0="ac1"]');
  await A.waitForFunction(() => !document.querySelector('[data-action="ptRevisada"]'));
  ok(!!base.db.portal_aceptaciones[0].revisada_at, 'equipo: marcar la aceptación como pasada a la app');
  ok(errA.length === 0, 'equipo: sin errores JS');
  await ctx.close();

  const baseT = baseMemoria(INICIAL, {});
  const ctxT = await browser.newContext({ serviceWorkers: 'block' });
  await preparar(ctxT, { email: 'tito@ok.test', base: baseT });
  const T = await ctxT.newPage();
  await T.goto(`${srv.base}/#/portal`);
  await T.waitForSelector('text=solo para administradores');
  ok(await T.locator('.menu-item[data-mod="portal"]').count() === 0, 'técnico: ni en el menú ni por URL');
  await ctxT.close();
} catch (e) { console.error('✗ excepción:', e); sumar(); }
finally { await browser.close(); srv.parar(); }
console.log(fallos() ? `\n${fallos()} fallo(s)` : '\nTodo bien');
process.exit(fallos() ? 1 : 0);
