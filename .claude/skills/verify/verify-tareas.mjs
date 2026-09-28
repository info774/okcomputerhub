// Arnés de Tareas (#/tareas): filtros de la app (pendientes, hoy, vencidas,
// alta, en progreso, archivadas), por persona («Mis tareas», sin asignar),
// lista y tablero, buscador y ficha con lo que enlaza; solo lectura.
// Sobre comun.mjs (PostgREST en memoria): nunca contra datos reales.
//
//   npm run build && node .claude/skills/verify/verify-tareas.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS } from './comun.mjs';

const PUERTO = 4193;
const { ok, fallos, sumar } = contador();
const dia = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };

const FIX = {
  usuarios: [{ id: 'u-fran', nombre: 'Fran Admin', email: 'admin@ok.test', rol: 'admin', activo: true }],
  sync_estado: [], config: [], clientes_crm: [],
  areas: [{ area: 'tareas', tablas: ['tareas'], dueno: 'app' }],
  clientes: [{ id: 'c1', nombre: 'Polinesia Restaurante', activo: true }],
  locales: [{ id: 'l1', nombre: 'Polinesia · Playa del Duque', cliente_id: 'c1', activo: true }],
  contactos: [{ id: 'p1', nombre: 'Ana Encargada', telefono: '611222333', activo: true }],
  trabajos: [{ id: 'tr1', numero: 331, titulo: 'Instalar TPV nuevo' }],
  tickets: [], oportunidades: [],
  tareas: [
    { id: 'a1', numero: 41, titulo: 'Llamar a Polinesia por el TPV', estado: 'pendiente', prioridad: 'alta', fecha_vencimiento: dia(0), hora_inicio: '10:00:00', tecnico_id: 'Fran', cliente_id: 'c1', local_id: 'l1', contacto_id: 'p1', trabajo_id: 'tr1', descripcion: 'Confirmar el día de la instalación.', recurrencia: 'ninguna', created_at: dia(-2) },
    { id: 'a2', numero: 42, titulo: 'Pedir cajones portamonedas', estado: 'pendiente', prioridad: 'media', fecha_vencimiento: dia(-3), tecnico_id: 'Matteo Monastero', recurrencia: 'ninguna', created_at: dia(-5) },
    { id: 'a3', numero: 43, titulo: 'Revisar copias de seguridad', estado: 'en_progreso', prioridad: 'media', fecha_vencimiento: dia(4), tecnico_id: null, recurrencia: 'semanal', created_at: dia(-9) },
    { id: 'a4', numero: 44, titulo: 'Configurar router', estado: 'completada', prioridad: 'baja', fecha_vencimiento: dia(-1), tecnico_id: 'Fran', recurrencia: 'ninguna', created_at: dia(-9) },
    { id: 'a5', numero: 45, titulo: 'Tarea vieja', estado: 'archivada', prioridad: 'media', tecnico_id: 'Fran', recurrencia: 'ninguna', created_at: dia(-90) },
  ],
};

const srv = await servidor(PUERTO);
const browser = await navegador();
const filas = page => page.$$eval('#ta-tabla tbody tr', trs => trs.map(t => t.textContent.replace(/\s+/g, ' ').trim()));
const cuantas = (page, n) => page.waitForFunction(k => document.querySelectorAll('#ta-tabla tbody tr:not(:has(.vacio))').length === k, n);

