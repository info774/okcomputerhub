// Arnés de «Fichas duplicadas» (fusionar clientes, contactos y sedes; idea de
// merge_contacts de Atomic CRM): lista por tipo con motivos, la que se queda
// marcada por defecto, comparar (qué pasa, campos, avisos y bloqueos), botón
// apagado si algo lo impide, fusionar con confirmación, paso de Zoho, «No son
// la misma», «Hecho en Zoho», buscar con qué fusionar desde una ficha, el botón
// en la ficha solo para admins y móvil sin desborde.
//   npm run build && node .claude/skills/verify/verify-duplicados.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS } from './comun.mjs';

const { ok, fallos } = contador();
const srv = await servidor(4231);
const C1 = '11111111-1111-4111-8111-111111111111', C2 = '22222222-2222-4222-8222-222222222222', C3 = '33333333-3333-4333-8333-333333333333';
const FIX = () => ({
  usuarios: [
    { id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true },
    { id: 'u-tito', nombre: 'Tito', email: 'tito@ok.test', rol: 'tecnico', activo: true },
  ],
  areas: [{ area: 'clientes', dueno: 'app', tablas: ['clientes', 'locales', 'contactos'] }],
  sync_estado: [], config: [], clientes_crm: [], actividades: [], trabajos: [], tickets: [], oportunidades: [], presupuestos: [], no_duplicados: [],
  clientes: [
    { id: C1, nombre: 'Bar Fusión, S.L.', nif: 'B12345678', telefono: '922111222', email: 'bar@f.test', activo: true, zoho_id: 'ZA', plan: 'Sin mantenimiento', created_at: '2024-01-01T10:00:00Z' },
    { id: C2, nombre: 'BAR FUSION SL', nif: 'B-12345678', telefono: null, email: 'otro@f.test', activo: true, zoho_id: 'ZB', plan: 'Sin mantenimiento', created_at: '2025-05-01T10:00:00Z' },
    { id: C3, nombre: 'Hotel Playa', nif: 'B99999999', telefono: null, email: null, activo: true, zoho_id: null, plan: 'Sin mantenimiento', created_at: '2025-01-01T10:00:00Z' },
  ],
  contactos: [], locales: [],
  fusiones: [{ id: 'f-1', created_at: '2026-10-09T10:00:00Z', queda_id: C3, queda_nombre: 'Hotel Playa', sale_nombre: 'Hotel Playa SL', zoho_queda: 'Z9', zoho_sale: 'Z8', zoho_hecho_at: null }],
});

const vista = (db, b, bloqueos) => ({
  probar: true,
  queda: db.clientes.find(c => c.id === b.p_queda), sale: db.clientes.find(c => c.id === b.p_sale),
  campos: { notas: [null, '— De «BAR FUSION SL»:\nOtro correo: otro@f.test'] },
  movidas: { trabajos: 3, contactos: 1 }, descartadas: { clientes_crm: 1 },
  bloqueos, avisos: ['Los dos tienen contacto en Zoho Books: después hay que fusionarlos allí (el hub lo deja apuntado)'],
  zoho: { queda: 'ZA', sale: 'ZB' },
});

async function contexto(browser, { email = 'ana@ok.test', bloqueos = [], ancho = 1400 } = {}) {
  const fusionar = [];
  const base = baseMemoria(FIX(), {
    duplicados: b => b.p_tipo === 'cliente' ? [{ ids: [C1, C2], motivos: ['nif', 'nombre'] }] : [],
    duplicados_resumen: () => ({ cliente: 1, contacto: 0, sede: 0 }),
    fusionar: (b, db) => {
      fusionar.push(b);
      if (b.p_probar) return vista(db, b, bloqueos);
      if (bloqueos.length) throw new Error('No se puede fusionar: ' + bloqueos.join('; '));
      db.clientes = db.clientes.filter(c => c.id !== b.p_sale);
      return { probar: false, queda_id: b.p_queda, movidas: { trabajos: 3, contactos: 1 }, descartadas: {}, campos: {}, avisos: [], zoho: { queda: 'ZA', sale: 'ZB' } };
    },
    clases_clientes: () => [], linea_tiempo: () => [],
  });
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: ancho, height: 950 } });
  await preparar(ctx, { email, base });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
  page.on('dialog', d => d.accept());
  return { ctx, page, base, fusionar, errores };
}

