// Arnés de la paridad de sedes (bloque 2, tanda 2): alta (con el cliente
// buscado, el mapa de la dirección y el teléfono «Principal») y edición, dar de
// baja y reactivar (ficha y lista «De baja»), eliminar (admin; se lleva sus
// teléfonos), teléfonos con rol, «+ Nueva sede» desde el cliente y Excel.
// Sin corte: todo en solo lectura.
//   npm run build && node .claude/skills/verify/verify-sitios-escritura.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS } from './comun.mjs';

const { ok, fallos } = contador();
const srv = await servidor(4178);
const C1 = 'c1111111-1111-1111-1111-111111111111';
const L1 = 'a1111111-1111-1111-1111-111111111111', L2 = 'a2222222-2222-2222-2222-222222222222', L3 = 'a3333333-3333-3333-3333-333333333333';
const base0 = cortado => ({
  usuarios: [{ id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true }, { id: 'u-tito', nombre: 'Tito Pérez', email: 'tito@ok.test', rol: 'tecnico', activo: true }],
  areas: [{ area: 'clientes', dueno: cortado ? 'hub' : 'app', tablas: ['clientes', 'locales', 'contactos', 'local_telefonos'] }],
  sync_estado: [], proyectos: [], clientes_crm: [], actividades: [], trabajos: [], tickets: [], presupuestos: [], oportunidades: [], contactos: [],
  rmm_estado_local: [], rmm_equipos: [],
  clientes: [{ id: C1, nombre: 'Hotel Playa SL', nif: 'B11111111', telefono: '922000001', estado: 'activo', activo: true }],
  locales: [
    { id: L1, cliente_id: C1, nombre: 'Hotel Playa · Recepción', direccion: 'Av. Adeje 1', tipo: 'Local', estado: 'activo', activo: true, plan: 'Silver', estado_pago: 'Al corriente', programa_tpv: 'Glop', maps_url: null, lat: null, lng: null },
    { id: L2, cliente_id: C1, nombre: 'Hotel Playa · Bar', direccion: null, tipo: 'Local', estado: 'activo', activo: true, plan: null, estado_pago: null, programa_tpv: null, maps_url: null, lat: null, lng: null },
    { id: L3, cliente_id: C1, nombre: 'Kiosco cerrado', direccion: null, tipo: 'Local', estado: 'cerrado', activo: false, plan: null, estado_pago: null, programa_tpv: null, maps_url: null, lat: null, lng: null },
  ],
  local_telefonos: [
    { id: 't1', local_id: L1, nombre: 'Pepe', numero: '600111222', rol: 'dueno', created_at: '2026-09-01T10:00:00Z' },
    { id: 't2', local_id: L2, nombre: 'Barra', numero: '922000003', rol: 'otro', created_at: '2026-09-01T10:00:00Z' },
  ],
});
const RPC = { clases_clientes: () => [], linea_tiempo: () => [] };

async function contexto(browser, cortado, email = 'ana@ok.test') {
  const base = baseMemoria(base0(cortado), RPC);
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await preparar(ctx, { email, base });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
  page.on('dialog', d => d.accept());
  return { ctx, page, base, errores };
}
const escr = (base, m, t) => base.reg.escrituras.filter(e => e.metodo === m && e.tabla === t);
const pestana = async (page, id, p) => { await page.goto(`${srv.base}/#/sitios/${id}/${p}`); await page.waitForFunction(() => document.getElementById('si-cuerpo') && !document.querySelector('#si-cuerpo .cargando')); };

