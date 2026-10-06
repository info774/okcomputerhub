// Arnés de Mantenimientos con las áreas cortadas (paridad bloque 4, tanda 1):
// editar en la fila de la tabla maestra (certificado, control horario), la
// ficha de mantenimiento con sus teléfonos (9 cifras como poco), el
// checklist de tareas del plan por periodo (marcar = fila, desmarcar =
// quitarla), el seguimiento comercial (alta, kanban con arrastre), los planes
// (solo admin; el nombre no se cambia), sus tareas y los checklists de visita,
// el «+ Contrato» (plan, cuota neta y frecuencia de una sede; a una que cobra
// Stripe no se le tocan),
// y el checklist de la visita en la ficha del trabajo (el del plan de la sede o
// el genérico; completado = ningún obligatorio vacío). Con el área `trabajos`
// en la app, el checklist del trabajo es de solo lectura.
//
//   npm run build && node .claude/skills/verify/verify-mantenimientos-escritura.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS } from './comun.mjs';

const PUERTO = 4231;
const { ok, fallos, sumar } = contador();
const dia = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString(); };

const FIX = {
  usuarios: [
    { id: 'u-fran', nombre: 'Fran Admin', email: 'admin@ok.test', rol: 'admin', activo: true },
    { id: 'u-mat', nombre: 'Matteo Monastero', email: 'tec@ok.test', rol: 'tecnico', activo: true },
  ],
  sync_estado: [], config: [], clientes_crm: [], tickets: [], agenda: [],
  // AnyDesk de la tabla maestra: el mismo ID escrito de dos formas cuenta una vez.
  local_hardware: [{ id: 'h1', local_id: 'l2', tipo: 'TPV', nombre: 'Caja', anydesk_id: '123 456 789', created_at: dia(-5) }],
  local_software: [{ id: 's1', local_id: 'l2', nombre: 'Glop', anydesk_id: '123456789', created_at: dia(-4) }],
  sesiones: [], documento_lineas: [],
  trabajo_comentarios: [], trabajo_fotos: [], sitio_tarea_seguimiento: [], mant_seguimiento: [], checklist_respuestas: [], areas: [],
  contactos: [{ id: 'k1', nombre: 'Lola', cliente_id: 'c2', activo: true }],
  clientes: [{ id: 'c1', nombre: 'Polinesia Restaurante', activo: true }, { id: 'c2', nombre: 'Bananas Cafetería', activo: true }],
  locales: [
    { id: 'l1', nombre: 'Polinesia · Playa del Duque', cliente_id: 'c1', activo: true, plan: 'Premium', importe_mantenimiento: 79, estado_pago: 'Al corriente', codigo_verificacion: '482913' },
    { id: 'l2', nombre: 'Bananas Cafetería', cliente_id: 'c2', activo: true, plan: 'Silver', importe_mantenimiento: 39, estado_pago: 'Al corriente' },
    { id: 'l3', nombre: 'Polinesia · Los Cristianos', cliente_id: 'c1', activo: true, plan: null },
    { id: 'l6', nombre: 'Bar sin plan', activo: true, plan: 'Sin mantenimiento' },
    { id: 'l7', nombre: 'Chalet de Ana', activo: true, plan: 'Básico', tipo: 'Vivienda' },
    { id: 'l8', nombre: 'Peluquería sin PC', activo: true, plan: 'Básico', tipo: 'Local', tiene_software: false },
  ],
  local_telefonos: [{ id: 'lt1', local_id: 'l1', nombre: 'Lola', numero: '600111222', rol: 'empleado', created_at: dia(-30) }],
  planes_mantenimiento: [
    { id: 'p1', nombre: 'Premium', orden: 1, precio_mensual: 79, frecuencia_pago: 'Mensual', activo: true, caracteristicas: ['Soporte 24 h'], contrato_servicios: { incluidos: ['Remoto'], no_incluidos: [] } },
    { id: 'p2', nombre: 'Silver', orden: 2, precio_mensual: 39, frecuencia_pago: 'Mensual', activo: true, caracteristicas: [], contrato_servicios: null },
  ],
  plan_tareas: [
    { id: 'pt1', plan: 'Premium', nombre: 'Revisión mensual', periodicidad: 'mensual', es_backup: false, orden: 0, activa: true },
    { id: 'pt2', plan: 'Premium', nombre: 'Copia comprobada', periodicidad: 'mensual', es_backup: true, orden: 1, activa: true },
    { id: 'pt3', plan: 'Silver', nombre: 'Revisión trimestral', periodicidad: 'trimestral', es_backup: false, orden: 0, activa: true },
  ],
  checklist_plantillas: [
    { id: 'ck1', nombre: 'Visita Premium', plan: 'Premium', activa: true, items: [
      { id: 'i1', texto: 'Limpiar ventiladores', tipo: 'check', obligatorio: true },
      { id: 'i2', texto: 'Temperatura de la CPU', tipo: 'number', obligatorio: false },
      { id: 'i3', texto: 'Observaciones', tipo: 'text', obligatorio: false }] },
    { id: 'ck2', nombre: 'Visita genérica', plan: null, activa: true, items: [{ id: 'g1', texto: 'Probar la impresora', tipo: 'check', obligatorio: true }] },
  ],
  trabajos: [
    { id: 't1', numero: 151, created_at: dia(-2), titulo: 'Revisión Playa del Duque', tipo: 'Mantenimiento', estado: 'En progreso', tecnicos: ['Matteo Monastero'], cliente_id: 'c1', local_id: 'l1' },
    { id: 't2', numero: 152, created_at: dia(-2), titulo: 'Revisión Bananas', tipo: 'Mantenimiento', estado: 'Pendiente', tecnicos: [], cliente_id: 'c2', local_id: 'l2' },
    { id: 't3', numero: 153, created_at: dia(-2), titulo: 'Cambiar router', tipo: 'Avería', estado: 'Pendiente', tecnicos: [], local_id: 'l6' },
  ],
};
const RPC = { clases_clientes: () => [], linea_tiempo: () => [], chat_resumen: () => [] };

