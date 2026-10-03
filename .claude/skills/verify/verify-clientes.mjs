// Arnés de la paridad de clientes (bloque 2, tanda 1): alta y edición con
// búsqueda por NIF y aviso de duplicado, alta en Zoho al crear, dar de baja y
// reactivar, «De baja» en la lista, eliminar (admin: baja + quitar de Zoho) y
// Excel. Sin corte: se ve y se edita en la app.
//   npm run build && node .claude/skills/verify/verify-clientes.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS, SB } from './comun.mjs';

const { ok, fallos } = contador();
const srv = await servidor(4199);
const C1 = 'c1111111-1111-1111-1111-111111111111', C2 = 'c2222222-2222-2222-2222-222222222222', C3 = 'c3333333-3333-3333-3333-333333333333';
const base0 = cortado => ({
  usuarios: [{ id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true }, { id: 'u-tito', nombre: 'Tito Pérez', email: 'tito@ok.test', rol: 'tecnico', activo: true }],
  areas: [{ area: 'clientes', dueno: cortado ? 'hub' : 'app', tablas: ['clientes', 'locales', 'contactos'] }],
  sync_estado: [], proyectos: [], clientes_crm: [], actividades: [], trabajos: [], tickets: [], presupuestos: [], oportunidades: [], locales: [], contactos: [],
  clientes: [
    { id: C1, nombre: 'Hotel Playa SL', nif: 'B11111111', telefono: '922000001', email: 'hotel@playa.test', estado: 'activo', activo: true, zoho_id: '9001', tipo: 'empresa', direccion: 'Av. Adeje 1', notas: null },
    { id: C2, nombre: 'Bar Sol', nif: null, telefono: '922000002', email: null, estado: 'activo', activo: true, zoho_id: null, tipo: 'empresa', direccion: null, notas: null },
    { id: C3, nombre: 'Kiosco Viejo', nif: 'X1234567L', telefono: null, email: null, estado: 'cerrado', activo: false, zoho_id: null, tipo: 'individuo', direccion: null, notas: null },
  ],
});
const RPC = { clases_clientes: () => [], linea_tiempo: () => [] };

async function contexto(browser, cortado, email = 'ana@ok.test') {
  const base = baseMemoria(base0(cortado), RPC);
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await preparar(ctx, { email, base });
  const fn = [];
  await ctx.route(`${SB}/functions/v1/clientes`, route => {
    const b = JSON.parse(route.request().postData() || '{}');
    fn.push(b);
    const r = b.accion === 'nif' ? { nombre: 'Dalmon Sistemas SL', fuente: 'duckduckgo' } : b.accion === 'zoho_alta' ? { zoho_id: '9555', reutilizado: false } : { accion: 'desactivado' };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r) });
  });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
  page.on('dialog', d => d.accept());
  return { ctx, page, base, fn, errores };
}
const escr = (base, m, t) => base.reg.escrituras.filter(e => e.metodo === m && e.tabla === t);

