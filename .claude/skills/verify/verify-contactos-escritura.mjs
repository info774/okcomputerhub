// Arnés de la paridad del bloque 2, tanda 4: alta y edición de contactos
// (desde la agenda, desde un cliente y desde una sede; empleados solo admin;
// dar de baja y reactivar), «Buscar en Google Maps» en el alta de sede (con
// Google simulado: rellena, avisa fuera de Tenerife y dice cuándo falla), aviso
// de sede de nombre parecido, y cliente y sede «al vuelo» en el alta de
// trabajo. Sin corte: todo en solo lectura.
//   npm run build && node .claude/skills/verify/verify-contactos-escritura.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS, SB } from './comun.mjs';

const { ok, fallos } = contador();
const srv = await servidor(4176);
const C1 = 'c1111111-1111-1111-1111-111111111111';
const L1 = 'a1111111-1111-1111-1111-111111111111', L2 = 'a2222222-2222-2222-2222-222222222222';
const base0 = (cortado, trabajos = cortado) => ({
  usuarios: [{ id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true }, { id: 'u-tito', nombre: 'Tito Pérez', email: 'tito@ok.test', rol: 'tecnico', activo: true }],
  areas: [
    { area: 'clientes', dueno: cortado ? 'hub' : 'app', tablas: ['clientes', 'locales', 'contactos', 'local_telefonos'] },
    { area: 'trabajos', dueno: trabajos ? 'hub' : 'app', tablas: ['trabajos', 'agenda', 'sesiones', 'documento_lineas', 'plantillas_trabajo'] },
  ],
  sync_estado: [], proyectos: [], clientes_crm: [], actividades: [], trabajos: [], tickets: [], presupuestos: [], oportunidades: [], rmm_estado_local: [], rmm_equipos: [],
  local_telefonos: [], local_hardware: [], local_software: [], plantillas_trabajo: [], agenda: [], sesiones: [],
  clientes: [{ id: C1, nombre: 'Hotel Playa SL', nif: 'B11111111', activo: true }],
  locales: [
    { id: L1, cliente_id: C1, nombre: 'Hotel Playa Recepción', tipo: 'Local', estado: 'activo', activo: true },
    { id: L2, cliente_id: C1, nombre: 'Hotel Playa Bar', tipo: 'Local', estado: 'activo', activo: true },
  ],
  contactos: [
    { id: 'k1', nombre: 'Marta Recepción', tipo: 'otro', cliente_id: C1, local_id: L1, telefono: '600111222', activo: true, favorito: false, etiquetas: ['VIP'] },
    { id: 'k2', nombre: 'Tito Pérez', tipo: 'empleado', cliente_id: null, local_id: null, telefono: '600999999', activo: true, favorito: false, etiquetas: null },
    { id: 'k3', nombre: 'Proveedor viejo', tipo: 'proveedor', cliente_id: null, local_id: null, activo: false, favorito: false, etiquetas: null },
  ],
});

// Google Maps simulado: las dos llamadas que hace ui/maps.ts.
const GOOGLE = estadoBuscar => `(() => {
  const S = { OK: 'OK', ZERO_RESULTS: 'ZERO_RESULTS' };
  const fichas = {
    p1: { name: 'Bar La Tasca', formatted_address: 'C. Real 5, Adeje', formatted_phone_number: '922 111 222', url: 'https://maps.google.com/?cid=1',
      opening_hours: { weekday_text: ['lunes: 9:00–23:00'] }, geometry: { location: { lat: () => 28.12, lng: () => -16.72 } } },
    p2: { name: 'Bar de Madrid', formatted_address: 'Gran Vía 1, Madrid', url: 'https://maps.google.com/?cid=2', geometry: { location: { lat: () => 40.4, lng: () => -3.7 } } },
  };
  window.google = { maps: {
    LatLngBounds: function () {}, Map: function () {},
    places: {
      PlacesServiceStatus: S,
      AutocompleteService: function () { this.getPlacePredictions = (p, cb) => {
        window.__peticionMaps = p;
        if (${JSON.stringify(estadoBuscar)} !== 'OK') return cb(null, ${JSON.stringify(estadoBuscar)});
        cb([{ place_id: 'p1', description: 'Bar La Tasca, Adeje', structured_formatting: { main_text: 'Bar La Tasca', secondary_text: 'Adeje' } },
            { place_id: 'p2', description: 'Bar de Madrid', structured_formatting: { main_text: 'Bar de Madrid', secondary_text: 'Madrid' } }], S.OK);
      }; },
      PlacesService: function () { this.getDetails = (p, cb) => cb(fichas[p.placeId], S.OK); },
    },
  } };
})();`;

