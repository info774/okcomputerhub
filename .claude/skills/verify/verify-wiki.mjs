// Arnés de la fase 5 (wiki + buscador): árbol de páginas, crear (con vista
// previa SEGURA), editar, subpágina, mover, archivar, historial y restaurar,
// reindexado al guardar; Buscar con respuesta citada, fuentes, estado del
// índice y carpeta de Drive (solo admin). Móvil sin scroll horizontal.
//   npm run build && node .claude/skills/verify/verify-wiki.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS, SB } from './comun.mjs';

const { ok, fallos, sumar } = contador();
const srv = await servidor(4184);
const ahora = new Date().toISOString();
const P1 = 'a1111111-1111-1111-1111-111111111111';
const INICIAL = {
  usuarios: [{ id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true },
             { id: 'u-tito', nombre: 'Tito', email: 'tito@ok.test', rol: 'tecnico', activo: true }],
  areas: [], sync_estado: [], proyectos: [{ id: 'pr1', numero: 5, titulo: 'Fase 5', estado: 'en_curso' }], proyecto_tareas: [],
  paginas: [{ id: P1, titulo: 'Procedimientos', contenido: '# Procedimientos\n\nVer [instalación](#/wiki/x).', padre_id: null, orden: 0, icono: '📘',
    proyecto_id: null, archivada: false, version: 2, updated_at: ahora, created_at: ahora, creado_por: 'u-ana', actualizado_por: 'u-ana' }],
  paginas_versiones: [{ id: 'v1', pagina_id: P1, version: 1, titulo: 'Procedimientos (viejo)', contenido: 'Texto **antiguo**', autor: 'u-tito', created_at: ahora }],
  documentos: [{ id: 'd1', estado: 'indexado' }],
  config: [{ clave: 'drive_carpeta', valor: null }],
};

async function contexto(browser, email, viewport = { width: 1280, height: 900 }) {
  const base = baseMemoria(INICIAL, {});
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport });
  await preparar(ctx, { email, base });
  const fn = [];
  await ctx.route(`${SB}/functions/v1/**`, async route => {
    const nombre = new URL(route.request().url()).pathname.split('/').pop();
    const b = route.request().postDataJSON() ?? {};
    fn.push({ nombre, ...b });
    const r = nombre === 'documentos-preguntar'
      ? { con_claude: true, respuesta: 'El router es un **Mikrotik** [1]. <script>alert(1)</script>', fuentes: [
          { n: 1, titulo: 'Hotel Playa: red', url: '#/wiki/' + P1, fuente: 'wiki', texto: 'Router Mikrotik en el rack' },
          { n: 2, titulo: 'Inventario.pdf', url: 'https://drive.google.com/file/d/1', fuente: 'drive', texto: 'Listado' }] }
      : nombre === 'documentos-indexar' && b.accion === 'estado'
        ? { resumen: { wiki: { indexado: 3 }, drive: { indexado: 10, pendiente: 2, error: 1 } }, fragmentos: 120,
            errores: [{ titulo: 'Roto.pdf', error: 'PDF cifrado' }], drive: { carpeta: null, ultima_ok: null, filas: 0 } }
        : { ok: true };
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(r) });
  });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
  page.on('dialog', d => d.accept());
  return { ctx, page, base, fn, errores };
}
const toastCon = (page, t) => page.waitForFunction(x => document.getElementById('toast')?.textContent.includes(x), t);

