// Arnés del asistente de voz, tanda 3 (altas): trabajo en una sede, local que
// no existe, tarea, ticket, presupuesto con líneas dictadas (precio del
// catálogo, dicho o a cero) por hub.presupuesto_guardar_lineas, añadir líneas
// (se mandan las de antes más las nuevas), cliente con aviso de parecido y
// alta forzada (Zoho), sede repetida y nueva, y el alta desde Google Maps (por
// voz y tocando la tarjeta, con la confirmación de «no está en Tenerife").
// Con las áreas de la app: lo dice y no escribe nada.
// Función `voz` y Google Maps SIMULADOS. Sin datos reales.
//   npm run build && node .claude/skills/verify/verify-voz-altas.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS, SB } from './comun.mjs';

const { ok, fallos } = contador();
const srv = await servidor(4213);
const MANANA = new Date(Date.now() + 86400000).toLocaleDateString('sv-SE');
const C1 = 'c1111111-1111-1111-1111-111111111111', L1 = 'l1111111-1111-1111-1111-111111111111', L2 = 'l2222222-2222-2222-2222-222222222222';
const fix = areas => ({
  usuarios: [{ id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true }],
  areas, sync_estado: [], config: [], proyectos: [],
  clientes: [{ id: C1, nombre: 'Hoteles Oasis SL', nif: 'B11111111', activo: true }],
  locales: [{ id: L1, cliente_id: C1, nombre: 'Hotel Oasis', direccion: 'Adeje', activo: true }, { id: L2, cliente_id: null, nombre: 'Bar Manolo', direccion: 'Arona', activo: true }],
  catalogo: [{ id: 'cat1', nombre: 'Cámara Dahua 4MP', referencia: 'DH-4', precio: 89.5, activo: true }],
  trabajos: [], tareas: [], tickets: [], presupuestos: [], documento_lineas: [], agenda: [], sesiones: [], local_telefonos: [],
  local_hardware: [], local_software: [], rmm_equipos: [],
});
const A = (accion, datos) => `Hecho.\n[[ACCION]]${JSON.stringify({ accion, datos })}`;
const GUION = [
  [/trabajo en el hotel/i, A('crear_trabajo', { local: 'hotel oasis', fecha: MANANA, hora: '10:00', materiales: 'Router TP-Link', descripcion: 'Cambiar el router. Configurar la wifi de clientes', tipo: 'instalación', prioridad: 'alta' })],
  [/trabajo en la luna/i, A('crear_trabajo', { local: 'la luna', descripcion: 'algo' })],
  [/tarea/i, A('crear_tarea', { descripcion: 'Llamar al proveedor de cable', fecha: MANANA, prioridad: 'alta', local: 'bar manolo' })],
  [/ticket/i, A('crear_ticket', { local: 'bar manolo', titulo: 'La impresora no imprime', prioridad: 'urgente' })],
  [/presupuesto para/i, A('crear_presupuesto', { local: 'bar manolo', titulo: 'Videovigilancia', descripcion: 'Cámaras en sala y barra', lineas: [{ concepto: 'cámara dahua', cantidad: 4 }, { concepto: 'grabador 8 canales', cantidad: 1, precio: 120 }, { concepto: 'tornillería especial', cantidad: 1 }] })],
  [/añade dos metros/i, A('anadir_lineas', { presupuesto: 'bar manolo', lineas: [{ concepto: 'canaleta', cantidad: 2, precio: 3.5 }] })],
  [/cliente hoteles oasis, sí/i, A('crear_cliente', { nombre: 'Hoteles Oasis', nif: 'b-222.222.22', forzar: true })],
  [/cliente hoteles oasis/i, A('crear_cliente', { nombre: 'Hoteles Oasis' })],
  [/sitio hotel oasis/i, A('crear_local', { nombre: 'Hotel Oasis', cliente: 'oasis' })],
  [/sitio cafetería sol/i, A('crear_local', { nombre: 'Cafetería Sol', cliente: 'oasis', direccion: 'Avda. Sol 1, Adeje' })],
  [/busca en maps/i, A('buscar_en_maps', { texto: 'bar la tasca' })],
  [/el primero/i, A('crear_desde_maps', { indice: 1 })],
];

// Google Maps simulado: las dos llamadas que hace ui/maps.ts.
const GOOGLE = `(() => {
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
      AutocompleteService: function () { this.getPlacePredictions = (p, cb) => cb([
        { place_id: 'p1', structured_formatting: { main_text: 'Bar La Tasca', secondary_text: 'Adeje' } },
        { place_id: 'p2', structured_formatting: { main_text: 'Bar de Madrid', secondary_text: 'Madrid' } }], S.OK); },
      PlacesService: function () { this.getDetails = (p, cb) => cb(fichas[p.placeId], S.OK); },
    },
  } };
})();`;

