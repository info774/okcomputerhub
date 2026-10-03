// Arnés de la lista del día (paridad bloque 1, tanda 3): lista por persona y
// día con el título leído del origen, marcar por hub.lista_dia_marcar (y su
// aviso sin fichaje), pasar a otra persona (lo reasigna), quitar, recado
// suelto, añadir de lo pendiente (lo asigna), traer lo ya asignado, el técnico
// solo ve lo suyo, Planificar (hoy/mañana/+7 d con su hora) y la casilla del
// alta de trabajo. Sin corte: se ve y no se toca.
//   npm run build && node .claude/skills/verify/verify-lista-dia.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS } from './comun.mjs';

const { ok, fallos } = contador();
const srv = await servidor(4196);
const hoy = new Date().toLocaleDateString('sv-SE');
const ayer = new Date(Date.now() - 86400000).toLocaleDateString('sv-SE');
const C1 = 'c1111111-1111-1111-1111-111111111111';
const base0 = cortado => ({
  usuarios: [{ id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true }, { id: 'u-tito', nombre: 'Tito Pérez', email: 'tito@ok.test', rol: 'tecnico', activo: true }],
  areas: [{ area: 'lista_dia', dueno: cortado ? 'hub' : 'app', tablas: ['lista_dia'] },
          { area: 'trabajos', dueno: cortado ? 'hub' : 'app', tablas: ['trabajos', 'agenda', 'sesiones'] }, { area: 'tareas', dueno: cortado ? 'hub' : 'app', tablas: ['tareas'] }],
  sync_estado: [], proyectos: [],
  clientes: [{ id: C1, nombre: 'Hotel Playa SL', activo: true }],
  trabajos: [{ id: 't1', numero: 151, titulo: 'Cambiar router', estado: 'Pendiente', cliente_id: C1, tecnicos: ['Tito Pérez'], fecha_programada: hoy, hora_llegada: new Date(`${hoy}T10:00:00`).toISOString() },
    { id: 't2', numero: 152, titulo: 'Revisar alarma', estado: 'Pendiente', cliente_id: C1, tecnicos: [], fecha_programada: ayer, hora_llegada: new Date(`${ayer}T16:30:00`).toISOString() }],
  tareas: [{ id: 'k1', numero: 9, titulo: 'Llamar a proveedor', estado: 'pendiente', cliente_id: null, tecnico_id: 'Tito Pérez', fecha_vencimiento: hoy, created_at: hoy }],
  tickets: [{ id: 'x1', numero: 5031, titulo: 'Sin wifi', estado: 'Abierto', cliente_id: C1, tecnico_id: null }],
  agenda: [], sesiones: [],
  lista_dia: [{ id: 'l1', fecha: hoy, usuario: 'Tito Pérez', tipo: 'trabajo', ref_id: 't1', titulo: null, orden: 1, completado: false, estado_previo: null },
    { id: 'l2', fecha: hoy, usuario: 'Tito Pérez', tipo: 'nota', ref_id: null, titulo: 'Comprar bridas', orden: 2, completado: false, estado_previo: null },
    { id: 'l3', fecha: hoy, usuario: 'Ana Admin', tipo: 'ticket', ref_id: 'x1', titulo: null, orden: 1, completado: false, estado_previo: null }],
});
const RPC = {
  lista_dia_marcar: (b, db) => {
    const it = db.lista_dia.find(x => x.id === b.p_id);
    let aviso = null;
    if (b.p_marcar && it.tipo === 'trabajo') aviso = 'Marcado en la lista. El trabajo sigue en «Pendiente»: hace falta fichar el inicio y el fin para completarlo.';
    if (b.p_marcar && it.tipo === 'ticket') { const t = db.tickets.find(x => x.id === it.ref_id); it.estado_previo = t.estado; t.estado = 'Cerrado'; }
    it.completado = b.p_marcar;
    return { ok: true, aviso };
  },
};

async function contexto(browser, email, cortado, viewport = { width: 1280, height: 900 }) {
  const base = baseMemoria(base0(cortado), RPC);
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport });
  await preparar(ctx, { email, base });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
  page.on('dialog', d => d.accept());
  return { ctx, page, base, errores };
}
const escr = (base, m, t) => base.reg.escrituras.filter(e => e.metodo === m && e.tabla === t);

