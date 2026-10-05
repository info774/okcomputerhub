// Arnés del tablero VeriFactu (paridad bloque 7, tanda 3): kanban por fase con
// los nombres de sede y cliente, carriles como filtro (cifras), plazo vencido,
// casillas y lo que falta; con el área de la app, solo lectura (sin arrastre ni
// selector ni «Cargar»); con el área del hub, mover arrastrando (avisa de lo que
// falta al avanzar), con el selector, la ficha (guardar casillas y auditoría),
// «Cargar sedes con TPV» (carril por el NIF: sociedad → urgente, TPV raro →
// compleja) y quitar (solo admin). Sin datos reales.
//   npm run build && node .claude/skills/verify/verify-verifactu.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS } from './comun.mjs';

const { ok, fallos } = contador();
const srv = await servidor(4203);
const ahora = new Date().toISOString();
const SEDE = (id, local, cliente, fase, carril, extra = {}) => ({ id, local_id: local, cliente_id: cliente, fase, carril, tipo_contribuyente: null, camino: null,
  software_origen: 'Glop', software_destino: null, fecha_objetivo: null, tecnico: null, hw_tipo_tpv: null, hw_sistema: null, hw_almacenamiento: null, hw_ram: null,
  hw_estado: null, impresora_modelo: null, impresora_interfaz: null, impresora_qr_ok: null, checklist: {}, presupuesto_aceptado: false, fecha_go_live: null,
  trabajo_id: null, notas: null, created_at: ahora, updated_at: ahora, ...extra });
const FIX = areas => ({
  usuarios: [{ id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true }, { id: 'u-tito', nombre: 'Tito', email: 'tito@ok.test', rol: 'tecnico', activo: true }],
  areas, sync_estado: [], config: [],
  clientes: [{ id: 'c1', nombre: 'Bar Pepe SL', nif: 'B12345678', activo: true }, { id: 'c2', nombre: 'Ana López', nif: '12345678Z', activo: true }, { id: 'c3', nombre: 'Hotel Sol SA', nif: 'A111', activo: true }],
  locales: [
    { id: 'l1', nombre: 'Bar Pepe Centro', cliente_id: 'c1', programa_tpv: 'Glop', activo: true },
    { id: 'l2', nombre: 'Kiosko Ana', cliente_id: 'c2', programa_tpv: 'BDP', activo: true },
    { id: 'l3', nombre: 'Hotel Sol', cliente_id: 'c3', programa_tpv: 'TPV antiguo', activo: true },
    { id: 'l4', nombre: 'Sin TPV', cliente_id: 'c3', programa_tpv: null, activo: true },
  ],
  verifactu_sedes: [
    SEDE('v1', 'l1', 'c1', 'censo', 'urgente', { tipo_contribuyente: 'Sociedad', fecha_objetivo: '2026-01-15', software_origen: null }),
    SEDE('v2', 'l2', 'c2', 'taller', 'estandar', { tipo_contribuyente: 'Autonomo', checklist: { backup_previo: true }, tecnico: 'Tito' }),
  ],
});
const APP = [{ area: 'verifactu', tablas: ['verifactu_sedes'], dueno: 'app' }];
const toastCon = (page, t) => page.waitForFunction(x => document.getElementById('toast')?.textContent.includes(x), t);