const srv = await servidor(PUERTO);
const browser = await navegador();
const esc = (base, m, t) => base.reg.escrituras.filter(e => e.metodo === m && e.tabla === t);
const espera = (fn, ms = 4000) => new Promise((res, rej) => { const t0 = Date.now(); const i = setInterval(() => { if (fn()) { clearInterval(i); res(); } else if (Date.now() - t0 > ms) { clearInterval(i); rej(new Error('no llegó la escritura')); } }, 50); });

try {
  let ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  const base = baseMemoria(FIX, RPC);
  await preparar(ctx, { email: 'admin@ok.test', base });
  let page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
  page.on('dialog', d => d.accept());

  // ── Locales: lo que se edita en la fila ─────────────────────────────────
  await page.goto(`${srv.base}/#/mantenimientos/locales`);
  await page.waitForSelector('#mt-tabla tr[data-sede="l2"]');
  ok(!(await page.$('.aviso.area-app')), 'con el área cortada no hay aviso de solo lectura');
  await page.fill('#mt-tabla tr[data-sede="l2"] input[type=date][aria-label^="Caducidad"]', '2027-03-15');
  await espera(() => esc(base, 'PATCH', 'locales').length === 1);
  ok(esc(base, 'PATCH', 'locales')[0].cuerpo.cert_caducidad === '2027-03-15' && esc(base, 'PATCH', 'locales')[0].url.includes('id=eq.l2'), 'la caducidad del certificado se guarda desde la fila');
  await page.selectOption('#mt-tabla tr[data-sede="l2"] select[aria-label="Control horario"]', 'no');
  await espera(() => esc(base, 'PATCH', 'locales').length === 2);
  ok(esc(base, 'PATCH', 'locales')[1].cuerpo.control_horario === false, 'control horario «No» = false');

  // AnyDesk (app 850a0ec) y fuera las viviendas.
  ok(!(await page.$('#mt-tabla tr[data-sede="l7"]')), 'las viviendas no salen en la tabla maestra');
  const ad2 = await page.$$eval('#mt-tabla tr[data-sede="l2"] [data-action="mtAnyDesk"]', bs => bs.map(b => b.dataset.p0));
  ok(ad2.length === 1 && ad2[0] === '123 456 789', 'AnyDesk: los de Hardware y Software, sin repetir el mismo ID');
  ok((await page.getAttribute('#mt-tabla tr[data-sede="l1"] a.g-mal', 'href')) === '#/sitios/l1/hardware', 'sin AnyDesk: en rojo y a la pestaña Hardware del sitio');
  ok((await page.textContent('#mt-tabla tr[data-sede="l8"]')).includes('No aplica'), 'sede sin software: AnyDesk no aplica');
  await page.selectOption('#mt-ficha', 'sin_anydesk');
  await page.waitForFunction(() => !document.querySelector('#mt-tabla tr[data-sede="l2"]'));
  ok(await page.$('#mt-tabla tr[data-sede="l1"]') && !(await page.$('#mt-tabla tr[data-sede="l8"]')), 'filtro «Sin AnyDesk»: no cuenta las sedes sin software');
  await page.selectOption('#mt-ficha', '');
  await page.fill('#mt-filtro', '123456');
  await page.waitForFunction(() => !document.querySelector('#mt-tabla tr[data-sede="l1"]') && !!document.querySelector('#mt-tabla tr[data-sede="l2"]'));
  ok(true, 'el buscador encuentra la sede por su AnyDesk');
  await page.evaluate(() => { window.__abiertos = []; window.open = u => { window.__abiertos.push(String(u)); return null; }; });
  await page.click('#mt-tabla tr[data-sede="l2"] [data-action="mtAnyDesk"]');
  await page.waitForFunction(() => window.__abiertos.length > 0);
  ok((await page.evaluate(() => window.__abiertos[0])) === 'anydesk://123456789', 'clic en el AnyDesk: abre AnyDesk con el ID');
  await page.fill('#mt-filtro', '');
  await page.waitForSelector('#mt-tabla tr[data-sede="l1"]');

  // ── Ficha de mantenimiento ─────────────────────────────────────────────
  await page.click('#mt-tabla tr[data-sede="l1"] a[href="#/mantenimientos/ficha/l1"]');
  await page.waitForSelector('#fm-form');
  ok((await page.textContent('#fm-codigo')) === '482913', 'la ficha enseña el código de verificación');
  await page.fill('#fm-cert', '2027-01-31');
  await page.selectOption('#fm-backup-tipo', 'nas');
  await page.fill('#fm-backup-destino', 'NAS de la oficina');
  await page.selectOption('#fm-ch', 'si');
  await page.fill('#fm-ch-sistema', 'Glop');
  await page.check('#fm-ch-nuestro');
  await page.selectOption('.fm-tel[data-tel="0"] select', 'dueno');
  await page.click('[data-action="fmTelAnadir"]');
  await page.fill('.fm-tel[data-tel="1"] input[type=tel]', '9221');
  await page.dispatchEvent('.fm-tel[data-tel="1"] input[type=tel]', 'change');
  await page.click('#fm-form button[type=submit]');
  await page.waitForTimeout(300);
  ok(esc(base, 'PATCH', 'locales').length === 2, 'un teléfono con menos de 9 cifras no deja guardar');
  await page.fill('.fm-tel[data-tel="1"] input[type=tel]', '922 123 456');
  await page.dispatchEvent('.fm-tel[data-tel="1"] input[type=tel]', 'change');
  await page.fill('.fm-tel[data-tel="1"] label:first-child input', 'Administración');
  await page.dispatchEvent('.fm-tel[data-tel="1"] label:first-child input', 'change');
  await page.selectOption('.fm-tel[data-tel="1"] select', 'administracion');
  await page.click('#fm-form button[type=submit]');
  await page.waitForFunction(() => location.hash === '#/mantenimientos/locales');
  const pf = esc(base, 'PATCH', 'locales')[2].cuerpo;
  ok(pf.cert_caducidad === '2027-01-31' && pf.backup_tipo === 'nas' && pf.backup_destino === 'NAS de la oficina' && pf.control_horario === true
    && pf.control_horario_sistema === 'Glop' && pf.control_horario_nuestro === true, 'la ficha guarda certificado, copia y control horario');
  ok(esc(base, 'PATCH', 'local_telefonos')[0]?.cuerpo.rol === 'dueno', 'el rol del teléfono que había cambia');
  const nt = esc(base, 'POST', 'local_telefonos')[0]?.cuerpo;
  ok(nt?.local_id === 'l1' && nt.numero === '922 123 456' && nt.rol === 'administracion' && nt.nombre === 'Administración', 'el teléfono nuevo entra con su rol');
  await page.waitForSelector('#mt-tabla tr[data-sede="l1"]');
  ok((await page.textContent('#mt-tabla tr[data-sede="l1"]')).includes('600111222'), 'la tabla maestra ya lo enseña como teléfono de dueño');
  await page.goto(`${srv.base}/#/mantenimientos/ficha/l1`);
  await page.waitForSelector('.fm-tel[data-tel="1"]');
  await page.click('.fm-tel[data-tel="1"] [data-action="fmTelQuitar"]');
  await page.click('#fm-form button[type=submit]');
  await page.waitForFunction(() => location.hash === '#/mantenimientos/locales');
  ok(esc(base, 'DELETE', 'local_telefonos').length === 1, 'quitar un teléfono lo borra al guardar');

  // ── Checklist del plan ─────────────────────────────────────────────────
  await page.goto(`${srv.base}/#/mantenimientos/checklist`);
  await page.waitForSelector('#mck-tabla');
  const filasCk = () => page.$$eval('#mck-tabla tbody tr:not(:has(.vacio))', ts => ts.length);
  ok(await filasCk() === 3, `sede × tarea de su plan: Premium 2 + Silver 1 (${await filasCk()})`);
  await page.click('[data-action="mckBackup"]');
  await page.waitForFunction(() => document.querySelectorAll('#mck-tabla tbody tr').length === 1);
  ok((await page.textContent('#mck-tabla tbody')).includes('Copia comprobada'), 'filtro de copias de seguridad');
  await page.click('[data-action="mckBackup"]');
  await page.click('#mck-tabla tr[data-par="l2|pt3"] [data-action="mckMarcar"]');
  await espera(() => esc(base, 'POST', 'sitio_tarea_seguimiento').length === 1);
  const mk = esc(base, 'POST', 'sitio_tarea_seguimiento')[0].cuerpo;
  ok(mk.local_id === 'l2' && mk.tarea_id === 'pt3' && /^\d{4}-T[1-4]$/.test(mk.periodo) && mk.completado_por === 'u-fran', `marcar = fila del periodo actual (${mk.periodo})`);
  await page.waitForFunction(() => document.querySelectorAll('#mck-tabla tbody tr').length === 2);
  ok(true, 'lo hecho sale de «Pendientes»');
  await page.click('[data-action="mckEstado"][data-p0="todas"]');
  await page.waitForSelector('#mck-tabla tr[data-par="l2|pt3"] .hecha');
  await page.click('#mck-tabla tr[data-par="l2|pt3"] [data-action="mckMarcar"]');
  await espera(() => esc(base, 'DELETE', 'sitio_tarea_seguimiento').length === 1);
  ok(true, 'desmarcar quita la fila');

  // ── Seguimiento comercial ──────────────────────────────────────────────
  await page.goto(`${srv.base}/#/mantenimientos/seguimiento`);
  await page.waitForSelector('.mse-kanban');
  await page.click('a[href="#/mantenimientos/seguimiento/nuevo"]');
  await page.waitForSelector('#mse-form');
  await page.click('#mse-form button[type=submit]');
  await page.waitForTimeout(300);
  ok(esc(base, 'POST', 'mant_seguimiento').length === 0, 'sin cliente ni sede no se crea');
  await page.fill('#mse-cliente-q', 'bana');
  await page.click('[data-action="mseElegirCliente"][data-p0="c2"]');
  await page.waitForFunction(() => document.querySelectorAll('#mse-sede option').length === 2 && document.querySelectorAll('#mse-contacto option').length === 2);
  await page.selectOption('#mse-sede', 'l2');
  await page.selectOption('#mse-contacto', 'k1');
  await page.fill('#mse-notas', 'Llamar para ofrecer Premium');
  await page.fill('#mse-recordatorio', dia(-1).slice(0, 10));
  await page.click('#mse-form button[type=submit]');
  await page.waitForFunction(() => location.hash === '#/mantenimientos/seguimiento');
  const sg = esc(base, 'POST', 'mant_seguimiento')[0]?.cuerpo;
  ok(sg?.cliente_id === 'c2' && sg.local_id === 'l2' && sg.contacto_id === 'k1' && sg.estado === 'por_contactar' && sg.dias_recordatorio === 30, 'el seguimiento se crea con cliente, sede y contacto');
  await page.waitForSelector('.pr-columna[data-estado="por_contactar"] .pr-tarjeta');
  ok((await page.textContent('.pr-columna[data-estado="por_contactar"] .pr-tarjeta')).includes('Bananas Cafetería')
    && !!(await page.$('.pr-columna[data-estado="por_contactar"] .pr-tarjeta .g-mal')), 'tarjeta en «Por contactar» con el recordatorio vencido en rojo');
  await page.dragAndDrop('.pr-columna[data-estado="por_contactar"] .pr-tarjeta strong', '.pr-columna[data-estado="interesado"]');
  await espera(() => esc(base, 'PATCH', 'mant_seguimiento').length === 1);
  ok(esc(base, 'PATCH', 'mant_seguimiento')[0].cuerpo.estado === 'interesado', 'arrastrar a otra columna cambia el estado');
  await page.screenshot({ path: `${CAPTURAS}/mantenimientos-seguimiento.png` });

  // ── Plantillas: planes, tareas, checklists de visita ───────────────────
  await page.goto(`${srv.base}/#/mantenimientos/plantillas`);
  await page.waitForSelector('.mpl-planes .mpl-plan');
  ok(await page.$$eval('.mpl-plan', a => a.length) === 2 && await page.$$eval('#mcl-tabla tbody tr', a => a.length) === 2, 'planes y checklists de visita');
  await page.click('.mpl-plan[data-plan="p2"] a');
  await page.waitForSelector('#mpl-form');
  ok(await page.$eval('#mpl-nombre', i => i.readOnly), 'el nombre de un plan existente no se cambia (las sedes lo llevan por nombre)');
  await page.fill('#mpl-precio_mensual', '45');
  await page.fill('#mpl-incluidos', 'Soporte remoto\nUna visita al trimestre');
  await page.click('[data-action="mplTareaNueva"]');
  await espera(() => esc(base, 'POST', 'plan_tareas').length === 1);
  ok(esc(base, 'POST', 'plan_tareas')[0].cuerpo.plan === 'Silver', 'tarea nueva en el plan');
  await page.waitForSelector('#mpl-tareas-tabla tr[data-tarea]:nth-child(2)');
  await page.click('#mpl-tareas-tabla tr[data-tarea="pt3"] [data-action="mplTareaQuitar"]');
  await espera(() => esc(base, 'PATCH', 'plan_tareas').length === 1);
  ok(esc(base, 'PATCH', 'plan_tareas')[0].cuerpo.activa === false, 'quitar una tarea la desactiva (lo marcado se queda)');
  await page.waitForFunction(() => !document.querySelector('#mpl-tareas-tabla tr[data-tarea="pt3"]'));
  await page.fill('#mpl-precio_mensual', '45');
  await page.fill('#mpl-incluidos', 'Soporte remoto\nUna visita al trimestre');
  await page.click('#mpl-form button[type=submit]');
  await page.waitForFunction(() => location.hash === '#/mantenimientos/plantillas');
  const pp = esc(base, 'PATCH', 'planes_mantenimiento')[0]?.cuerpo;
  ok(pp?.precio_mensual === 45 && pp.contrato_servicios.incluidos.length === 2 && pp.nombre === 'Silver', 'el plan se guarda con su precio neto y lo que entra en el contrato');
  await page.click('a[href="#/mantenimientos/plantillas/checklist/nuevo"]');
  await page.waitForSelector('#mcl-form');
  await page.fill('#mcl-nombre', 'Visita Silver');
  await page.selectOption('#mcl-plan', 'Silver');
  await page.click('[data-action="mclItem"]');
  await page.click('[data-action="mclItem"]');
  await page.fill('#mcl-items [data-item="0"] input:not([type])', 'Revisar el TPV');
  await page.dispatchEvent('#mcl-items [data-item="0"] input:not([type])', 'change');
  await page.check('#mcl-items [data-item="0"] input[type=checkbox]');
  await page.click('#mcl-form button[type=submit]');
  await page.waitForFunction(() => location.hash === '#/mantenimientos/plantillas');
  const cl = esc(base, 'POST', 'checklist_plantillas')[0]?.cuerpo;
  ok(cl?.plan === 'Silver' && cl.items.length === 1 && cl.items[0].texto === 'Revisar el TPV' && cl.items[0].obligatorio === true && cl.items[0].id, 'checklist de visita nuevo, sin los puntos vacíos');

  // ── + Contrato: plan, cuota y frecuencia de una sede ─────────────────
  await page.goto(`${srv.base}/#/mantenimientos/locales`);
  await page.click('a[href="#/mantenimientos/alta"]');
  await page.waitForSelector('#mal-form');
  await page.click('#mal-form button[type=submit]');
  await page.waitForTimeout(300);
  ok(esc(base, 'POST', 'mantenimientos_programados').length === 0, 'sin cliente ni sede no se crea el contrato');
  await page.fill('#mal-cliente-q', 'polin');
  await page.click('[data-action="malElegirCliente"][data-p0="c1"]');
  await page.waitForFunction(() => [...document.querySelectorAll('#mal-sede option')].some(o => o.value === 'l3'));
  await page.selectOption('#mal-sede', 'l3');
  await page.fill('#mal-inicio', '2026-11-01');
  await page.click('[data-action="malPlan"][data-p0="Premium"]');
  ok((await page.inputValue('#mal-importe')) === '79' && (await page.inputValue('#mal-frecuencia')) === 'Mensual', 'el plan rellena su cuota y su frecuencia');
  ok((await page.inputValue('#mal-proxima')) === '2027-02-01', `Premium: revisión a los 3 meses (${await page.inputValue('#mal-proxima')})`);
  await page.fill('#mal-importe', '70');
  await page.selectOption('#mal-frecuencia', 'Trimestral');
  const antesL = esc(base, 'PATCH', 'locales').length;
  await page.click('#mal-form button[type=submit]');
  await page.waitForFunction(() => location.hash === '#/mantenimientos/locales');
  const mp = esc(base, 'POST', 'mantenimientos_programados')[0]?.cuerpo;
  ok(mp?.cliente_id === 'c1' && mp.local_id === 'l3' && mp.plan === 'Premium' && mp.proxima_fecha === '2027-02-01' && mp.ultimo_generado === '2026-11-01' && mp.activo === true, 'el mantenimiento programado se apunta');
  const pc = esc(base, 'PATCH', 'clientes').at(-1)?.cuerpo;
  ok(pc?.plan === 'Premium' && pc.fecha_activacion === '2026-11-01', 'el cliente queda con el plan');
  const pl = esc(base, 'PATCH', 'locales').slice(antesL)[0];
  ok(pl?.url.includes('id=eq.l3') && pl.cuerpo.plan === 'Premium' && pl.cuerpo.importe_mantenimiento === 70 && pl.cuerpo.importe_incluye_impuesto === false
    && pl.cuerpo.frecuencia_pago === 'Trimestral', 'la sede queda con plan, cuota NETA (sin la marca de bruto) y frecuencia');
  await page.waitForSelector('#mt-tabla tr[data-sede="l3"]');
  ok(true, 'y ya sale en la tabla maestra');
  base.db.locales.find(l => l.id === 'l1').stripe_subscription_id = 'sub_1';
  await page.click('a[href="#/mantenimientos/alta"]');
  await page.waitForSelector('#mal-form');
  await page.fill('#mal-cliente-q', 'polin');
  await page.click('[data-action="malElegirCliente"][data-p0="c1"]');
  await page.waitForFunction(() => [...document.querySelectorAll('#mal-sede option')].some(o => o.value === 'l1'));
  await page.selectOption('#mal-sede', 'l1');
  await page.click('[data-action="malPlan"][data-p0="Silver"]');
  const antesL2 = esc(base, 'PATCH', 'locales').length;
  await page.click('#mal-form button[type=submit]');
  await page.waitForFunction(() => location.hash === '#/mantenimientos/locales');
  ok(esc(base, 'POST', 'mantenimientos_programados').length === 2 && esc(base, 'PATCH', 'locales').length === antesL2
    && (await page.textContent('#toast')).includes('Stripe'), 'a una sede que cobra Stripe no se le toca la cuota (y se avisa)');
  const idProg = base.db.mantenimientos_programados[0].id;
  await page.goto(`${srv.base}/#/mantenimientos/alta/${idProg}`);
  await page.waitForSelector('#mal-form');
  ok((await page.inputValue('#mal-plan')) === 'Premium' && (await page.inputValue('#mal-sede')) === 'l3' && (await page.inputValue('#mal-importe')) === '70', 'editar un contrato lo trae relleno');

  // ── Checklist de la visita en la ficha del trabajo ─────────────────────
  base.db.checklist_plantillas = base.db.checklist_plantillas.filter(c => c.id !== cl.id && c.plan !== 'Silver');
  await page.goto(`${srv.base}/#/trabajos/151`);
  await page.waitForSelector('#tcv');
  ok((await page.textContent('#tcv')).includes('Visita Premium') && (await page.textContent('#tcv-insignia')) === '0/3', 'el trabajo de una sede Premium saca su checklist');
  await page.check('#tcv [data-item="i1"]');
  await page.fill('#tcv [data-item="i2"]', '54');
  ok((await page.textContent('#tcv-insignia')) === '2/3', 'la insignia cuenta lo rellenado');
  await page.click('[data-action="tcvGuardar"]');
  await espera(() => esc(base, 'POST', 'checklist_respuestas').length === 1);
  const cr = esc(base, 'POST', 'checklist_respuestas')[0].cuerpo;
  ok(cr.trabajo_id === 't1' && cr.plantilla_id === 'ck1' && cr.plantilla_nombre === 'Visita Premium' && cr.respuestas.i1 === true && cr.respuestas.i2 === '54'
    && cr.completado === true && cr.tecnico_id === 'u-fran', 'se guarda con sus respuestas; completado con los obligatorios hechos');
  await page.reload();
  await page.waitForSelector('#tcv');
  ok((await page.textContent('#tcv-insignia')) === '✓ Completado' && await page.isChecked('#tcv [data-item="i1"]') && (await page.inputValue('#tcv [data-item="i2"]')) === '54', 'al volver, lo guardado');
  await page.uncheck('#tcv [data-item="i1"]');
  await page.click('[data-action="tcvGuardar"]');
  await espera(() => esc(base, 'PATCH', 'checklist_respuestas').length === 1);
  ok(esc(base, 'PATCH', 'checklist_respuestas')[0].cuerpo.completado === false && esc(base, 'POST', 'checklist_respuestas').length === 1, 'la segunda vez se actualiza; sin un obligatorio no está completado');
  await page.screenshot({ path: `${CAPTURAS}/trabajo-checklist-visita.png`, fullPage: true });
  await page.goto(`${srv.base}/#/trabajos/152`);
  await page.waitForSelector('#tcv');
  ok((await page.textContent('#tcv')).includes('Visita genérica'), 'sin checklist de su plan, el genérico');
  await page.goto(`${srv.base}/#/trabajos/153`);
  await page.waitForSelector('.op-ficha');
  ok(!(await page.$('#tcv')), 'una sede sin mantenimiento no lleva checklist');
  ok(base.reg.rest.every(r => r.perfil === 'hub'), 'todas las peticiones con Accept-Profile: hub');
  ok(errores.length === 0, `sin errores JS${errores.length ? ': ' + errores.join(' | ') : ''}`);
  await ctx.close();

  // ── Técnico: los planes no los toca ────────────────────────────────────
  ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 800 } });
  const baseT = baseMemoria(FIX, RPC);
  await preparar(ctx, { email: 'tec@ok.test', base: baseT });
  page = await ctx.newPage();
  await page.goto(`${srv.base}/#/mantenimientos/plantillas/p1`);
  await page.waitForSelector('#mpl-form');
  ok(await page.$eval('#mpl-form button[type=submit]', b => b.disabled) && !(await page.$('[data-action="mplTareaNueva"]')), 'un técnico ve el plan pero no lo cambia');
  await page.goto(`${srv.base}/#/mantenimientos/checklist`);
  await page.waitForSelector('#mck-tabla');
  ok(!!(await page.$('#mck-tabla [data-action="mckMarcar"]')), 'un técnico sí marca las tareas del plan');
  const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
  ok(ancho <= 390, `el checklist no desborda en el móvil (${ancho}px)`);
  await ctx.close();

  // ── Con el área de trabajos en la app: checklist del trabajo en solo lectura ──
  ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  const baseA = baseMemoria({ ...FIX, areas: [{ area: 'trabajos', tablas: ['trabajos', 'documento_lineas', 'checklist_respuestas'], dueno: 'app' }] }, RPC);
  await preparar(ctx, { email: 'admin@ok.test', base: baseA });
  page = await ctx.newPage();
  await page.goto(`${srv.base}/#/trabajos/151`);
  await page.waitForSelector('#tcv');
  ok(await page.$eval('#tcv [data-item="i1"]', i => i.disabled) && !(await page.$('[data-action="tcvGuardar"]')), 'con el área en la app, el checklist se ve pero no se rellena');
  ok(baseA.reg.escrituras.filter(e => e.metodo !== 'RPC').length === 0, 'y no escribe nada');
  await ctx.close();
} catch (e) {
  console.error('✗ excepción:', e);
  sumar();
} finally {
  await browser.close();
  srv.parar();
}
const n = fallos();
console.log(n ? `\n${n} fallo(s)` : '\nTodo bien');
process.exit(n ? 1 : 0);