async function contexto(browser, { cortado = true, trabajos = cortado, email = 'ana@ok.test', maps = 'OK' } = {}) {
  const base = baseMemoria(base0(cortado, trabajos), {});
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  await preparar(ctx, { email, base });
  await ctx.addInitScript(GOOGLE(maps));
  const fn = [];
  await ctx.route(`${SB}/functions/v1/clientes`, route => {
    const b = JSON.parse(route.request().postData() || '{}');
    fn.push(b);
    const r = b.accion === 'nif' ? { nombre: 'Tasca Adeje SL', fuente: 'duckduckgo' } : { zoho_id: '9555', reutilizado: false };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r) });
  });
  const page = await ctx.newPage();
  const errores = [];
  const dialogos = [];
  page.on('pageerror', e => errores.push(String(e)));
  page.on('dialog', d => { dialogos.push(d.message()); return (globalThis.__rechazar ? d.dismiss() : d.accept()); });
  return { ctx, page, base, fn, errores, dialogos };
}
const escr = (base, m, t) => base.reg.escrituras.filter(e => e.metodo === m && e.tabla === t);
const toast = (page, txt) => page.waitForFunction(t => document.getElementById('toast')?.textContent.includes(t), txt);

const browser = await navegador();
try {
  // ── Sin corte ───────────────────────────────────────────────────────────
  const A = await contexto(browser, { cortado: false });
  await A.page.goto(`${srv.base}/#/contactos`);
  await A.page.waitForSelector('#co-tabla');
  ok(await A.page.locator('a[href="#/contactos/nuevo"]').count() === 0 && await A.page.locator('.area-app').count() === 1, 'sin corte: la agenda sin alta y con el aviso');
  await A.page.goto(`${srv.base}/#/contactos/k1`);
  await A.page.waitForSelector('#co-cuerpo');
  ok(await A.page.locator('[data-action="coDarBaja"]').count() === 0 && (await A.page.textContent('.tarjeta-cab')).includes('Editar en la app'), 'sin corte: la ficha se edita en la app');
  await A.page.goto(`${srv.base}/#/contactos/nuevo`);
  await A.page.waitForSelector('#ctf-form');
  ok(await A.page.isDisabled('#ctf-form button[type=submit]'), 'sin corte: el formulario no guarda');
  await A.page.goto(`${srv.base}/#/trabajos/nuevo`);
  await A.page.waitForSelector('#tf-form');
  ok(await A.page.locator('[data-action="tfRapido"]').count() === 0, 'sin corte: el trabajo no ofrece cliente ni sede al vuelo');
  ok(A.base.reg.escrituras.filter(e => e.metodo !== 'RPC').length === 0 && A.errores.length === 0, `sin corte: nada escrito y sin errores${A.errores.length ? ': ' + A.errores.join(' | ') : ''}`);
  await A.ctx.close();

  // ── Con corte: contactos ────────────────────────────────────────────────
  const B = await contexto(browser);
  let { page, base } = B;
  await page.goto(`${srv.base}/#/contactos`);
  await page.waitForSelector('a[href="#/contactos/nuevo"]');
  await page.click('a[href="#/contactos/nuevo"]');
  await page.waitForSelector('#ctf-form');
  await page.check('input[name="ctf-tipo"][value="proveedor"]');
  await page.fill('#ctf-nombre', 'Distribuciones Teide');
  await page.fill('#ctf-telefono', '922333444');
  await page.fill('#ctf-etiquetas', 'TPV, papel , TPV');
  await page.check('#ctf-favorito');
  await page.fill('#ctf-cliente-q', 'Hotel');
  await page.waitForSelector('[data-action="ctfElegirCliente"]');
  await page.click('[data-action="ctfElegirCliente"]');
  await page.waitForFunction(() => document.querySelectorAll('#ctf-sede option').length === 3);
  await page.selectOption('#ctf-sede', L2);
  await page.click('#ctf-form button[type=submit]');
  await page.waitForSelector('#co-cuerpo');
  const alta = escr(base, 'POST', 'contactos').at(-1)?.cuerpo;
  ok(alta?.nombre === 'Distribuciones Teide' && alta?.tipo === 'proveedor' && alta?.favorito === true && alta?.activo === true
    && JSON.stringify(alta?.etiquetas) === '["TPV","papel"]' && alta?.cliente_id === C1 && alta?.local_id === L2, 'contacto: alta con tipo, favorito, etiquetas sin repetir, cliente y sede');
  // Desde la ficha de la sede: llega con la sede y su cliente
  await page.goto(`${srv.base}/#/sitios/${L1}/contactos`);
  await page.waitForSelector(`a[href="#/contactos/nuevo/l/${L1}"]`);
  await page.click(`a[href="#/contactos/nuevo/l/${L1}"]`);
  await page.waitForSelector('#ctf-form');
  ok((await page.inputValue('#ctf-cliente')) === C1 && (await page.inputValue('#ctf-sede')) === L1, 'contacto desde la sede: con la sede y su cliente puestos');
  // Desde la ficha del cliente
  await page.goto(`${srv.base}/#/clientes/${C1}/contactos`);
  await page.waitForSelector(`a[href="#/contactos/nuevo/c/${C1}"]`);
  ok(true, 'contacto desde el cliente: «+ Nuevo contacto» en su pestaña');
  // Editar
  await page.goto(`${srv.base}/#/contactos/k1/editar`);
  await page.waitForSelector('#ctf-form');
  ok((await page.inputValue('#ctf-etiquetas')) === 'VIP' && (await page.inputValue('#ctf-sede')) === L1, 'editar: trae etiquetas y sede');
  await page.fill('#ctf-cargo', 'Jefa de recepción');
  await page.click('#ctf-form button[type=submit]');
  await page.waitForSelector('#co-cuerpo');
  const ed = escr(base, 'PATCH', 'contactos').at(-1);
  ok(ed?.url.includes('id=eq.k1') && ed?.cuerpo?.cargo === 'Jefa de recepción', 'editar: guarda sobre el mismo');
  // Dar de baja y reactivar
  await page.click('[data-action="coDarBaja"]');
  await page.waitForSelector('[data-action="coReactivar"]');
  ok(escr(base, 'PATCH', 'contactos').at(-1)?.cuerpo?.activo === false, 'dar de baja: activo = false (no se borra)');
  await page.click('[data-action="coReactivar"]');
  await page.waitForSelector('[data-action="coDarBaja"]');
  ok(escr(base, 'PATCH', 'contactos').at(-1)?.cuerpo?.activo === true && escr(base, 'DELETE', 'contactos').length === 0, 'reactivar');

  // ── Google Maps en el alta de sede, y sede de nombre parecido ──────────
  await page.goto(`${srv.base}/#/sitios/nuevo`);
  await page.waitForSelector('#sf-form');
  await page.fill('#sf-maps-q', 'tasca');
  await page.press('#sf-maps-q', 'Enter');
  await page.waitForSelector('[data-action="mapsElegir"]');
  const peticion = await page.evaluate(() => window.__peticionMaps);
  ok(peticion?.locationRestriction && !peticion.locationBias && peticion.componentRestrictions?.country === 'es', 'Maps: busca solo en Tenerife (locationRestriction sin locationBias)');
  await page.click('[data-action="mapsElegir"][data-p1="p1"]');
  await page.waitForFunction(() => document.getElementById('sf-nombre')?.value === 'Bar La Tasca');
  ok((await page.inputValue('#sf-direccion')) === 'C. Real 5, Adeje' && (await page.inputValue('#sf-maps')) === 'https://maps.google.com/?cid=1'
    && (await page.inputValue('#sf-horario')).includes('lunes') && (await page.inputValue('#sf-telefono')) === '922111222', 'Maps: rellena nombre, dirección, enlace, horario y teléfono');
  await page.fill('#sf-maps-q', 'madrid');
  await page.click('[data-action="mapsBuscar"]');
  await page.waitForSelector('[data-action="mapsElegir"][data-p1="p2"]');
  await page.click('[data-action="mapsElegir"][data-p1="p2"]');
  await toast(page, 'no está en Tenerife');
  ok(true, 'Maps: avisa si el sitio no está en Tenerife');
  await page.fill('#sf-nombre', 'Hotel Playa Recepcion');
  globalThis.__rechazar = true;
  await page.click('#sf-form button[type=submit]');
  await page.waitForTimeout(400);
  globalThis.__rechazar = false;
  ok(B.dialogos.some(d => d.includes('nombre parecido') && d.includes('Hotel Playa Recepción')) && escr(base, 'POST', 'locales').length === 0,
    'sede de nombre parecido: pregunta y, si se cancela, no se crea');
  await page.screenshot({ path: `${CAPTURAS}/sitio-maps.png` });
  ok(B.errores.length === 0, `contactos y Maps: sin errores${B.errores.length ? ': ' + B.errores.join(' | ') : ''}`);
  await B.ctx.close();

  // ── Con corte: cliente y sede al vuelo en el alta de trabajo ───────────
  const T = await contexto(browser);
  ({ page, base } = T);
  await page.goto(`${srv.base}/#/trabajos/nuevo`);
  await page.waitForSelector('#tf-form');
  await page.click('[data-action="tfRapido"][data-p0="nc"]');
  await page.fill('#tf-nc-nif', 'B99999999');
  await page.click('[data-action="tfNcNif"]');
  await page.waitForFunction(() => document.getElementById('tf-nc-estado')?.textContent.includes('Encontrado'));
  ok((await page.inputValue('#tf-nc-nombre')) === 'Tasca Adeje SL', 'cliente al vuelo: el NIF trae la razón social');
  await page.click('[data-action="tfNcCrear"]');
  await page.waitForFunction(() => document.getElementById('tf-cliente')?.value);
  const cli = escr(base, 'POST', 'clientes').at(-1)?.cuerpo;
  const idCli = await page.inputValue('#tf-cliente');
  ok(cli?.nombre === 'Tasca Adeje SL' && cli?.nif === 'B99999999' && cli?.activo === true && T.fn.some(f => f.accion === 'zoho_alta' && f.cliente_id === idCli)
    && (await page.inputValue('#tf-cliente-q')) === 'Tasca Adeje SL' && await page.locator('#tf-nc').isHidden(), 'cliente al vuelo: se crea (con Zoho), queda elegido y la caja se pliega');
  // Con un NIF que ya existe no se crea
  await page.click('[data-action="tfRapido"][data-p0="nc"]');
  await page.fill('#tf-nc-nif', 'b11111111');
  await page.fill('#tf-nc-nombre', 'Otro Hotel');
  await page.click('[data-action="tfNcCrear"]');
  await toast(page, 'NIF ya existe');
  ok(escr(base, 'POST', 'clientes').length === 1, 'cliente al vuelo: con NIF repetido no se crea');
  await page.click('[data-action="tfRapido"][data-p0="nc"]');
  // Sede al vuelo, con Google Maps
  await page.click('[data-action="tfRapido"][data-p0="nl"]');
  await page.fill('#tf-nl-maps-q', 'tasca');
  await page.click('[data-action="mapsBuscar"][data-p0="tf-nl"]');
  await page.click('[data-action="mapsElegir"][data-p1="p1"]');
  await page.waitForFunction(() => document.getElementById('tf-nl-nombre')?.value === 'Bar La Tasca');
  await page.click('[data-action="tfNlCrear"]');
  await page.waitForFunction(() => document.getElementById('tf-local')?.value);
  const sede = escr(base, 'POST', 'locales').at(-1)?.cuerpo;
  const idSede = await page.inputValue('#tf-local');
  ok(sede?.nombre === 'Bar La Tasca' && sede?.cliente_id === idCli && sede?.direccion === 'C. Real 5, Adeje' && sede?.maps_url === 'https://maps.google.com/?cid=1' && sede?.activo === true,
    'sede al vuelo: con el cliente nuevo y los datos de Google Maps');
  // Y el trabajo sale con los dos
  await page.fill('#tf-titulo', 'Instalar TPV');
  await page.click('#tf-form button[type=submit]');
  await page.waitForFunction(() => /#\/trabajos\/\d+/.test(location.hash));
  const tr = escr(base, 'POST', 'trabajos').at(-1)?.cuerpo;
  ok(tr?.cliente_id === idCli && tr?.local_id === idSede, 'el trabajo se crea con el cliente y la sede recién hechos');
  ok(T.errores.length === 0, `trabajo: sin errores${T.errores.length ? ': ' + T.errores.join(' | ') : ''}`);
  await T.ctx.close();

  // ── Google Maps caído: lo dice ──────────────────────────────────────────
  const G = await contexto(browser, { maps: 'REQUEST_DENIED' });
  await G.page.goto(`${srv.base}/#/sitios/nuevo`);
  await G.page.waitForSelector('#sf-form');
  await G.page.fill('#sf-maps-q', 'tasca');
  await G.page.click('[data-action="mapsBuscar"]');
  await G.page.waitForFunction(() => document.getElementById('sf-maps-res')?.textContent.includes('No se ha podido consultar'));
  ok(true, 'Maps: si Google falla (clave, cuota) lo dice, no «sin resultados»');
  await G.ctx.close();

  // ── Técnico: empleados no ───────────────────────────────────────────────
  const E = await contexto(browser, { email: 'tito@ok.test' });
  await E.page.goto(`${srv.base}/#/contactos/k2`);
  await E.page.waitForSelector('#co-cuerpo');
  ok(await E.page.locator('a[href="#/contactos/k2/editar"]').count() === 0, 'técnico: un empleado no se edita');
  await E.page.goto(`${srv.base}/#/contactos/nuevo`);
  await E.page.waitForSelector('#ctf-form');
  ok(await E.page.locator('input[name="ctf-tipo"][value="empleado"]').count() === 0, 'técnico: no puede dar de alta empleados');
  await E.ctx.close();
} finally {
  await browser.close();
  srv.parar();
}
process.exit(fallos() ? 1 : 0);
