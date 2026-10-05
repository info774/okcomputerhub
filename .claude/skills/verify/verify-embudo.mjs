// Arnés del embudo a lo Bitrix24 (2026-10-04): esqueleto mientras carga,
// «sin próximo paso» en tarjetas y columnas, alta rápida por columna (con la
// regla de su etapa), zonas de cierre al arrastrar, comanda PROPUESTA al ganar
// (una persona la confirma), barra de etapas en flechas, próximo paso en la
// ficha (atajos, guardar, «Hecho ✓»), «Proponer» de un área aún de la app,
// reglas en «Configurar embudos» y el alta de trabajo desde una oportunidad.
//   npm run build && node .claude/skills/verify/verify-embudo.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS } from './comun.mjs';

const { ok, fallos, sumar } = contador();
const srv = await servidor(4191);
const dia = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };
const C1 = 'c1111111-1111-1111-1111-111111111111', L1 = 'l1111111-1111-1111-1111-111111111111';
const PIPE = '00000000-0000-4000-8000-000000000001';
const ETAPAS = [
  { clave: 'Detectado', nombre: 'Detectado', probabilidad: 10, tipo: 'abierta', seguimiento_dias: 1, seguimiento_texto: 'Primer contacto' },
  { clave: 'Contactado', nombre: 'Contactado', probabilidad: 25, tipo: 'abierta', seguimiento_dias: 3, seguimiento_texto: 'Volver a llamar' },
  { clave: 'Propuesta', nombre: 'Propuesta', probabilidad: 50, tipo: 'abierta', seguimiento_dias: 7, seguimiento_texto: 'Preguntar por la propuesta', proponer: 'presupuesto' },
  { clave: 'Negociando', nombre: 'Negociando', probabilidad: 75, tipo: 'abierta', seguimiento_dias: 3, seguimiento_texto: 'Cerrar condiciones' },
  { clave: 'Ganado', nombre: 'Ganado', probabilidad: 100, tipo: 'ganada', proponer: 'comanda', comanda_texto: 'Preparar lo vendido a {cliente}: {titulo}' },
  { clave: 'Perdido', nombre: 'Perdido', probabilidad: 0, tipo: 'perdida' },
];
const op = (id, titulo, estado, extra = {}) => ({ id, created_at: new Date().toISOString(), titulo, cliente_id: C1, estado, valor_estimado: 1000, tecnico_id: null,
  fecha_seguimiento: null, siguiente_texto: null, origen: null, pipeline_id: PIPE, orden: 0, cerrada_at: null, descripcion: null, local_id: null, contacto_id: null, motivo_perdida: null, ...extra });
const INICIAL = {
  usuarios: [{ id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true }],
  areas: [{ area: 'presupuestos', dueno: 'app', tablas: ['presupuestos'] }, { area: 'trabajos', dueno: 'hub', tablas: ['trabajos'] }],
  sync_estado: [], proyectos: [], clientes_crm: [],
  clientes: [{ id: C1, nombre: 'Hotel Playa SL', nif: 'B123', activo: true }],
  locales: [{ id: L1, cliente_id: C1, nombre: 'Hotel Playa', activo: true }],
  contactos: [], presupuestos: [], trabajos: [], tareas: [], actividades: [], trabajo_plantillas: [],
  pipelines: [{ id: PIPE, nombre: 'Ventas', etapas: ETAPAS, por_defecto: true, orden: 0, activo: true }],
  oportunidades: [
    op('o1', 'Cámaras hotel', 'Detectado', { fecha_seguimiento: dia(2), siguiente_texto: 'Llamar a Marta' }),
    op('o2', 'TPV nuevo', 'Propuesta', { local_id: L1, descripcion: 'Dos terminales' }),
    op('o3', 'Wifi terraza', 'Negociando', { fecha_seguimiento: dia(-1) }),
  ],
};

