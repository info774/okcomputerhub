// Arnés del asistente de voz, tanda 2 (órdenes directas): fichar inicio por
// número y fin con su duración, preguntar en qué trabajo si no se dice, varios
// candidatos por local, completar un trabajo sin fichaje (lo dice la base),
// pasarlo a facturar, cerrar un ticket por texto, mover un día (agenda_mover,
// con técnico añadido al trabajo) y añadir otro, cita suelta, gasto en un
// trabajo, nota del tablero, añadir a la descripción y comanda para el equipo.
// Con las áreas aún de la app: lo dice y no escribe nada.
// La función `voz` va SIMULADA con respuestas de guion. Sin datos reales.
//   npm run build && node .claude/skills/verify/verify-voz-ordenes.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS, SB } from './comun.mjs';

const { ok, fallos } = contador();
const srv = await servidor(4212);
const dia = n => new Date(Date.now() + n * 86400000).toLocaleDateString('sv-SE');
const iso = (f, h) => new Date(`${f}T${h}:00`).toISOString();
const MANANA = dia(1), PASADO = dia(2);
const C1 = 'c1111111-1111-1111-1111-111111111111', L1 = 'l1111111-1111-1111-1111-111111111111', L2 = 'l2222222-2222-2222-2222-222222222222';
const fix = areas => ({
  usuarios: [{ id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true }],
  areas, sync_estado: [], config: [], proyectos: [],
  clientes: [{ id: C1, nombre: 'Hoteles Oasis SL', activo: true }],
  locales: [{ id: L1, cliente_id: C1, nombre: 'Hotel Oasis', direccion: 'Adeje', activo: true }, { id: L2, cliente_id: null, nombre: 'Bar Manolo', direccion: 'Arona', activo: true }],
  trabajos: [
    { id: 'w1', numero: 151, titulo: 'Cambiar router', descripcion: 'Router viejo', materiales: null, estado: 'Pendiente', fecha_programada: MANANA, tecnicos: ['Ana Admin'], cliente_id: C1, local_id: L1 },
    { id: 'w2', numero: 152, titulo: 'Cableado', descripcion: null, materiales: null, estado: 'En progreso', fecha_programada: null, tecnicos: [], cliente_id: C1, local_id: L1 },
  ],
  agenda: [{ id: 'b1', trabajo_id: 'w1', inicio: iso(MANANA, '10:00'), fin: iso(MANANA, '12:00'), tecnicos: ['Ana Admin'] }],
  tickets: [{ id: 't1', numero: 5001, titulo: 'Impresora no imprime', descripcion: null, estado: 'Abierto', tecnico_id: null, cliente_id: null, local_id: L2, created_at: dia(0) }],
  tareas: [], presupuestos: [], sesiones: [], gastos: [], tablero_notas: [],
  local_hardware: [], local_software: [], rmm_equipos: [],
});
const A = (accion, datos) => `[[ACCION]]${JSON.stringify({ accion, datos })}`;
const GUION = [
  [/empiezo con el 151/i, A('fichar', { que: 'inicio', referencia: '151' })],
  [/^empiezo$/i, A('fichar', { que: 'inicio' })],
  [/empiezo en el hotel/i, A('fichar', { que: 'inicio', referencia: 'hotel oasis' })],
  [/he terminado/i, A('fichar', { que: 'fin' })],
  [/151 como hecho/i, A('cambiar_estado', { tipo: 'trabajo', referencia: '151', estado: 'completado' })],
  [/152 a facturar/i, A('cambiar_estado', { tipo: 'trabajo', referencia: '152', estado: 'para facturar' })],
  [/cierra el ticket/i, A('cambiar_estado', { tipo: 'ticket', referencia: 'impresora', estado: 'cerrado' })],
  [/mueve el 151/i, A('programar', { tipo: 'trabajo', referencia: '151', fecha: PASADO, hora: '16:00', tecnico: 'Tito Pérez' })],
  [/otro día al 152/i, A('programar', { tipo: 'trabajo', referencia: '152', fecha: PASADO, hora: '09:30', duracion: 90, modo: 'añadir' })],
  [/apunta una cita/i, A('crear_evento', { titulo: 'Recoger pedido', fecha: MANANA, hora: '08:00' })],
  [/gasto/i, A('apuntar_gasto', { importe: '12,50', categoria: 'material', concepto: 'Conectores', trabajo: '151' })],
  [/nota/i, A('apuntar_nota', { texto: 'Pedir más cable UTP' })],
  [/descripción/i, A('actualizar_descripcion', { trabajo: '151', texto: 'Cambiado el router por el nuevo' })],
  [/equipo/i, A('crear_comanda', { texto: 'Que alguien pase por Bar Manolo mañana' })],
];