const browser = await navegador();
try {
  // ── Sin corte ───────────────────────────────────────────────────────────
  const A = await contexto(browser, 'ana@ok.test', false);
  await A.page.goto(`${srv.base}/#/lista-dia`);
  await A.page.waitForSelector('.ld-lista');
  ok(await A.page.isDisabled('.ld-fila input[type=checkbox]') && await A.page.locator('[data-action="ldAbrirAnadir"]').count() === 0 && await A.page.locator('.area-app').count() === 1, 'sin corte: se ve, no se marca ni se añade, y lo avisa');
  await A.ctx.close();

  // ── Con corte, admin ────────────────────────────────────────────────────
  const B = await contexto(browser, 'ana@ok.test', true);
  const { page, base } = B;
  await page.goto(`${srv.base}/#/lista-dia`);
  await page.waitForSelector('.ld-lista');
  ok((await page.textContent('.ld-lista')).includes('#5031 Sin wifi'), 'admin: arranca en su lista, con el título leído del ticket');
  await page.click('[data-action="ldPersona"][data-p0="Tito Pérez"]');
  await page.waitForFunction(() => document.querySelectorAll('.ld-fila').length === 2);
  ok((await page.textContent('.ld-lista')).includes('#151 Cambiar router') && (await page.textContent('.ld-lista')).includes('Comprar bridas'), 'lista de otra persona: trabajo y recado');
  ok((await page.textContent('.tarjeta-cab .chip')).includes('0/2'), 'contador 0/2 hechos');

  // Marcar sin fichaje: se marca en la lista y avisa
  await page.check('.ld-fila:has-text("Cambiar router") input[type=checkbox]');
  await page.waitForFunction(() => document.getElementById('toast')?.textContent.includes('fichar'));
  ok(escr(base, 'RPC', 'lista_dia_marcar').at(-1)?.cuerpo.p_marcar === true, 'marcar va por hub.lista_dia_marcar y avisa del fichaje');

  // Pasar a otra persona: reasigna el trabajo (quita a Tito, pone a Ana)
  await page.waitForSelector('.ld-fila:has-text("Cambiar router") .ld-mover');
  await page.selectOption('.ld-fila:has-text("Cambiar router") .ld-mover', 'Ana Admin');
  await page.waitForFunction(() => document.querySelectorAll('.ld-fila').length === 1);
  const tec = escr(base, 'PATCH', 'trabajos').at(-1)?.cuerpo?.tecnicos;
  ok(escr(base, 'PATCH', 'lista_dia').at(-1)?.cuerpo?.usuario === 'Ana Admin' && JSON.stringify(tec) === '["Ana Admin"]', 'pasar a otra persona: la lista y el técnico del trabajo');

  // Recado, añadir de lo pendiente (asigna) y traer lo asignado
  await page.fill('#ld-nota', 'Recoger llaves');
  await page.click('form[data-on-submit="ldNota"] button');
  await page.waitForFunction(() => [...document.querySelectorAll('.ld-fila')].some(f => f.textContent.includes('Recoger llaves')));
  ok(escr(base, 'POST', 'lista_dia').at(-1)?.cuerpo?.tipo === 'nota', 'recado suelto apuntado');
  await page.click('[data-action="ldAbrirAnadir"]');
  await page.waitForSelector('.ld-cand');
  await page.click('.ld-cand[data-p1="t2"]');
  await page.waitForSelector('.ld-cand.dentro[data-p1="t2"]');
  ok(escr(base, 'PATCH', 'trabajos').at(-1)?.cuerpo?.tecnicos?.includes('Tito Pérez'), 'añadir de lo pendiente: se lo asigna (lo añade a los técnicos)');
  await page.click('[data-action="ldTraer"]');
  await page.waitForFunction(() => document.getElementById('toast')?.textContent.includes('añadido'));
  const traidos = escr(base, 'POST', 'lista_dia').slice(-1)[0]?.cuerpo;
  ok(traidos?.tipo === 'tarea' && traidos?.ref_id === 'k1', 'traer lo ya asignado: la tarea de hoy de Tito');

  // Quitar
  await page.waitForFunction(() => [...document.querySelectorAll('.ld-fila')].some(f => f.textContent.includes('Llamar a proveedor')));
  const antes = await page.locator('.ld-fila').count();
  await page.click('.ld-fila:has-text("Comprar bridas") [data-action="ldQuitar"]');
  await page.waitForFunction(n => document.querySelectorAll('.ld-fila').length === n - 1, antes);
  ok(true, 'quitar de la lista');

  // Planificar
  await page.click('[data-action="ldIrPlanificar"]');
  await page.waitForSelector('#ld-p-t2');
  ok((await page.textContent('#ld-p-t2')).includes('atrasado'), 'planificar: lo de ayer sale como atrasado');
  await page.click('#ld-p-t2 [data-p2="manana"]');
  await page.waitForFunction(() => !document.getElementById('ld-p-t2'));
  const mv = escr(base, 'PATCH', 'trabajos').at(-1)?.cuerpo;
  const manana = new Date(Date.now() + 86400000).toLocaleDateString('sv-SE');
  ok(mv?.fecha_programada === manana && new Date(mv.hora_llegada).toLocaleDateString('sv-SE') === manana && new Date(mv.hora_llegada).getHours() === 16, 'planificar: «Mañana» mueve la fecha y la hora con ella');
  await page.screenshot({ path: `${CAPTURAS}/lista-dia.png`, fullPage: true });

  // Alta de trabajo con «Añadir a la lista del día»
  await page.goto(`${srv.base}/#/trabajos/nuevo`);
  await page.waitForSelector('#tf-lista');
  await page.fill('#tf-titulo', 'Montar rack');
  await page.check('.tf-tecnicos input[value="Tito Pérez"]');
  await page.check('#tf-lista');
  await page.click('#tf-form button[type=submit]');
  await page.waitForSelector('.op-ficha');
  const alta = escr(base, 'POST', 'lista_dia').at(-1)?.cuerpo;
  ok(alta?.tipo === 'trabajo' && alta?.usuario === 'Tito Pérez' && alta?.fecha === hoy, 'alta de trabajo: entra en la lista del técnico');
  ok(B.errores.length === 0, `sin errores${B.errores.length ? ': ' + B.errores.join(' | ') : ''}`);
  await B.ctx.close();

  // ── Técnico: solo lo suyo; móvil sin desbordar ─────────────────────────
  const T = await contexto(browser, 'tito@ok.test', true, { width: 390, height: 844 });
  await T.page.goto(`${srv.base}/#/lista-dia`);
  await T.page.waitForSelector('.ld-lista');
  ok(await T.page.locator('[data-action="ldPersona"]').count() === 0 && !(await T.page.textContent('.ld-lista')).includes('Sin wifi'), 'técnico: solo su lista, sin elegir persona');
  const ancho = await T.page.evaluate(() => document.documentElement.scrollWidth);
  ok(ancho <= 390, `móvil: sin desbordar (${ancho} px)`);
  await T.ctx.close();
} finally {
  await browser.close();
  srv.parar();
}
process.exit(fallos() ? 1 : 0);