const browser = await navegador();
try {
  // ── Sin corte ───────────────────────────────────────────────────────────
  const A = await contexto(browser, false);
  await A.page.goto(`${srv.base}/#/clientes`);
  await A.page.waitForSelector('#cl-filtro');
  ok(await A.page.locator('a[href="#/clientes/nuevo"]').count() === 0 && (await A.page.textContent('.mo-barra')).includes('en la app'), 'sin corte: el alta lleva a la app');
  await A.page.goto(`${srv.base}/#/clientes/${C1}`);
  await A.page.waitForSelector('#cl-cuerpo');
  ok(await A.page.locator('[data-action="clBaja"]').count() === 0 && await A.page.locator('.area-app').count() === 1, 'sin corte: la ficha se ve y se edita en la app');
  await A.page.goto(`${srv.base}/#/clientes/nuevo`);
  await A.page.waitForSelector('#cf-form');
  ok(await A.page.isDisabled('#cf-form button[type=submit]'), 'sin corte: el formulario no guarda');
  ok(A.base.reg.escrituras.filter(e => e.metodo !== 'RPC').length === 0 && A.errores.length === 0, `sin corte: nada escrito y sin errores${A.errores.length ? ': ' + A.errores.join(' | ') : ''}`);
  await A.ctx.close();

  // ── Con corte ───────────────────────────────────────────────────────────
  const B = await contexto(browser, true);
  const { page, base, fn } = B;
  await page.goto(`${srv.base}/#/clientes/nuevo`);
  await page.waitForSelector('#cf-form');
  // NIF repetido: avisa y no deja crear
  await page.fill('#cf-nif', 'b11111111');
  await page.click('[data-action="cfBuscarNif"]');
  await page.waitForFunction(() => document.getElementById('cf-nif-estado')?.textContent.includes('ya lo tiene'));
  ok((await page.inputValue('#cf-nombre')) === 'Dalmon Sistemas SL' && (await page.textContent('#cf-nif-estado')).includes('Hotel Playa SL'), 'NIF: trae la razón social y avisa del duplicado');
  await page.click('#cf-form button[type=submit]');
  await page.waitForFunction(() => document.getElementById('toast')?.textContent.includes('NIF ya existe'));
  ok(escr(base, 'POST', 'clientes').length === 0, 'con el NIF repetido no se crea');
  // Alta buena
  await page.fill('#cf-nif', 'B99999999');
  await page.fill('#cf-nombre', 'Dalmon Sistemas SL');
  await page.fill('#cf-telefono', '922123456');
  await page.selectOption('#cf-plan', 'Silver');
  await page.click('#cf-form button[type=submit]');
  await page.waitForSelector('#cl-cuerpo');
  const alta = escr(base, 'POST', 'clientes').at(-1)?.cuerpo;
  ok(alta?.nombre === 'Dalmon Sistemas SL' && alta?.nif === 'B99999999' && alta?.plan === 'Silver' && alta?.activo === true && alta?.tipo === 'empresa', 'alta: el cliente con su NIF, plan y tipo');
  const idNuevo = decodeURIComponent(page.url().split('#/clientes/')[1] ?? '').split('/')[0];
  ok(!!idNuevo && fn.some(f => f.accion === 'zoho_alta' && f.cliente_id === idNuevo), 'alta: el cliente recién creado se da de alta en Zoho');
  // Editar
  await page.goto(`${srv.base}/#/clientes/${C2}/editar`);
  await page.waitForSelector('#cf-form');
  await page.fill('#cf-email', 'bar@sol.test');
  await page.click('#cf-form button[type=submit]');
  await page.waitForSelector('#cl-cuerpo');
  const ed = escr(base, 'PATCH', 'clientes').at(-1);
  ok(ed?.url.includes(`id=eq.${C2}`) && ed?.cuerpo?.email === 'bar@sol.test' && !fn.some(f => f.accion === 'zoho_alta' && f.cliente_id === C2), 'editar: guarda y no toca Zoho');
  // Dar de baja y reactivar
  await page.click('[data-action="clBaja"]');
  await page.waitForSelector('[data-action="clReactivar"]');
  ok(escr(base, 'PATCH', 'clientes').at(-1)?.cuerpo?.activo === false && (await page.textContent('.aviso')).includes('de baja'), 'dar de baja: solo activo = false, y la ficha lo dice');
  await page.goto(`${srv.base}/#/clientes`);
  await page.waitForSelector('#cl-filtro');
  await page.click('[data-action="clBajas"]');
  await page.waitForFunction(() => document.querySelector('.tabla')?.textContent.includes('Kiosco Viejo'));
  ok((await page.textContent('.tabla')).includes('Bar Sol'), '«De baja»: la lista de los dados de baja');
  await page.click(`[data-action="clReactivar"][data-p0="${C3}"]`);
  await page.waitForFunction(() => !document.querySelector('.tabla')?.textContent.includes('Kiosco Viejo'));
  ok(escr(base, 'PATCH', 'clientes').at(-1)?.cuerpo?.activo === true, 'reactivar desde la lista');
  // Excel
  const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="clExcel"]')]);
  ok(descarga.suggestedFilename().startsWith('clientes-de-baja-'), `Excel de lo que se ve (${descarga.suggestedFilename()})`);
  // Eliminar (admin)
  await page.goto(`${srv.base}/#/clientes/${C1}`);
  await page.waitForSelector('[data-action="clEliminar"]');
  await page.click('[data-action="clEliminar"]');
  await page.waitForFunction(() => location.hash === '#/clientes');
  ok(escr(base, 'PATCH', 'clientes').at(-1)?.url.includes(`id=eq.${C1}`) && fn.some(f => f.accion === 'zoho_quitar' && f.cliente_id === C1), 'eliminar: baja aquí y se quita de Zoho');
  await page.screenshot({ path: `${CAPTURAS}/clientes-lista.png` });
  ok(B.errores.length === 0, `con corte: sin errores${B.errores.length ? ': ' + B.errores.join(' | ') : ''}`);
  await B.ctx.close();

  // ── Técnico: no elimina ─────────────────────────────────────────────────
  const T = await contexto(browser, true, 'tito@ok.test');
  await T.page.goto(`${srv.base}/#/clientes/${C2}`);
  await T.page.waitForSelector('[data-action="clBaja"]');
  ok(await T.page.locator('[data-action="clEliminar"]').count() === 0, 'un técnico no tiene «Eliminar»');
  await T.ctx.close();
} finally {
  await browser.close();
  srv.parar();
}
process.exit(fallos() ? 1 : 0);