const browser = await navegador();
try {
  const base = baseMemoria(INICIAL);
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1400, height: 900 } });
  await preparar(ctx, { email: 'ana@ok.test', base });
  // Las oportunidades tardan en llegar: se tiene que ver el esqueleto.
  let lento = true;
  await ctx.route(/\/rest\/v1\/oportunidades\?/, async r => { if (lento && r.request().method() === 'GET') await new Promise(x => setTimeout(x, 700)); return base.manejar(r); });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
  const dialogos = [];
  page.on('dialog', d => { dialogos.push({ tipo: d.type(), texto: d.message(), defecto: d.defaultValue() }); d.type() === 'prompt' ? d.accept(d.defaultValue()) : d.accept(); });
  const toastCon = t => page.waitForFunction(x => document.getElementById('toast')?.textContent.includes(x), t);

  // ── Kanban ───────────────────────────────────────────────────────────────
  await page.goto(`${srv.base}/#/oportunidades`);
  await page.waitForSelector('.cargando.esq-kanban .esq-col');
  ok(await page.locator('.esq-kanban .esq-col').count() === 4 && (await page.textContent('.cargando')).includes('Cargando'), 'esqueleto: el kanban gris mientras carga, con texto para lectores');
  await page.waitForSelector('.pr-columna');
  lento = false;
  ok(await page.locator('.pr-columna').count() === 4, 'kanban: las 4 etapas abiertas');
  ok((await page.textContent('.pr-tarjeta[data-id="o2"] .op-paso.falta'))?.includes('Sin próximo paso'), 'kanban: la tarjeta sin fecha avisa «Sin próximo paso»');
  ok((await page.textContent('.pr-columna[data-etapa="Propuesta"] > .nota')).includes('1 sin próximo paso'), 'kanban: la columna cuenta las que no tienen próximo paso');
  ok((await page.textContent('.pr-tarjeta[data-id="o1"] .op-paso')).includes('Llamar a Marta'), 'kanban: la tarjeta enseña el próximo paso');
  ok(await page.locator('.pr-tarjeta[data-id="o3"] .op-paso.mal').count() === 1, 'kanban: el próximo paso vencido en rojo');
  ok(await page.locator('.op-cierre .op-zona').count() === 2, 'kanban: zonas de Ganado y Perdido para soltar');
  await page.screenshot({ path: `${CAPTURAS}/embudo-kanban.png`, fullPage: true });

  // Alta rápida en Contactado: nace con el próximo paso de su regla.
  const col = page.locator('.pr-columna[data-etapa="Contactado"]');
  await col.locator('.op-rapida summary').click();
  await col.locator('input[name="titulo"]').fill('Alarma nave');
  await col.locator('input[name="valor"]').fill('2500');
  await col.locator('button[type=submit]').click();
  await toastCon('creada en Contactado');
  const rap = base.db.oportunidades.find(o => o.titulo === 'Alarma nave');
  ok(rap?.estado === 'Contactado' && rap.pipeline_id === PIPE && rap.valor_estimado === 2500 && rap.fecha_seguimiento === dia(3) && rap.siguiente_texto === 'Volver a llamar' && rap.tecnico_id === 'Ana Admin',
    'alta rápida: en su columna, con valor, quién y el próximo paso de la regla');
  await page.waitForSelector('.pr-tarjeta:has-text("Alarma nave")');

  // Arrastrar a la zona de Ganado: cierra y PROPONE la comanda (que se confirma).
  await page.dragAndDrop('.pr-tarjeta[data-id="o1"]', '.op-zona.op-ganada');
  await toastCon('Comanda repartida');
  ok(base.db.oportunidades.find(o => o.id === 'o1').estado === 'Ganado', 'zonas: soltar en Ganado la gana');
  const pr = dialogos.find(d => d.tipo === 'prompt' && d.texto.includes('comanda'));
  ok(pr?.defecto === 'Preparar lo vendido a Hotel Playa SL: Cámaras hotel', 'ganar: propone la comanda con cliente y título');
  const fc = base.reg.funciones.find(f => f.url.endsWith('/comandas'));
  ok(fc?.body.accion === 'crear' && fc.body.texto === pr?.defecto, 'ganar: la comanda va a la función comandas (y solo tras confirmarla)');
  ok(!(await page.locator('body').getAttribute('class') ?? '').includes('op-arrastrando'), 'zonas: al soltar se apaga el resaltado');

  // ── Ficha ────────────────────────────────────────────────────────────────
  await page.goto(`${srv.base}/#/oportunidades/o2`);
  await page.waitForSelector('.op-flechas');
  ok(await page.locator('.op-flechas .op-etapa').count() === 4 && await page.locator('.op-cierres .op-etapa').count() === 2, 'ficha: barra con las abiertas en flechas y los cierres aparte');
  ok(await page.locator('.op-flechas .op-etapa.hecha').count() === 2 && (await page.textContent('.op-flechas .op-etapa.activo')).includes('Propuesta'), 'ficha: lo recorrido marcado y la actual resaltada');
  ok((await page.textContent('main')).includes('Sin próximo paso'), 'ficha: avisa de que no hay próximo paso');
  await page.click('[data-action="opPasoEn"][data-p0="3"]');
  ok(await page.inputValue('#op-paso-fecha') === dia(3), 'próximo paso: «En 3 días» pone la fecha');
  await page.fill('#op-paso-texto', 'Mandar fotos de la instalación');
  await page.click('form[data-on-submit="opPaso"] button[type=submit]');
  await toastCon('Próximo paso guardado');
  let o2 = base.db.oportunidades.find(o => o.id === 'o2');
  ok(o2.fecha_seguimiento === dia(3) && o2.siguiente_texto === 'Mandar fotos de la instalación', 'próximo paso: se guarda cuándo y qué');
  await page.waitForSelector('[data-action="opPasoHecho"]');
  await page.click('[data-action="opPasoHecho"]');
  await toastCon('cuál es el siguiente');
  o2 = base.db.oportunidades.find(o => o.id === 'o2');
  ok(o2.fecha_seguimiento === null && base.db.actividades.some(a => a.oportunidad_id === 'o2' && a.texto === 'Hecho: Mandar fotos de la instalación'),
    '«Hecho ✓»: queda en la línea de tiempo y pide el siguiente');
  await page.waitForFunction(() => document.querySelector('main')?.textContent.includes('Sin próximo paso'));
  await page.screenshot({ path: `${CAPTURAS}/embudo-ficha.png`, fullPage: true });
  // Volver a Propuesta desde Negociando: los presupuestos aún son de la app → solo se avisa.
  await page.click('[data-action="opEtapa"][data-p0="Negociando"]');
  await toastCon('Negociando · próximo paso en 3 días');
  await page.waitForSelector('.op-flechas .op-etapa.activo[data-p0="Negociando"]');
  await page.click('[data-action="opEtapa"][data-p0="Propuesta"]');
  await toastCon('todavía en la app');
  ok((await page.evaluate(() => location.hash)) === '#/oportunidades/o2', 'proponer: con el área en la app no se va a ninguna parte');

  // ── Configurar embudos: reglas ───────────────────────────────────────────
  await page.goto(`${srv.base}/#/oportunidades`);
  await page.waitForSelector('[data-action="opVista"][data-p0="embudos"]');
  await page.click('[data-action="opVista"][data-p0="embudos"]');
  const f = page.locator(`form[data-on-submit^="opGuardarPipe"][data-id="${PIPE}"]`);
  await f.waitFor();
  ok(await f.locator('tr[data-clave]').count() === 6, 'reglas: una fila por etapa');
  await f.locator('tr[data-clave="Contactado"] input[name="dias"]').fill('5');
  await f.locator('tr[data-clave="Negociando"] select[name="proponer"]').selectOption('trabajo');
  await f.locator('button[type=submit]').click();
  await toastCon('Embudo guardado');
  const et = Object.fromEntries(base.db.pipelines[0].etapas.map(e => [e.clave, e]));
  ok(et.Contactado.seguimiento_dias === 5 && et.Contactado.seguimiento_texto === 'Volver a llamar' && et.Negociando.proponer === 'trabajo'
    && et.Ganado.comanda_texto?.includes('{cliente}') && !('seguimiento_dias' in et.Perdido), 'reglas: se guardan por etapa sin perder las demás');

  // ── Trabajo desde la oportunidad ─────────────────────────────────────────
  await page.goto(`${srv.base}/#/trabajos/nuevo/o/o2`);
  await page.waitForSelector('#tf-titulo');
  ok(await page.inputValue('#tf-titulo') === 'TPV nuevo' && await page.inputValue('#tf-cliente') === C1 && (await page.textContent('h2')).includes('TPV nuevo'),
    'trabajo: nace con el título y el cliente de la oportunidad');
  await page.click('form#tf-form button[type=submit]');
  await page.waitForFunction(() => /^#\/trabajos\/\d+$/.test(location.hash));
  const tr = base.db.trabajos.find(t => t.titulo === 'TPV nuevo');
  ok(tr?.oportunidad_id === 'o2' && tr.cliente_id === C1, 'trabajo: queda enlazado a la oportunidad');

  // ── Esqueleto en Clientes ────────────────────────────────────────────────
  await ctx.route(/\/rest\/v1\/clientes\?/, async r => { await new Promise(x => setTimeout(x, 600)); return base.manejar(r); });
  await page.goto(`${srv.base}/#/clientes`);
  await page.waitForSelector('.cargando.esq-tabla .esq-fila');
  ok(true, 'esqueleto: la tabla gris en Clientes mientras carga');

  ok(base.reg.rest.every(r => r.metodo === 'OPTIONS' || r.perfil === 'hub'), 'todas las lecturas con Accept-Profile: hub');
  ok(await page.locator('[onclick],[onchange],[oninput]').count() === 0, 'sin on*= inline');
  ok(errores.length === 0, `sin errores JS${errores.length ? ': ' + errores.join(' | ') : ''}`);
  await ctx.close();

  // ── Móvil ────────────────────────────────────────────────────────────────
  const m = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  await preparar(m, { email: 'ana@ok.test', base: baseMemoria(INICIAL) });
  const mp = await m.newPage();
  await mp.goto(`${srv.base}/#/oportunidades/o2`);
  await mp.waitForSelector('.op-flechas');
  ok(await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'móvil: la ficha con la barra de etapas no desborda');
  await mp.screenshot({ path: `${CAPTURAS}/embudo-movil.png`, fullPage: true });
  await m.close();
} catch (e) {
  sumar(); console.error('✗ excepción:', e);
} finally {
  await browser.close();
  srv.parar();
}
console.log(fallos() ? `\n${fallos()} fallo(s)` : '\nTodo bien');
process.exit(fallos() ? 1 : 0);
