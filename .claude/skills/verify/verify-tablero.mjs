// Arnés de la paridad (bloque 1, tanda 5): tablero de notas y chat por ficha.
//   · Tablero sin corte: todas las notas con su autor, buscador, sin escribir.
//   · Tablero con corte: nueva (título sacado de la nota), editar y borrar
//     SOLO las propias, y la nota de voz (graba, `comandas` → transcribir, y
//     el texto entra en la nota). Micrófono de mentira: un oscilador.
//   · Chat por ficha: «💬 Chat» en la ficha del trabajo → hub.chat_ficha →
//     #/chat/<canal> con su nombre y «Abrir la ficha».
//   npm run build && node .claude/skills/verify/verify-tablero.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS } from './comun.mjs';

const { ok, fallos } = contador();
const srv = await servidor(4198);
const hace = h => new Date(Date.now() - h * 3600000).toISOString();
const T1 = 'b1111111-1111-1111-1111-111111111111';
const base0 = cortado => ({
  usuarios: [{ id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true }, { id: 'u-tito', nombre: 'Tito Pérez', email: 'tito@ok.test', rol: 'tecnico', activo: true }],
  areas: [{ area: 'conocimiento', dueno: cortado ? 'hub' : 'app', tablas: ['conocimiento', 'tablero_notas'] }, { area: 'trabajos', dueno: 'app', tablas: ['trabajos'] }],
  sync_estado: [], proyectos: [], clientes: [], locales: [], contactos: [], agenda: [], sesiones: [], documento_lineas: [], trabajo_comentarios: [], trabajo_fotos: [], tickets: [],
  tablero_notas: [{ id: 'n1', user_id: 'u-tito', titulo: 'Comprar bridas', descripcion: 'Las **negras** de 30 cm', created_at: hace(2), updated_at: hace(2) },
    { id: 'n2', user_id: 'u-ana', titulo: 'Renovar dominio', descripcion: 'Vence en noviembre', created_at: hace(30), updated_at: hace(30) }],
  trabajos: [{ id: T1, numero: 151, created_at: hace(5), titulo: 'Cambiar router', estado: 'Pendiente', tecnicos: ['Tito Pérez'] }],
  chat_canales: [], chat_mensajes: [], chat_leidos: [],
});
const RPC = {
  chat_ficha: (b, db) => {
    let c = db.chat_canales.find(x => x.tipo === 'ficha' && x.ficha_tipo === b.p_tipo && x.ficha_id === b.p_id);
    if (!c) { c = { id: 'cf000000-0000-0000-0000-000000000001', nombre: b.p_nombre, tipo: 'ficha', miembros: ['u-ana'], ficha_tipo: b.p_tipo, ficha_id: b.p_id, ficha_ruta: b.p_ruta, archivado: false, ultimo_at: new Date().toISOString() }; db.chat_canales.push(c); }
    return c.id;
  },
  chat_resumen: (_b, db) => db.chat_canales.map(c => ({ id: c.id, nombre: c.nombre, tipo: c.tipo, miembros: c.miembros, ultimo_at: c.ultimo_at, sin_leer: 0, ultimo_texto: null })),
};

async function contexto(browser, cortado, viewport = { width: 1280, height: 900 }) {
  const base = baseMemoria(base0(cortado), RPC);
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport });
  await preparar(ctx, { email: 'ana@ok.test', base });
  await ctx.route('**/functions/v1/comandas', route => {
    base.reg.funciones.push({ url: route.request().url(), body: route.request().postDataJSON() });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ texto: 'Llamar al proveedor de cable\nantes del viernes' }) });
  });
  // Micrófono de mentira: un tono de un oscilador, para que MediaRecorder grabe algo.
  await ctx.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ac = new AudioContext(); const o = ac.createOscillator(); const d = ac.createMediaStreamDestination();
      o.connect(d); o.start(); return d.stream;
    };
  });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
  page.on('dialog', d => d.accept());
  return { ctx, page, base, errores };
}
const escr = (base, m, t) => base.reg.escrituras.filter(e => e.metodo === m && e.tabla === t);