const browser = await navegador();
try {
  // ── Lista, comparar con bloqueos (áreas de la app) ──────────────────────
  const A = await contexto(browser, { bloqueos: ['clientes se sigue llevando en la app', 'trabajos (3 filas) se sigue llevando en la app'] });
  let { page } = A;
  await page.goto(`${srv.base}/#/duplicados`);
  await page.waitForSelector('.du-grupo');
  const texto = await page.locator('#du-lista').textContent();
  ok(texto.includes('Bar Fusión, S.L.') && texto.includes('BAR FUSION SL') && texto.includes('Mismo NIF') && texto.includes('Mismo nombre'),
    'lista: el grupo con sus dos fichas y por qué se parecen');
  ok((await page.locator('.du-pestanas').textContent()).replace(/\s+/g, ' ').includes('Clientes 1'), 'lista: las pestañas cuentan los grupos');
  ok(await page.locator(`input[name="du-q-0"][value="${C1}"]`).isChecked(), 'lista: se queda por defecto la más completa (con teléfono, la más antigua)');
  ok((await page.locator('#du-zoho').textContent()).includes('Hotel Playa SL'), 'lista: lo que falta fusionar en Zoho sale arriba');
  await page.screenshot({ path: `${CAPTURAS}/duplicados-lista.png`, fullPage: true });

  await page.click(`[data-action="duComparar"][data-p1="${C1}"]`);
  await page.waitForTimeout(150);
  ok(!(await page.evaluate(() => location.hash)).includes(C2), 'lista: «Fusionar» en la que se queda no hace nada (lo dice)');
  await page.click(`[data-action="duComparar"][data-p1="${C2}"]`);
  await page.waitForSelector('.du-lados');
  ok((await page.evaluate(() => location.hash)) === `#/duplicados/cliente/${C1}/${C2}`, 'comparar: la marcada se queda y la pulsada desaparece');
  const cmp = await page.locator('#du-cmp').textContent();
  ok(cmp.includes('3 trabajos') && cmp.includes('1 contacto') && cmp.includes('1 ficha de CRM') && cmp.includes('Otro correo'),
    'comparar: qué pasa, qué se descarta y cómo queda la ficha');
  ok(cmp.includes('Ahora no se puede fusionar') && await page.locator('[data-action="duFusionar"]').isDisabled(), 'comparar: con bloqueos el botón está apagado y dice por qué');
  ok(A.fusionar.length === 1 && A.fusionar[0].p_probar === true, 'comparar: solo pregunta (probar)');
  await page.screenshot({ path: `${CAPTURAS}/duplicados-comparar-bloqueado.png`, fullPage: true });

  // «No son la misma» y «Hecho en Zoho».
  await page.goto(`${srv.base}/#/duplicados/cliente`);
  await page.waitForSelector('.du-grupo');
  await page.click('[data-action="duNoSon"]');
  await page.waitForFunction(() => !document.querySelector('.du-grupo'));
  const nd = A.base.db.no_duplicados;
  ok(nd.length === 1 && nd[0].tipo === 'cliente' && nd[0].a === C1 && nd[0].b === C2, '«No son la misma»: apunta la pareja (a < b) y el grupo se va');
  await page.click('[data-action="duZohoHecho"]');
  await page.waitForFunction(() => !document.querySelector('[data-action="duZohoHecho"]'));
  ok(!!A.base.db.fusiones[0].zoho_hecho_at, '«Hecho en Zoho»: queda apuntado');

  // Buscar con qué fusionar desde una ficha.
  await page.goto(`${srv.base}/#/clientes/${C3}`);
  await page.waitForSelector('.tarjeta-cab h2');
  ok(await page.locator(`a[href="#/duplicados/cliente/${C3}"]`).count() === 1, 'ficha: el admin ve «Fusionar con…»');
  await page.goto(`${srv.base}/#/duplicados/cliente/${C1}`);
  await page.waitForSelector('#du-otra');
  await page.fill('#du-otra', 'fusion');
  await page.waitForSelector(`a[href="#/duplicados/cliente/${C1}/${C2}"]`);
  ok(await page.locator(`#du-otras a[href="#/clientes/${C1}"]`).count() === 0, 'elegir: encuentra la repetida y no se ofrece a sí misma');
  ok(!A.errores.length, `sin errores JS${A.errores.length ? ': ' + A.errores.join(' | ') : ''}`);
  await A.ctx.close();

  // ── Fusionar de verdad (áreas del hub) y paso de Zoho ──────────────────
  const B = await contexto(browser);
  page = B.page;
  await page.goto(`${srv.base}/#/duplicados/cliente/${C1}/${C2}`);
  await page.waitForSelector('[data-action="duFusionar"]:not([disabled])');
  await page.click('[data-action="duFusionar"]');
  await page.waitForFunction(() => document.body.textContent.includes('Fusionados en el hub'));
  ok(B.fusionar.at(-1).p_probar === false && B.fusionar.at(-1).p_queda === C1 && B.fusionar.at(-1).p_sale === C2, 'fusionar: confirma y llama sin probar');
  ok(!B.base.db.clientes.some(c => c.id === C2) && (await page.locator('#du-cmp, .tarjeta').first().textContent()).length > 0
    && await page.locator('a[href*="books.zoho.eu"][href$="ZB"]').count() === 1, 'fusionar: la otra se borra y queda el paso de Zoho con los dos enlaces');
  await page.screenshot({ path: `${CAPTURAS}/duplicados-zoho.png`, fullPage: true });
  ok(!B.errores.length, `fusionar: sin errores JS${B.errores.length ? ': ' + B.errores.join(' | ') : ''}`);
  await B.ctx.close();

  // ── Un técnico ni la ve ni tiene el botón ──────────────────────────────
  const T = await contexto(browser, { email: 'tito@ok.test' });
  await T.page.goto(`${srv.base}/#/clientes/${C3}`);
  await T.page.waitForSelector('.tarjeta-cab h2');
  ok(await T.page.locator('a[href^="#/duplicados"]').count() === 0, 'técnico: sin «Fusionar con…» ni la pantalla en el menú');
  await T.page.goto(`${srv.base}/#/duplicados`);
  await T.page.waitForTimeout(400);
  ok(await T.page.locator('.du-grupo').count() === 0, 'técnico: #/duplicados no se abre');
  await T.ctx.close();

  // ── Móvil ──────────────────────────────────────────────────────────────
  const M = await contexto(browser, { ancho: 390, bloqueos: [] });
  await M.page.goto(`${srv.base}/#/duplicados/cliente/${C1}/${C2}`);
  await M.page.waitForSelector('.du-lados');
  const desborda = await M.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(desborda <= 0, `móvil: comparar sin desborde horizontal (${desborda} px)`);
  await M.page.screenshot({ path: `${CAPTURAS}/duplicados-movil.png`, fullPage: true });
  await M.page.goto(`${srv.base}/#/duplicados`);
  await M.page.waitForSelector('.du-grupo');
  const desborda2 = await M.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(desborda2 <= 0, `móvil: lista sin desborde horizontal (${desborda2} px)`);
  await M.ctx.close();
} finally {
  await browser.close();
  srv.parar();
}
if (!fallos()) console.log('\nTodo bien');
process.exit(fallos() ? 1 : 0);