const browser = await navegador();
const errores = [];
try {
  // ── Con el área de la app ──────────────────────────────────────────────
  let base = baseMemoria(FIX(APP), {});
  let ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
  await preparar(ctx, { email: 'tito@ok.test', base });
  let page = await ctx.newPage();
  page.on('pageerror', e => errores.push(String(e.stack ?? e)));
  page.on('dialog', d => d.accept());
  await page.goto(`${srv.base}/#/verifactu`);
  await page.waitForSelector('.vf-kanban');
  const censo = await page.textContent('.pr-columna[data-fase="censo"]');
  ok(censo.includes('Bar Pepe Centro') && censo.includes('Bar Pepe SL') && censo.includes('Vencido') && censo.includes('Urgente'), 'tablero: la sede con su cliente, carril y plazo vencido');
  ok((await page.textContent('.pr-columna[data-fase="taller"]')).includes('1/7'), 'tablero: casillas hechas de las siete');
  ok(await page.locator('.vf-tarjeta[draggable="true"]').count() === 0 && await page.locator('.vf-mover').count() === 0 && await page.locator('[data-action="vfCargar"]').count() === 0
    && await page.isVisible('.area-app'), 'área de la app: solo lectura (sin arrastrar, selector ni «Cargar»)');
  await page.click('.vf-carril[data-p0="estandar"]');
  await page.waitForFunction(() => !document.querySelector('.pr-columna[data-fase="censo"]')?.textContent.includes('Bar Pepe'));
  ok((await page.textContent('.vf-kanban')).includes('Kiosko Ana'), 'carriles: filtran el tablero');
  await page.goto(`${srv.base}/#/verifactu/v2`);
  await page.waitForSelector('#vf-form');
  const avisoFicha = await page.textContent('#vf-form .aviso');
  ok(await page.isDisabled('#vf-fase') && avisoFicha.includes('Para salir') && avisoFicha.includes('Tipos de IGIC') && !avisoFicha.includes('Backup previo'),
    'ficha: lo que falta para salir de la fase (sin lo ya hecho), en solo lectura');
  await ctx.close();

  // ── Con el área del hub ─────────────────────────────────────────────────
  base = baseMemoria(FIX([]), {});
  ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
  await preparar(ctx, { email: 'ana@ok.test', base });
  page = await ctx.newPage();
  page.on('pageerror', e => errores.push(String(e.stack ?? e)));
  page.on('dialog', d => d.accept());
  await page.goto(`${srv.base}/#/verifactu`);
  await page.waitForSelector('.vf-tarjeta[draggable="true"]');
  await page.dragAndDrop('.vf-tarjeta[data-id="v1"]', '.pr-columna[data-fase="auditoria"]');
  await toastCon(page, 'Movida');
  ok(base.db.verifactu_sedes.find(v => v.id === 'v1').fase === 'auditoria' && (await page.textContent('#toast')).includes('Pendiente de la fase anterior: software actual'),
    'mover: arrastrar avanza de fase y avisa de lo que faltaba (sin bloquear)');
  await page.waitForSelector('.vf-mover');
  await page.selectOption('.vf-tarjeta[data-id="v2"] .vf-mover', 'auditoria');
  await page.waitForFunction(() => document.getElementById('toast')?.textContent === 'Movida');
  ok(base.db.verifactu_sedes.find(v => v.id === 'v2').fase === 'auditoria', 'mover: hacia atrás con el selector, sin aviso');
  // Ficha
  await page.goto(`${srv.base}/#/verifactu/v2`);
  await page.waitForSelector('#vf-form');
  await page.check('#vf-checklist [data-ck="sanitizacion_igic"]');
  await page.selectOption('#vf-hw-estado', 'Apto');
  await page.selectOption('#vf-imp-qr', 'true');
  await page.click('#vf-form button[type="submit"]');
  await toastCon(page, 'Guardado');
  const v2 = base.db.verifactu_sedes.find(v => v.id === 'v2');
  ok(v2.checklist.backup_previo && v2.checklist.sanitizacion_igic && v2.hw_estado === 'Apto' && v2.impresora_qr_ok === true, 'ficha: guarda casillas (sin perder las que había) y la auditoría');
  // Cargar sedes con TPV
  await page.waitForSelector('[data-action="vfCargar"]');
  await page.click('[data-action="vfCargar"]');
  await toastCon(page, 'sedes añadidas');
  const v3 = base.db.verifactu_sedes.find(v => v.local_id === 'l3');
  ok(base.db.verifactu_sedes.length === 3 && v3 && v3.tipo_contribuyente === 'Sociedad' && v3.carril === 'compleja' && !base.db.verifactu_sedes.some(v => v.local_id === 'l4'),
    'cargar: solo las sedes con TPV que faltaban; TPV desconocido → compleja, NIF de sociedad → Sociedad');
  await page.waitForFunction(() => document.querySelectorAll('.vf-tarjeta').length === 3);
  await page.screenshot({ path: `${CAPTURAS}/verifactu.png` });
  // Quitar (admin)
  await page.goto(`${srv.base}/#/verifactu/v1`);
  await page.waitForSelector('[data-action="vfQuitar"]');
  await page.click('[data-action="vfQuitar"]');
  await page.waitForFunction(() => location.hash === '#/verifactu');
  ok(!base.db.verifactu_sedes.some(v => v.id === 'v1'), 'quitar: el admin la saca del tablero');
  await ctx.close();

  ok(!errores.length, `sin errores JS${errores.length ? ': ' + errores.join(' | ') : ''}`);
} finally {
  await browser.close();
  srv.parar();
}
if (!fallos()) console.log('\nTodo bien');
process.exit(fallos() ? 1 : 0);
