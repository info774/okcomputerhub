// Arnés de «Traer de Zoho» (paridad de sync-zoho, sync-zoho-estimates y
// sync-zoho-items de la app, función `zoho-sync`): con el área de la app el
// botón no sale en Clientes, Presupuestos ni Catálogo; con el corte sale y
// pide página a página hasta que Zoho dice que no hay más, y lo cuenta.
//   npm run build && node .claude/skills/verify/verify-zoho-sync.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS, SB } from './comun.mjs';

const { ok, fallos } = contador();
const srv = await servidor(4214);
const FIX = dueno => ({
  usuarios: [{ id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true }],
  areas: [
    { area: 'clientes', dueno, tablas: ['clientes', 'locales', 'contactos'] },
    { area: 'presupuestos', dueno, tablas: ['presupuestos', 'presupuesto_plantillas'] },
    { area: 'inventario', dueno, tablas: ['catalogo', 'furgonetas', 'furgoneta_inventario', 'furgoneta_movimientos'] },
  ],
  sync_estado: [], config: [], proyectos: [], clientes_crm: [], actividades: [], trabajos: [], tickets: [], oportunidades: [], locales: [], contactos: [],
  documento_lineas: [], furgonetas: [], furgoneta_inventario: [], conocimiento: [],
  clientes: [{ id: 'c1', nombre: 'Hotel Playa SL', nif: 'B1', telefono: null, email: null, estado: 'activo', activo: true, zoho_id: '9001', tipo: 'empresa' }],
  presupuestos: [{ id: 'p1', titulo: 'Cámaras', estado: 'Enviado', total: 100, cliente_id: 'c1', fecha: '2026-10-01', created_at: '2026-10-01T10:00:00Z', numero_presupuesto: 'EST-1', zoho_estimate_id: 'z1', tecnico_id: null }],
  catalogo: [{ id: 'k1', nombre: 'Router 4G', categoria: 'Hardware', precio: 120, unidad: 'ud', referencia: 'R4G', descripcion: null, activo: true, zoho_item_id: 'z1' }],
});
const RPC = { clases_clientes: () => [], linea_tiempo: () => [] };

async function contexto(browser, dueno) {
  const base = baseMemoria(FIX(dueno), RPC);
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1400, height: 950 } });
  await preparar(ctx, { email: 'ana@ok.test', base });
  const llamadas = [];
  await ctx.route(`${SB}/functions/v1/zoho-sync`, route => {
    const b = JSON.parse(route.request().postData() || '{}');
    llamadas.push(b);
    // Clientes: dos páginas; lo demás, una.
    const r = b.accion === 'clientes'
      ? (b.page === 1 ? { success: true, imported: 2, updated: 1, hasMore: true } : { success: true, imported: 1, updated: 0, hasMore: false })
      : { success: true, imported: 0, updated: 1, hasMore: false };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r) });
  });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
  return { ctx, page, llamadas, errores };
}
const RUTAS = [['#/clientes', '#cl-filtro'], ['#/presupuestos', '#pp-filtro'], ['#/inventario/catalogo', '#cat-q']];

const browser = await navegador();
try {
  // ── Con el área de la app: lo trae la app ───────────────────────────────
  const A = await contexto(browser, 'app');
  for (const [ruta, sel] of RUTAS) {
    await A.page.goto(`${srv.base}/${ruta}`);
    await A.page.waitForSelector(sel);
    ok(await A.page.locator('[data-action="traerDeZoho"]').count() === 0, `sin corte: ${ruta} sin «Traer de Zoho»`);
  }
  ok(!A.llamadas.length && !A.errores.length, `sin corte: no se llama a Zoho y sin errores${A.errores.length ? ': ' + A.errores.join(' | ') : ''}`);
  await A.ctx.close();

  // ── Con el corte: el botón trae página a página ─────────────────────────
  const B = await contexto(browser, 'hub');
  const { page, llamadas } = B;
  await page.goto(`${srv.base}/#/clientes`);
  await page.waitForSelector('[data-action="traerDeZoho"][data-p0="clientes"]');
  await page.click('[data-action="traerDeZoho"][data-p0="clientes"]');
  await page.waitForFunction(() => document.body.textContent.includes('Zoho: 3 nuevos y 1 actualizado'));
  ok(llamadas.length === 2 && llamadas.every(l => l.accion === 'clientes') && llamadas[0].page === 1 && llamadas[1].page === 2, 'clientes: pide hasta que no hay más páginas y cuenta nuevos y actualizados');
  await page.screenshot({ path: `${CAPTURAS}/zoho-sync-clientes.png` });

  await page.goto(`${srv.base}/#/presupuestos`);
  await page.waitForSelector('[data-action="traerDeZoho"][data-p0="presupuestos"]');
  await page.click('[data-action="traerDeZoho"][data-p0="presupuestos"]');
  await page.waitForFunction(() => document.body.textContent.includes('Zoho: 0 nuevos y 1 actualizado'));
  ok(llamadas.at(-1).accion === 'presupuestos' && llamadas.at(-1).page === 1, 'presupuestos: una página');

  await page.goto(`${srv.base}/#/inventario/catalogo`);
  await page.waitForSelector('[data-action="traerDeZoho"][data-p0="articulos"]');
  await page.click('[data-action="traerDeZoho"][data-p0="articulos"]');
  await page.waitForFunction(() => document.body.textContent.split('Zoho: 0 nuevos y 1 actualizado').length > 1 && location.hash.includes('catalogo'));
  ok(llamadas.at(-1).accion === 'articulos', 'catálogo: trae los artículos');
  ok(!B.errores.length, `con corte: sin errores JS${B.errores.length ? ': ' + B.errores.join(' | ') : ''}`);
  await B.ctx.close();
} finally {
  await browser.close();
  srv.parar();
}
if (!fallos()) console.log('\nTodo bien');
process.exit(fallos() ? 1 : 0);