try {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  const base = baseMemoria(FIX, { clases_clientes: () => [], linea_tiempo: () => [] });
  await preparar(ctx, { email: 'admin@ok.test', base });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));

  await page.goto(`${srv.base}/#/inicio`);
  await page.waitForSelector('#menu .menu-item');
  const enlace = await page.$('#menu a[href="#/tareas"]');
  ok(!!enlace && !(await enlace.getAttribute('target')), 'Tareas es pantalla del hub (ya no abre la app)');
  await page.goto(`${srv.base}/#/tareas`);
  await page.waitForSelector('#ta-tabla');
  await cuantas(page, 3);
  let fs = await filas(page);
  ok(fs[0].includes('#42') && fs[1].includes('#41') && fs[2].includes('#43'), 'por defecto: pendientes, ordenadas por vencimiento');
  ok(fs[2].includes('Sin asignar') && fs[2].includes('🔁'), 'sin asignar y recurrente, marcados');
  ok(!!(await page.$('.aviso.area-app')), 'aviso de solo lectura (el área es de la app)');
  await page.screenshot({ path: `${CAPTURAS}/tareas-lista.png` });

  for (const [k, n, txt, msg] of [['hoy', 1, '#41', 'Hoy'], ['vencidas', 1, '#42', 'Vencidas'], ['alta', 1, '#41', 'Alta prioridad'], ['en_progreso', 1, '#43', 'En progreso'], ['', 4, '#44', 'Todas (sin archivadas)']]) {
    await page.click(`[data-action="taFiltro"][data-p0="${k}"]`);
    await cuantas(page, n);
    fs = await filas(page);
    ok(fs.some(f => f.includes(txt)) && !fs.some(f => f.includes('#45')), `filtro ${msg}`);
  }
  await page.click('[data-action="taFiltro"][data-p0="archivada"]');
  await cuantas(page, 1);
  ok((await filas(page))[0].includes('#45'), 'filtro Archivadas');
  await page.click('[data-action="taFiltro"][data-p0="pendientes"]');
  await cuantas(page, 3);
  await page.selectOption('#ta-persona', '__mias');
  await cuantas(page, 1);
  ok((await filas(page))[0].includes('#41'), '«Mis tareas» (Fran por nombre de pila)');
  await page.selectOption('#ta-persona', '__sin');
  await cuantas(page, 1);
  ok((await filas(page))[0].includes('#43'), '«Sin asignar»');
  await page.selectOption('#ta-persona', 'Matteo Monastero');
  await cuantas(page, 1);
  ok((await filas(page))[0].includes('#42'), 'por persona');
  await page.selectOption('#ta-persona', '');
  await cuantas(page, 3);
  await page.fill('#ta-filtro', 'polinesia');
  await cuantas(page, 1);
  ok((await filas(page))[0].includes('#41'), 'buscar por cliente');
  await page.fill('#ta-filtro', '');
  await cuantas(page, 3);

  await page.click('[data-action="taVista"][data-p0="kanban"]');
  await page.waitForSelector('#ta-kanban');
  const cols = await page.$$eval('#ta-kanban .pr-columna', cs => cs.map(c => c.querySelectorAll('.pr-tarjeta').length));
  ok(cols.join(',') === '2,1,0', `tablero por estado (${cols.join(',')})`);
  await page.screenshot({ path: `${CAPTURAS}/tareas-tablero.png` });
  await page.click('#ta-kanban .pr-tarjeta:has-text("#41")');
  await page.waitForSelector('.me-grid');
  ok(await page.evaluate(() => location.hash) === '#/tareas/a1', 'la tarjeta abre la ficha');
  const ficha = await page.textContent('#pantalla');
  ok(ficha.includes('Confirmar el día') && ficha.includes('10:00'), 'ficha con detalle y hora');
  for (const h of ['#/clientes/c1', '#/sitios/l1', '#/contactos/p1', '#/trabajos/tr1']) ok(!!(await page.$(`.me-grid a[href="${h}"]`)), `enlaza a ${h}`);
  await page.screenshot({ path: `${CAPTURAS}/tareas-ficha.png` });
  await page.goto(`${srv.base}/#/tareas`);
  await page.waitForSelector('#ta-kanban');
  ok(true, 'la vista tablero se recuerda');

  ok(base.reg.escrituras.filter(e => e.metodo !== 'RPC').length === 0, 'Tareas no escribe nada');
  ok(base.reg.rest.every(r => r.perfil === 'hub'), 'todas las peticiones con Accept-Profile: hub');
  const inline = await page.evaluate(() => [...document.querySelectorAll('*')].filter(e => [...e.attributes].some(a => /^on[a-z]+$/.test(a.name))).length);
  ok(inline === 0, 'ningún on*= inline');
  ok(errores.length === 0, `sin errores JS${errores.length ? ': ' + errores.join(' | ') : ''}`);
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