const browser = await navegador();
const errores = [];
async function abrir(areas, rpc) {
  const base = baseMemoria(fix(areas), rpc);
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  await preparar(ctx, { email: 'ana@ok.test', base });
  await ctx.addInitScript(() => localStorage.setItem('hub_voz_leer', '0'));
  await ctx.route(`${SB}/functions/v1/voz`, route => {
    const b = route.request().postDataJSON();
    if (b.accion === 'estado') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"groq":true,"claude":false}' });
    const ultimo = [...b.messages].reverse().find(m => m.role === 'user')?.content ?? '';
    const reply = GUION.find(([re]) => re.test(ultimo))?.[1] ?? 'No te he entendido.';
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reply }) });
  });
  const comandas = [];
  await ctx.route(`${SB}/functions/v1/comandas`, route => { comandas.push(route.request().postDataJSON()); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"tareas":[{},{}]}' }); });
  const page = await ctx.newPage();
  page.on('pageerror', e => errores.push(String(e.stack ?? e)));
  await page.goto(`${srv.base}/#/tareas`);
  await page.click('#voz-btn');
  await page.waitForSelector('#vz[open] #vz-texto');
  // Dice algo y devuelve lo que contesta al acabar la orden.
  const hablar = async t => {
    const n = await page.locator('.vz-user').count();
    await page.fill('#vz-texto', t); await page.press('#vz-texto', 'Enter');
    await page.waitForFunction(n => document.querySelectorAll('.vz-user').length > n && !document.querySelector('#vz-mic.pensando'), n);
    return page.evaluate(() => [...document.querySelectorAll('.vz-assistant')].pop()?.textContent ?? '');
  };
  return { base, ctx, page, hablar, comandas };
}