const browser = await navegador(['--autoplay-policy=no-user-gesture-required']);
try {
  // ── Sin corte ───────────────────────────────────────────────────────────
  const A = await contexto(browser, false);
  await A.page.goto(`${srv.base}/#/inicio`);
  await A.page.waitForSelector('#menu .menu-item');
  ok(!!(await A.page.$('#menu a[href="#/tablero"]')), 'Tablero sale en el menú');
  await A.page.goto(`${srv.base}/#/tablero`);
  await A.page.waitForSelector('.tb-rejilla');
  const txt = await A.page.textContent('.tb-rejilla');
  ok(txt.includes('Comprar bridas') && txt.includes('Tito Pérez') && txt.includes('Renovar dominio') && await A.page.locator('.tb-nota strong:has-text("negras")').count() === 1, 'sin corte: todas las notas, con su autor y en markdown');
  ok(await A.page.locator('[data-action="tbNueva"]').count() === 0 && await A.page.locator('[data-action="tbEditar"]').count() === 0 && await A.page.locator('.area-app').count() === 1, 'sin corte: ni nueva ni editar, y avisado');
  await A.page.fill('#tb-q', 'dominio');
  await A.page.waitForFunction(() => document.querySelectorAll('.tb-nota').length === 1);
  ok((await A.page.textContent('.tb-rejilla')).includes('Renovar dominio'), 'buscador: filtra por título y nota');

  // Chat por ficha (el chat es del hub: funciona sin corte)
  await A.page.goto(`${srv.base}/#/trabajos/151`);
  await A.page.waitForSelector('[data-action="chatFicha"]');
  await A.page.click('[data-action="chatFicha"]');
  await A.page.waitForSelector('.ch-ficha');
  const rpc = escr(A.base, 'RPC', 'chat_ficha').at(-1)?.cuerpo;
  ok(rpc?.p_tipo === 'trabajo' && rpc?.p_id === T1 && rpc?.p_nombre === '🔧 Trabajo · #151 Cambiar router' && rpc?.p_ruta === '#/trabajos/151', 'chat por ficha: pide el canal del trabajo con su nombre y su ruta');
  ok(A.page.url().endsWith('#/chat/cf000000-0000-0000-0000-000000000001') && (await A.page.textContent('.ch-cab h3')).includes('🔧 Trabajo · #151 Cambiar router'), 'chat por ficha: abre la conversación del canal');
  ok(await A.page.getAttribute('.ch-ficha', 'href') === '#/trabajos/151', 'chat por ficha: «Abrir la ficha» vuelve al trabajo');
  await A.page.fill('#ch-texto', 'Llevo yo el router');
  await A.page.click('.ch-escribir button[type=submit]');
  await A.page.waitForFunction(() => document.getElementById('ch-mensajes')?.textContent.includes('Llevo yo el router'));
  ok(escr(A.base, 'POST', 'chat_mensajes').at(-1)?.cuerpo?.canal_id === 'cf000000-0000-0000-0000-000000000001', 'chat por ficha: se escribe en ese canal');
  ok(escr(A.base, 'POST', 'tablero_notas').length + escr(A.base, 'PATCH', 'tablero_notas').length === 0 && A.errores.length === 0, `sin corte: el tablero no se toca y sin errores${A.errores.length ? ': ' + A.errores.join(' | ') : ''}`);
  await A.ctx.close();

  // ── Con corte ───────────────────────────────────────────────────────────
  const B = await contexto(browser, true);
  const { page, base } = B;
  await page.goto(`${srv.base}/#/tablero`);
  await page.waitForSelector('.tb-rejilla');
  ok(await page.locator('.tb-nota[data-id="n2"] [data-action="tbEditar"]').count() === 1 && await page.locator('.tb-nota[data-id="n1"] [data-action="tbEditar"]').count() === 0, 'con corte: editar y borrar solo en las propias');
  await page.click('[data-action="tbNueva"]');
  await page.fill('#tb-desc', 'Revisar el SAI de la oficina que pita desde ayer por la tarde sin parar ni un momento\nsegunda línea');
  await page.click('#tb-form button[type=submit]');
  await page.waitForFunction(() => document.querySelectorAll('.tb-nota').length === 3);
  const nueva = escr(base, 'POST', 'tablero_notas').at(-1)?.cuerpo;
  ok(nueva?.user_id === 'u-ana' && nueva?.titulo === 'Revisar el SAI de la oficina que pita desde ayer por la tard…' && nueva?.descripcion.includes('segunda línea'), 'nueva nota: a mi nombre y, sin título, con las primeras palabras');
  await page.click('.tb-nota[data-id="n2"] [data-action="tbEditar"]');
  await page.waitForSelector('#tb-form');
  ok(await page.inputValue('#tb-titulo') === 'Renovar dominio', 'editar: trae la nota');
  await page.fill('#tb-titulo', 'Renovar dominio .com');
  await page.click('#tb-form button[type=submit]');
  await page.waitForFunction(() => document.querySelector('.tb-rejilla')?.textContent.includes('Renovar dominio .com'));
  const ed = escr(base, 'PATCH', 'tablero_notas').at(-1);
  ok(ed?.url.includes('id=eq.n2') && ed?.cuerpo?.titulo === 'Renovar dominio .com', 'editar: guarda la propia');

  // Nota de voz
  await page.click('[data-action="tbVoz"]');
  await page.waitForSelector('#tb-dictar[aria-pressed="true"]');
  await page.waitForTimeout(1200);
  await page.click('#tb-dictar');
  await page.waitForFunction(() => document.getElementById('tb-desc')?.value.includes('Llamar al proveedor'));
  const fn = base.reg.funciones.find(f => f.url.endsWith('/comandas'));
  ok(fn?.body?.accion === 'transcribir' && (fn?.body?.audio ?? '').length > 100, 'nota de voz: graba y la pasa a texto (comandas → transcribir)');
  await page.click('#tb-form button[type=submit]');
  await page.waitForFunction(() => document.querySelectorAll('.tb-nota').length === 4);
  ok(escr(base, 'POST', 'tablero_notas').at(-1)?.cuerpo?.titulo === 'Llamar al proveedor de cable', 'nota de voz: se guarda con lo dictado');

  await page.click('.tb-nota[data-id="n2"] [data-action="tbBorrar"]');
  await page.waitForFunction(() => !document.querySelector('.tb-nota[data-id="n2"]'));
  ok(escr(base, 'DELETE', 'tablero_notas').at(-1)?.url.includes('id=eq.n2'), 'borrar: la propia');
  await page.screenshot({ path: `${CAPTURAS}/tablero.png`, fullPage: true });
  ok(B.errores.length === 0, `con corte: sin errores${B.errores.length ? ': ' + B.errores.join(' | ') : ''}`);
  await B.ctx.close();

  // ── Móvil ───────────────────────────────────────────────────────────────
  const M = await contexto(browser, true, { width: 390, height: 844 });
  await M.page.goto(`${srv.base}/#/tablero`);
  await M.page.waitForSelector('.tb-rejilla');
  const ancho = await M.page.evaluate(() => document.documentElement.scrollWidth);
  ok(ancho <= 390, `móvil: el tablero no desborda (${ancho} px)`);
  await M.ctx.close();
} finally {
  await browser.close();
  srv.parar();
}
process.exit(fallos() ? 1 : 0);