const browser = await navegador();
const errores = [];
async function abrir(areas) {
  const rpc = {
    presupuesto_guardar_lineas: (c, db) => {
      db.documento_lineas = db.documento_lineas.filter(l => l.presupuesto_id !== c.p_presupuesto);
      c.p_lineas.forEach((l, i) => db.documento_lineas.push({ id: `dl${i}`, presupuesto_id: c.p_presupuesto, orden: i, ...l }));
      const total = c.p_lineas.reduce((s, l) => s + l.cantidad * l.precio * (1 - (l.descuento ?? 0) / 100), 0);
      db.presupuestos.find(p => p.id === c.p_presupuesto).total = total;
      return total;
    },
  };
  const base = baseMemoria(fix(areas), rpc);
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  await preparar(ctx, { email: 'ana@ok.test', base });
  await ctx.addInitScript(() => localStorage.setItem('hub_voz_leer', '0'));
  await ctx.addInitScript(GOOGLE);
  await ctx.route(`${SB}/functions/v1/voz`, route => {
    const b = route.request().postDataJSON();
    if (b.accion === 'estado') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"groq":true,"claude":false}' });
    const ultimo = [...b.messages].reverse().find(m => m.role === 'user')?.content ?? '';
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reply: GUION.find(([re]) => re.test(ultimo))?.[1] ?? 'No te he entendido.' }) });
  });
  const zoho = [];
  await ctx.route(`${SB}/functions/v1/clientes`, route => { zoho.push(route.request().postDataJSON()); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"zoho_id":"z1"}' }); });
  const page = await ctx.newPage();
  page.on('pageerror', e => errores.push(String(e.stack ?? e)));
  await page.goto(`${srv.base}/#/tareas`);
  await page.click('#voz-btn');
  await page.waitForSelector('#vz[open] #vz-texto');
  const ultima = () => page.evaluate(() => [...document.querySelectorAll('.vz-assistant')].pop()?.textContent ?? '');
  const hablar = async t => {
    const n = await page.locator('.vz-assistant').count();
    await page.fill('#vz-texto', t); await page.press('#vz-texto', 'Enter');
    // La frase del modelo y, detrás, lo que dice la acción.
    await page.waitForFunction(n => document.querySelectorAll('.vz-assistant').length >= n + 2 && !document.querySelector('#vz-mic.pensando'), n);
    return ultima();
  };
  return { base, ctx, page, hablar, zoho, ultima };
}