try {
  // ── Áreas del hub ──────────────────────────────────────────────────────────
  const rpc = {
    fichar: c => ({ ok: true, sesion: { duracion_min: c.p_accion === 'fin' ? 95 : 0 }, cerrada: null }),
    trabajo_estado: (c, db) => {
      if (c.p_estado === 'Completado' && !db.sesiones.length) throw new Error('Para completar el trabajo hace falta el fichaje de inicio y fin');
      db.trabajos.find(t => t.id === c.p_id).estado = c.p_estado; return null;
    },
    agenda_mover: (c, db) => { const b = db.agenda.find(x => x.id === c.p_id); b.inicio = c.p_inicio; b.fin = c.p_fin; if (c.p_tecnicos) b.tecnicos = c.p_tecnicos; return null; },
  };
  const { base, ctx, page, hablar, comandas } = await abrir([], rpc);
  const rpcs = n => base.reg.escrituras.filter(e => e.metodo === 'RPC' && e.tabla === n);

  let r = await hablar('empiezo con el 151');
  const f1 = rpcs('fichar').pop()?.cuerpo;
  ok(f1?.p_accion === 'inicio' && f1?.p_tipo === 'trabajo' && f1?.p_id === 'w1' && r.includes('Inicio registrado') && r.includes('#151'), 'fichar inicio por número: hub.fichar con el trabajo');

  r = await hablar('empiezo');
  ok(r.includes('¿En qué trabajo') && rpcs('fichar').length === 1, 'fichar sin decir dónde: lo pregunta y no ficha');

  r = await hablar('empiezo en el hotel oasis');
  ok(r.includes('He encontrado 2') && (await page.locator('.vz-res').last().locator('button').count()) === 2 && rpcs('fichar').length === 1, 'dos trabajos abiertos en el local: los enseña y pide el número');

  r = await hablar('he terminado');
  ok(rpcs('fichar').pop()?.cuerpo.p_accion === 'fin' && r.includes('Fin registrado') && /1 h/.test(r), 'fichar fin: cuenta lo que ha durado');

  r = await hablar('marca el 151 como hecho');
  ok(r.includes('no tiene inicio y fin fichados') && base.db.trabajos[0].estado === 'Pendiente', 'completar sin fichaje: lo dice la base y no cambia');

  r = await hablar('pasa el 152 a facturar');
  ok(rpcs('trabajo_estado').pop()?.cuerpo.p_estado === 'Para facturar' && base.db.trabajos[1].estado === 'Para facturar' && r.includes('Para facturar'), 'estado de un trabajo: por hub.trabajo_estado');

  r = await hablar('cierra el ticket de la impresora');
  ok(base.db.tickets[0].estado === 'Cerrado' && r.includes('#5001'), 'cerrar un ticket buscándolo por el texto');

  r = await hablar('mueve el 151 a pasado mañana a las 16 con Tito');
  const mv = rpcs('agenda_mover').pop()?.cuerpo;
  ok(mv?.p_id === 'b1' && mv.p_inicio === iso(PASADO, '16:00') && mv.p_fin === iso(PASADO, '18:00') && mv.p_tecnicos?.join() === 'Ana Admin,Tito Pérez', 'mover un día: hub.agenda_mover con la misma duración y el técnico añadido');
  ok(base.db.trabajos[0].tecnicos.join() === 'Ana Admin,Tito Pérez' && r.includes('Movido') && r.includes('Tito'), 'mover un día: el técnico se AÑADE al trabajo');

  r = await hablar('añade otro día al 152');
  const nb = base.db.agenda.find(b => b.trabajo_id === 'w2');
  ok(nb?.inicio === iso(PASADO, '09:30') && nb?.fin === iso(PASADO, '11:00') && r.includes('Añadido'), 'añadir un día: bloque nuevo en la agenda');

  r = await hablar('apunta una cita para mañana');
  const cita = base.db.agenda.find(b => b.titulo === 'Recoger pedido');
  ok(cita?.inicio === iso(MANANA, '08:00') && !cita.trabajo_id && r.includes('Apuntado'), 'cita suelta en la agenda');

  r = await hablar('apunta un gasto de 12,50 en conectores para el 151');
  const g = base.db.gastos[0];
  ok(g?.importe === 12.5 && g.categoria === 'Material' && g.trabajo_id === 'w1' && g.local_id === L1 && g.tecnico_id === 'Ana Admin' && g.tipo === 'gasto' && r.includes('12 con 50'), 'gasto: con trabajo, sede y persona');

  r = await hablar('toma nota: pedir más cable');
  ok(base.db.tablero_notas[0]?.titulo === 'Pedir más cable UTP' && base.db.tablero_notas[0]?.user_id === 'u-ana' && r.includes('Nota apuntada'), 'nota del tablero a nombre de quien habla');

  r = await hablar('añade a la descripción del 151 que cambié el router');
  ok(base.db.trabajos[0].descripcion === 'Router viejo\nCambiado el router por el nuevo' && r.includes('añadido'), 'descripción: se añade a lo que había');

  r = await hablar('dile al equipo que pasen por Bar Manolo');
  ok(comandas[0]?.accion === 'crear' && comandas[0]?.texto.includes('Bar Manolo') && r.includes('2 tareas'), 'comanda: se reparte por la función comandas');
  await page.screenshot({ path: `${CAPTURAS}/voz-ordenes.png` });
  await ctx.close();

  // ── Áreas aún de la app: lo dice y no escribe ─────────────────────────────
  const app = [
    { area: 'agenda', dueno: 'app', tablas: ['agenda'] }, { area: 'gastos', dueno: 'app', tablas: ['gastos'] },
    { area: 'conocimiento', dueno: 'app', tablas: ['tablero_notas'] }, { area: 'tickets', dueno: 'app', tablas: ['tickets'] },
    { area: 'trabajos', dueno: 'app', tablas: ['trabajos'] },
  ];
  const b2 = await abrir(app, rpc);
  for (const [t, que] of [['mueve el 151', 'la agenda'], ['apunta una cita', 'la cita'], ['un gasto de 5', 'el gasto'], ['toma nota', 'la nota'], ['cierra el ticket', 'el ticket'], ['la descripción del 151', 'la descripción']]) {
    r = await b2.hablar(t);
    ok(r.includes('todavía se hace en la app'), `con el área de la app: ${que} lo dice`);
  }
  ok(!b2.base.reg.escrituras.length, `con las áreas de la app no se escribe nada${b2.base.reg.escrituras.length ? ': ' + b2.base.reg.escrituras.map(e => `${e.metodo} ${e.tabla}`).join(', ') : ''}`);
  await b2.ctx.close();

  ok(!errores.length, `sin errores JS${errores.length ? ': ' + errores.join(' | ') : ''}`);
} finally {
  await browser.close();
  srv.parar();
}
if (!fallos()) console.log('\nTodo bien');
process.exit(fallos() ? 1 : 0);