const browser = await navegador();
try {
  // ── Sin corte ───────────────────────────────────────────────────────────
  const A = await contexto(browser, false);
  await A.page.goto(`${srv.base}/#/sitios`);
  await A.page.waitForSelector('#si-tabla');
  ok(await A.page.locator('a[href="#/sitios/nuevo"]').count() === 0 && (await A.page.textContent('.mo-barra')).includes('en la app'), 'sin corte: el alta lleva a la app');
  await pestana(A.page, L1, 'telefonos');
  ok((await A.page.textContent('#si-tels')).includes('Dueño') && await A.page.locator('#si-tel-form').count() === 0 && await A.page.locator('[data-action="siDarBaja"]').count() === 0,
    'sin corte: los teléfonos se ven con su rol, sin formulario ni baja');
  await A.page.goto(`${srv.base}/#/sitios/nuevo`);
  await A.page.waitForSelector('#sf-form');
  ok(await A.page.isDisabled('#sf-form button[type=submit]'), 'sin corte: el formulario no guarda');
  ok(A.base.reg.escrituras.filter(e => e.metodo !== 'RPC').length === 0 && A.errores.length === 0, `sin corte: nada escrito y sin errores${A.errores.length ? ': ' + A.errores.join(' | ') : ''}`);
  await A.ctx.close();

  // ── Con corte ───────────────────────────────────────────────────────────
  const B = await contexto(browser, true);
  const { page, base } = B;
  // Desde la ficha del cliente: «+ Nueva sede» con el cliente puesto
  await page.goto(`${srv.base}/#/clientes/${C1}/sedes`);
  await page.waitForSelector(`a[href="#/sitios/nuevo/${C1}"]`);
  await page.click(`a[href="#/sitios/nuevo/${C1}"]`);
  await page.waitForSelector('#sf-form');
  ok((await page.inputValue('#sf-cliente')) === C1 && (await page.inputValue('#sf-cliente-q')) === 'Hotel Playa SL', 'nueva sede desde el cliente: llega con el cliente puesto');
  await page.fill('#sf-nombre', 'Hotel Playa · Terraza');
  await page.fill('#sf-direccion', 'Av. Adeje 1, Costa Adeje');
  await page.selectOption('#sf-tipo', 'Local');
  await page.fill('#sf-horario', 'L-D 10:00-23:00');
  await page.fill('#sf-telefono', '922555666');
  await page.click('#sf-form button[type=submit]');
  await page.waitForSelector('#si-cuerpo');
  const alta = escr(base, 'POST', 'locales').at(-1)?.cuerpo;
  ok(alta?.cliente_id === C1 && alta?.nombre === 'Hotel Playa · Terraza' && alta?.activo === true && alta?.horario === 'L-D 10:00-23:00'
    && alta?.maps_url === 'https://maps.google.com/?q=Av.%20Adeje%201%2C%20Costa%20Adeje', 'alta: la sede con su cliente, horario y el mapa de la dirección');
  ok(!('plan' in (alta ?? {})) && !('importe_mantenimiento' in (alta ?? {})), 'alta: el mantenimiento no se toca (bloque 4)');
  const nuevaId = decodeURIComponent(page.url().split('#/sitios/')[1] ?? '').split('/')[0];
  const tel = escr(base, 'POST', 'local_telefonos').at(-1)?.cuerpo;
  ok(tel?.local_id === nuevaId && tel?.nombre === 'Principal' && tel?.numero === '922555666', 'alta: el teléfono entra como «Principal» de la sede nueva');
  // Buscar otro cliente en el formulario (sin cliente de partida)
  await page.goto(`${srv.base}/#/sitios/nuevo`);
  await page.waitForSelector('#sf-form');
  await page.fill('#sf-cliente-q', 'Hotel');
  await page.waitForSelector('[data-action="sfElegirCliente"]');
  await page.click('[data-action="sfElegirCliente"]');
  ok((await page.inputValue('#sf-cliente')) === C1, 'alta: el cliente se busca y se elige');
  // Editar
  await page.goto(`${srv.base}/#/sitios/${L2}/editar`);
  await page.waitForSelector('#sf-form');
  await page.fill('#sf-tpv', 'BDP');
  await page.click('#sf-form details summary');
  await page.fill('#sf-alarma-empresa', 'Securitas');
  await page.click('#sf-form button[type=submit]');
  await page.waitForSelector('#si-cuerpo');
  const ed = escr(base, 'PATCH', 'locales').at(-1);
  ok(ed?.url.includes(`id=eq.${L2}`) && ed?.cuerpo?.programa_tpv === 'BDP' && ed?.cuerpo?.alarma_empresa === 'Securitas' && !('activo' in ed.cuerpo), 'editar: guarda TPV y alarma sin tocar el alta');
  // Teléfonos: añadir, cambiar el rol, editar y quitar
  await pestana(page, L1, 'telefonos');
  await page.fill('#si-tel-nombre', 'Marta');
  await page.fill('#si-tel-numero', '611222333');
  await page.selectOption('#si-tel-rol', 'administracion');
  await page.click('#si-tel-form button[type=submit]');
  await page.waitForFunction(() => document.getElementById('si-tels')?.textContent.includes('611222333'));
  const nt = escr(base, 'POST', 'local_telefonos').at(-1)?.cuerpo;
  ok(nt?.local_id === L1 && nt?.rol === 'administracion' && nt?.nombre === 'Marta', 'teléfonos: se añade con su rol');
  await page.selectOption('tr[data-tel="t1"] select', 'encargado');
  await page.waitForFunction(() => document.getElementById('toast')?.textContent.includes('Rol cambiado'));
  ok(escr(base, 'PATCH', 'local_telefonos').at(-1)?.cuerpo?.rol === 'encargado', 'teléfonos: el rol se cambia en la fila');
  await page.click('tr[data-tel="t1"] [data-action="siTelEditar"]');
  ok((await page.inputValue('#si-tel-numero')) === '600111222' && (await page.textContent('#si-tel-titulo')) === 'Editar teléfono', 'teléfonos: «✎» lo sube al formulario');
  await page.fill('#si-tel-numero', '600999888');
  await page.click('#si-tel-form button[type=submit]');
  await page.waitForFunction(() => document.getElementById('si-tels')?.textContent.includes('600999888'));
  ok(escr(base, 'PATCH', 'local_telefonos').at(-1)?.url.includes('id=eq.t1'), 'teléfonos: editar guarda sobre el mismo');
  await page.click('tr[data-tel="t1"] [data-action="siTelBorrar"]');
  await page.waitForFunction(() => !document.getElementById('si-tels')?.textContent.includes('600999888'));
  ok(escr(base, 'DELETE', 'local_telefonos').at(-1)?.url.includes('id=eq.t1'), 'teléfonos: se quitan');
  // Dar de baja y reactivar
  await pestana(page, L1, 'resumen');
  await page.click('[data-action="siDarBaja"]');
  await page.waitForSelector('[data-action="siReactivar"]');
  ok(escr(base, 'PATCH', 'locales').at(-1)?.cuerpo?.activo === false && Object.keys(escr(base, 'PATCH', 'locales').at(-1).cuerpo).length === 1
    && (await page.textContent('.tarjeta-cab')).includes('De baja'), 'dar de baja: solo activo = false, y la ficha lo dice');
  await page.goto(`${srv.base}/#/sitios`);
  await page.waitForSelector('#si-tabla');
  await page.click('[data-action="siBaja"]');
  await page.waitForFunction(() => document.getElementById('si-tabla')?.textContent.includes('Kiosco cerrado'));
  await page.click(`[data-action="siReactivar"][data-p0="${L3}"]`);
  await page.waitForFunction(() => !document.getElementById('si-tabla')?.textContent.includes('Kiosco cerrado'));
  ok(escr(base, 'PATCH', 'locales').at(-1)?.url.includes(`id=eq.${L3}`) && escr(base, 'PATCH', 'locales').at(-1)?.cuerpo?.activo === true, 'reactivar desde la lista «De baja»');
  // Excel
  const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="siExcel"]')]);
  ok(descarga.suggestedFilename().startsWith('sitios-de-baja-'), `Excel de lo que se ve (${descarga.suggestedFilename()})`);
  await page.screenshot({ path: `${CAPTURAS}/sitios-baja.png` });
  // Eliminar (admin): primero sus teléfonos, después la sede
  await pestana(page, L2, 'resumen');
  await page.click('[data-action="siEliminar"]');
  await page.waitForFunction(() => location.hash === '#/sitios');
  const borr = base.reg.escrituras.filter(e => e.metodo === 'DELETE').slice(-2);
  ok(borr[0]?.tabla === 'local_telefonos' && borr[0].url.includes(`local_id=eq.${L2}`) && borr[1]?.tabla === 'locales' && borr[1].url.includes(`id=eq.${L2}`),
    'eliminar: se lleva sus teléfonos y después la sede');
  ok(B.errores.length === 0, `con corte: sin errores${B.errores.length ? ': ' + B.errores.join(' | ') : ''}`);
  await B.ctx.close();

  // ── Técnico: no elimina ─────────────────────────────────────────────────
  const T = await contexto(browser, true, 'tito@ok.test');
  await pestana(T.page, L1, 'resumen');
  ok(await T.page.locator('[data-action="siDarBaja"]').count() === 1 && await T.page.locator('[data-action="siEliminar"]').count() === 0, 'un técnico da de baja pero no tiene «Eliminar»');
  await T.ctx.close();
} finally {
  await browser.close();
  srv.parar();
}
process.exit(fallos() ? 1 : 0);