try {
  const { base, ctx, page, hablar, zoho, ultima } = await abrir([]);
  const db = base.db;

  let r = await hablar('crea un trabajo en el hotel oasis');
  const t = db.trabajos[0];
  ok(t?.local_id === L1 && t.cliente_id === C1 && t.tipo === 'Instalación' && t.prioridad === 'Alta' && t.estado === 'Pendiente' && t.fecha_programada === MANANA
    && t.hora_llegada === new Date(`${MANANA}T10:00:00`).toISOString() && t.materiales === 'Router TP-Link' && t.titulo === 'Cambiar el router', 'trabajo: sede, cliente, tipo, prioridad, día y hora, material y título');
  ok(r.includes('He creado el trabajo') && r.includes('Hotel Oasis') && (await page.locator('.vz-res').last().locator('button').count()) === 1, 'trabajo: lo dice y deja su tarjeta');

  r = await hablar('crea un trabajo en la luna');
  ok(r.includes('No he encontrado el local') && db.trabajos.length === 1, 'trabajo en un local que no existe: lo pregunta y no crea nada');

  r = await hablar('apunta una tarea');
  const k = db.tareas[0];
  ok(k?.titulo === 'Llamar al proveedor de cable' && k.prioridad === 'alta' && k.estado === 'pendiente' && k.local_id === L2 && k.fecha_vencimiento === MANANA && /^[0-9a-f-]{36}$/.test(k.id) && r.includes('Tarea creada para Bar Manolo'), 'tarea con sede, día y prioridad');

  r = await hablar('abre un ticket');
  const tk = db.tickets[0];
  ok(tk?.titulo === 'La impresora no imprime' && tk.prioridad === 'Urgente' && tk.estado === 'Abierto' && tk.local_id === L2 && r.includes(`Ticket ${tk.numero} abierto para Bar Manolo`), 'ticket: abierto, urgente y en su sede');

  r = await hablar('hazme un presupuesto para el bar manolo');
  const p = db.presupuestos[0];
  const ls = db.documento_lineas.filter(l => l.presupuesto_id === p?.id);
  ok(p?.titulo === 'Videovigilancia' && p.estado === 'Borrador' && p.local_id === L2 && p.exigencias === 'Cámaras en sala y barra', 'presupuesto en borrador con su sede');
  ok(ls.map(l => `${l.cantidad}×${l.nombre}@${l.precio}`).join('|') === '4×Cámara Dahua 4MP@89.5|1×grabador 8 canales@120|1×tornillería especial@0', 'líneas: el precio del catálogo, el dicho y a cero lo que no está');
  ok(r.includes('3 líneas') && r.includes('478 euros') && r.includes('Falta el precio de tornillería especial') && p.total === 478, 'presupuesto: total y aviso del precio que falta');

  r = await hablar('añade dos metros de canaleta al del bar manolo');
  const ls2 = db.documento_lineas.filter(l => l.presupuesto_id === p.id);
  ok(ls2.length === 4 && ls2[3].nombre === 'canaleta' && ls2[0].nombre === 'Cámara Dahua 4MP' && r.includes('485 euros'), 'añadir líneas: se conservan las de antes y sube el total');

  r = await hablar('da de alta el cliente hoteles oasis');
  ok(r.includes('Ya hay un cliente') && db.clientes.length === 1 && !zoho.length, 'cliente con nombre parecido: avisa y no crea');
  r = await hablar('da de alta el cliente hoteles oasis, sí, créalo');
  const nc = db.clientes[1];
  ok(nc?.nombre === 'Hoteles Oasis' && nc.nif === 'B22222222' && nc.activo === true && zoho.some(z => z.accion === 'zoho_alta' && z.cliente_id === nc.id) && r.includes('Zoho'), 'cliente forzado: NIF limpio, alta y a Zoho (crearCliente)');

  r = await hablar('crea el sitio hotel oasis');
  ok(r.includes('Ya existe Hotel Oasis') && db.locales.length === 2, 'sede repetida: avisa y no la crea');
  r = await hablar('crea el sitio cafetería sol');
  ok(r.includes('Hay varios clientes') && db.locales.length === 2, 'sede con un cliente ambiguo: pregunta cuál');

  r = await hablar('busca en maps el bar la tasca');
  ok(r.includes('He encontrado 2') && (await page.locator('.vz-res').last().locator('button').count()) === 2, 'Google Maps: los lugares salen como tarjetas');
  r = await hablar('el primero');
  const cli = db.clientes.find(c => c.nombre === 'Bar La Tasca'), sede = db.locales.find(l => l.nombre === 'Bar La Tasca');
  ok(cli && sede?.cliente_id === cli.id && sede.direccion === 'C. Real 5, Adeje' && sede.maps_url === 'https://maps.google.com/?cid=1' && sede.horario === 'lunes: 9:00–23:00' && sede.lat === 28.12 && sede.activo === true, 'alta desde Maps: cliente y sede con dirección, enlace, horario y coordenadas');
  ok(db.local_telefonos.some(x => x.local_id === sede?.id && x.numero === '922111222' && x.rol === 'otro') && r.includes('Alta hecha'), 'alta desde Maps: con su teléfono');

  // Tocar la tarjeta de un lugar fuera de Tenerife: se pregunta y se da de alta.
  await hablar('busca en maps el bar la tasca');
  let pregunta = '';
  page.once('dialog', d => { pregunta = d.message(); void d.accept(); });
  const n = await page.locator('.vz-assistant').count();
  await page.locator('.vz-res').last().locator('button').nth(1).click();
  await page.waitForFunction(n => document.querySelectorAll('.vz-assistant').length > n, n);
  ok(pregunta.includes('no está en Tenerife') && db.locales.some(l => l.nombre === 'Bar de Madrid') && (await ultima()).includes('Alta hecha'), 'tarjeta de un lugar fuera de Tenerife: lo pregunta y, aceptado, lo da de alta');
  await page.screenshot({ path: `${CAPTURAS}/voz-altas.png` });
  await ctx.close();

  // ── Áreas aún de la app: lo dice y no escribe ─────────────────────────────
  const app = ['trabajos', 'tareas', 'tickets', 'presupuestos', 'clientes'].map(a => ({ area: a, dueno: 'app', tablas: a === 'clientes' ? ['clientes', 'locales'] : [a] }));
  const b2 = await abrir(app);
  for (const [txt, que] of [['crea un trabajo en el hotel oasis', 'el trabajo'], ['apunta una tarea', 'la tarea'], ['abre un ticket', 'el ticket'], ['hazme un presupuesto para el bar', 'el presupuesto'], ['da de alta el cliente hoteles oasis, sí', 'el cliente'], ['crea el sitio cafetería sol', 'la sede']]) {
    const r2 = await b2.hablar(txt);
    ok(r2.includes('todavía se hace en la app'), `con el área de la app: ${que} lo dice`);
  }
  ok(!b2.base.reg.escrituras.length && !b2.zoho.length, `con las áreas de la app no se escribe nada${b2.base.reg.escrituras.length ? ': ' + b2.base.reg.escrituras.map(e => `${e.metodo} ${e.tabla}`).join(', ') : ''}`);
  await b2.ctx.close();

  ok(!errores.length, `sin errores JS${errores.length ? ': ' + errores.join(' | ') : ''}`);
} finally {
  await browser.close();
  srv.parar();
}
if (!fallos()) console.log('\nTodo bien');
process.exit(fallos() ? 1 : 0);