const browser = await navegador();
try {
  const A = await contexto(browser, 'ana@ok.test');
  const { page, base, fn } = A;

  // ── Wiki ─────────────────────────────────────────────────────────────────
  await page.goto(`${srv.base}/#/wiki`);
  await page.waitForSelector('.wk-arbol');
  ok((await page.textContent('.wk-arbol')).includes('Procedimientos'), 'wiki: árbol con la página');
  await page.click('.wk-lateral [data-action="wkNueva"]');
  await page.waitForSelector('#wk-titulo');
  await page.fill('#wk-titulo', 'Hotel Playa: red');
  await page.fill('#wk-contenido', '## Red\n\n**Router** Mikrotik\n\n<img src=x onerror=alert(1)>');
  await page.waitForFunction(() => document.getElementById('wk-previa')?.innerHTML.includes('<strong>Router</strong>'));
  ok(await page.locator('#wk-previa img').count() === 0 && (await page.textContent('#wk-previa')).includes('<img'), 'editor: vista previa con markdown y HTML escapado');
  await page.selectOption('#wk-proyecto', 'pr1');
  await page.click('form.wk-editor button[type=submit]');
  await toastCon(page, 'Página creada');
  const nueva = base.db.paginas.find(p => p.titulo === 'Hotel Playa: red');
  ok(nueva && nueva.proyecto_id === 'pr1' && nueva.padre_id === null, 'wiki: página creada con proyecto');
  await page.waitForSelector('.wk-contenido');
  ok(fn.some(f => f.nombre === 'documentos-indexar' && f.accion === 'pagina' && f.id === nueva.id), 'wiki: al guardar se reindexa');
  ok((await page.textContent('.wk-principal')).includes('#5 Fase 5'), 'wiki: enlace al proyecto');

  // Subpágina de Procedimientos
  await page.goto(`${srv.base}/#/wiki/${P1}`);
  await page.waitForSelector('.wk-contenido');
  ok(await page.locator('.wk-contenido a[href="#/wiki/x"]').count() === 1, 'wiki: enlace interno entre páginas');
  await page.click('.wk-principal [data-action="wkNueva"]');
  await page.waitForSelector('#wk-titulo');
  await page.fill('#wk-titulo', 'Instalar TPV');
  await page.fill('#wk-contenido', 'Pasos');
  await page.click('form.wk-editor button[type=submit]');
  await toastCon(page, 'Página creada');
  ok(base.db.paginas.find(p => p.titulo === 'Instalar TPV')?.padre_id === P1, 'wiki: subpágina cuelga de su padre');
  await page.waitForSelector('.wk-migas');
  ok((await page.textContent('.wk-migas')).includes('Procedimientos'), 'wiki: migas con el padre');

  // Mover la nueva dentro de Procedimientos
  await page.goto(`${srv.base}/#/wiki/${nueva.id}`);
  await page.waitForSelector('#wk-padre', { state: 'attached' });
  await page.click('.wk-principal details summary');
  await page.selectOption('#wk-padre', P1);
  await toastCon(page, 'Movida');
  ok(base.db.paginas.find(p => p.id === nueva.id).padre_id === P1, 'wiki: mover a otra página');

  // Editar
  await page.goto(`${srv.base}/#/wiki/${P1}/editar`);
  await page.waitForSelector('#wk-titulo');
  await page.fill('#wk-contenido', 'Nuevo texto');
  await page.click('form.wk-editor button[type=submit]');
  await toastCon(page, 'Guardada');
  ok(base.db.paginas.find(p => p.id === P1).contenido === 'Nuevo texto', 'wiki: editar guarda');

  // Historial y restaurar
  await page.goto(`${srv.base}/#/wiki/${P1}/historial`);
  await page.waitForSelector('[data-action="wkRestaurar"]', { state: 'attached' });
  await page.click('.wk-principal details summary');
  await page.click('[data-action="wkRestaurar"][data-p0="1"]');
  await toastCon(page, 'Restaurada');
  const p1 = base.db.paginas.find(p => p.id === P1);
  ok(p1.contenido === 'Texto **antiguo**' && p1.titulo === 'Procedimientos (viejo)', 'historial: restaurar una versión');

  // Archivar
  await page.waitForSelector('.wk-contenido');
  await page.click('.wk-principal details summary');
  await page.click('[data-action="wkArchivar"][data-p0="1"]');
  await toastCon(page, 'Archivada');
  ok(base.db.paginas.find(p => p.id === P1).archivada === true, 'wiki: archivar');
  await page.screenshot({ path: `${CAPTURAS}/wiki.png`, fullPage: true });

  // ── Buscar ───────────────────────────────────────────────────────────────
  await page.goto(`${srv.base}/#/buscar`);
  await page.waitForSelector('#bu-q');
  await page.waitForSelector('#bu-carpeta');
  ok((await page.textContent('#bu-estado')).includes('120 trozos') && (await page.textContent('#bu-estado')).includes('PDF cifrado'), 'buscar: estado del índice y errores');
  await page.fill('#bu-q', '¿Qué router tiene el Hotel Playa?');
  await page.click('form.bu-caja button[type=submit]');
  await page.waitForSelector('.bu-fuentes');
  ok(fn.some(f => f.nombre === 'documentos-preguntar' && f.pregunta.includes('router')), 'buscar: la pregunta va a documentos-preguntar');
  ok(await page.locator('.bu-respuesta script').count() === 0 && (await page.locator('.bu-respuesta .md strong').textContent()) === 'Mikrotik', 'buscar: respuesta en markdown seguro');
  ok(await page.locator('a.bu-cita[href="#bu-fuente-1"]').count() === 1, 'buscar: la cita [1] enlaza a su fuente');
  ok(await page.locator('.bu-fuentes a[target="_blank"][href^="https://drive"]').count() === 1, 'buscar: fuente de Drive abre fuera');
  await page.fill('#bu-carpeta', 'https://drive.google.com/drive/folders/1AbCdEfGhIjK_lm?usp=sharing');
  await page.click('form[data-on-submit="buCarpeta"] button[type=submit]');
  await toastCon(page, 'Carpeta guardada');
  ok(base.db.config.find(c => c.clave === 'drive_carpeta').valor === '1AbCdEfGhIjK_lm', 'buscar: la carpeta se guarda por su id');
  await page.screenshot({ path: `${CAPTURAS}/buscar.png`, fullPage: true });
  ok(A.errores.length === 0, `admin: sin errores JS${A.errores.length ? ': ' + A.errores.join(' | ') : ''}`);
  await A.ctx.close();

  // ── Técnico: no ve la carpeta de Drive ───────────────────────────────────
  const T = await contexto(browser, 'tito@ok.test');
  await T.page.goto(`${srv.base}/#/buscar`);
  await T.page.waitForSelector('#bu-estado table');
  ok(await T.page.locator('#bu-carpeta').count() === 0, 'técnico: sin ajuste de Drive');
  ok(T.errores.length === 0, 'técnico: sin errores JS');
  await T.ctx.close();

  // ── Móvil ────────────────────────────────────────────────────────────────
  const M = await contexto(browser, 'ana@ok.test', { width: 390, height: 844 });
  for (const [ruta, sel] of [['wiki', '.wk-arbol'], [`wiki/${P1}`, '.wk-contenido'], [`wiki/${P1}/editar`, '#wk-contenido'], ['buscar', '#bu-estado table']]) {
    await M.page.goto(`${srv.base}/#/${ruta}`);
    await M.page.waitForSelector(sel);
    const ancho = await M.page.evaluate(() => document.documentElement.scrollWidth);
    ok(ancho <= 390, `móvil ${ruta}: sin scroll horizontal (${ancho}px)`);
  }
  ok(M.errores.length === 0, 'móvil: sin errores JS');
  await M.ctx.close();
} catch (e) { console.error('✗ excepción:', e); sumar(); }
finally { await browser.close(); srv.parar(); }
console.log(fallos() ? `\n${fallos()} fallo(s)` : '\nTodo bien');
process.exit(fallos() ? 1 : 0);
