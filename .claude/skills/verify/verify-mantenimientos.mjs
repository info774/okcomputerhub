// Arnés de Mantenimientos (#/mantenimientos): cartera por sede con quién cobra
// (Stripe, esperando primer pago, Zoho vieja —una Zoho cancelada no cuenta—,
// sin domiciliar), cobro torcido y en curso, la cuota NETA (el bruto heredado
// de Zoho sin el IGIC) solo para admins, barras por plan que filtran, y que
// la fila lleve a la ficha del sitio; un técnico no ve euros. Solo lectura.
//
//   npm run build && node .claude/skills/verify/verify-mantenimientos.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS } from './comun.mjs';

const PUERTO = 4195;
const { ok, fallos, sumar } = contador();
const dia = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString(); };

const FIX = {
  usuarios: [
    { id: 'u-fran', nombre: 'Fran Admin', email: 'admin@ok.test', rol: 'admin', activo: true },
    { id: 'u-mat', nombre: 'Matteo Monastero', email: 'tec@ok.test', rol: 'tecnico', activo: true },
  ],
  sync_estado: [], config: [], clientes_crm: [], contactos: [], trabajos: [], tickets: [],
  areas: [{ area: 'clientes', tablas: ['clientes', 'locales', 'contactos'], dueno: 'app' }],
  clientes: [{ id: 'c1', nombre: 'Polinesia Restaurante', activo: true }, { id: 'c2', nombre: 'Bananas Cafetería', activo: true }],
  locales: [
    { id: 'l1', nombre: 'Polinesia · Playa del Duque', cliente_id: 'c1', activo: true, plan: 'Premium', importe_mantenimiento: 79, frecuencia_pago: 'Mensual',
      estado_pago: 'Al corriente', stripe_subscription_id: 'sub_1', stripe_mandato_estado: 'activo', proxima_cuota: '2026-11-01' },
    { id: 'l2', nombre: 'Bananas Cafetería', cliente_id: 'c2', activo: true, plan: 'Silver', importe_mantenimiento: 42.8, importe_incluye_impuesto: true,
      estado_pago: 'Último aviso', zoho_subscription_id: 'z1', zoho_estado: 'live', zoho_deuda: 85.6 },
    { id: 'l3', nombre: 'Polinesia · Los Cristianos', cliente_id: 'c1', activo: true, plan: 'Silver', importe_mantenimiento: 39, frecuencia_pago: 'Anual',
      estado_pago: 'Al corriente', stripe_subscription_id: 'sub_3', stripe_mandato_estado: 'pendiente' },
    { id: 'l4', nombre: 'Ferretería Sur', cliente_id: null, activo: true, plan: 'Basic', importe_mantenimiento: 25, estado_pago: 'Al corriente',
      zoho_subscription_id: 'z4', zoho_estado: 'cancelled' },
    { id: 'l5', nombre: 'Clínica Norte', cliente_id: null, activo: true, plan: 'Premium', importe_mantenimiento: 79, estado_pago: 'Al corriente',
      stripe_subscription_id: 'sub_5', stripe_mandato_estado: 'activo', stripe_cobro_en_curso_at: dia(-12) },
    { id: 'l6', nombre: 'Bar sin plan', activo: true, plan: 'Sin mantenimiento' },
    { id: 'l7', nombre: 'Bar sin nada', activo: true, plan: null },
    { id: 'l8', nombre: 'Sede de baja', activo: false, plan: 'Premium', importe_mantenimiento: 79 },
  ],
};

const srv = await servidor(PUERTO);
const browser = await navegador();
const filas = page => page.$$eval('#mt-tabla tbody tr', trs => trs.map(t => t.textContent.replace(/\s+/g, ' ').trim()));
const cuantas = (page, n) => page.waitForFunction(k => document.querySelectorAll('#mt-tabla tbody tr:not(:has(.vacio))').length === k, n);
const fila = (fs, txt) => fs.find(f => f.includes(txt)) ?? '';

try {
  // ── Admin ─────────────────────────────────────────────────────────────────
  let ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  const base = baseMemoria(FIX, { clases_clientes: () => [], linea_tiempo: () => [] });
  await preparar(ctx, { email: 'admin@ok.test', base });
  let page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));

  await page.goto(`${srv.base}/#/inicio`);
  await page.waitForSelector('#menu .menu-item');
  const enlace = await page.$('#menu a[href="#/mantenimientos"]');
  ok(!!enlace && !(await enlace.getAttribute('target')), 'Mantenimientos es pantalla del hub (ya no abre la app)');
  await page.goto(`${srv.base}/#/mantenimientos`);
  await page.waitForSelector('#mt-tabla');
  await cuantas(page, 5);
  let fs = await filas(page);
  ok(!fs.some(f => /sin plan|sin nada|de baja/.test(f)), 'solo sedes activas con plan');
  ok(fila(fs, 'Playa del Duque').includes('Stripe') && fila(fs, 'Los Cristianos').includes('Esperando el primer pago'), 'Stripe con mandato / esperando el primer pago');
  ok(fila(fs, 'Bananas').includes('Zoho (cartera vieja)') && fila(fs, 'Ferretería').includes('Sin domiciliar'), 'Zoho viva cuenta; Zoho cancelada = sin domiciliar');
  ok(fila(fs, 'Bananas').includes('40,00 €') && fila(fs, 'Bananas').includes('bruto Zoho'), 'el bruto heredado de Zoho se enseña neto (42,80 → 40,00)');
  ok(fila(fs, 'Clínica').includes('Cobro en curso · 12 d'), 'cobro SEPA en curso con sus días');
  ok(fila(fs, 'Los Cristianos').includes('Anual'), 'frecuencia no mensual a la vista');
  ok(!!(await page.$('.aviso.area-app')), 'aviso de solo lectura');
  const cifras = await page.$$eval('.pp-cifras .di-cifra', cs => cs.map(c => c.textContent.replace(/\s+/g, ' ').replace(/\./g, '').trim()));
  ok(cifras[0].includes('5') && cifras[0].includes('3 planes'), `sedes y planes (${cifras[0]})`);
  ok(cifras[1].includes('262 €'), `al mes neto: 79+40+39+25+79 (${cifras[1]})`);
  ok(cifras[2].startsWith('Cobro torcido1'), `cobro torcido (${cifras[2]})`);
  ok(cifras[3].includes('Sin cobrar todavía2') && cifras[3].includes('86 €'), `sin cobrar y deuda Zoho (${cifras[3]})`);
  const barras = await page.$$eval('#mt-barras tr', trs => trs.map(t => t.querySelector('th').textContent));
  ok(barras.join(',') === 'Premium,Silver,Basic', `barras por plan, de más a menos sedes (${barras.join(',')})`);
  await page.screenshot({ path: `${CAPTURAS}/mantenimientos-admin.png` });

  await page.click('#mt-barras tr:has-text("Silver")');
  await cuantas(page, 2);
  ok((await filas(page)).every(f => f.includes('Silver')), 'la barra filtra por plan');
  await page.click('#mt-barras tr:has-text("Silver")');
  await cuantas(page, 5);
  ok(true, 'pulsarla otra vez quita el filtro');
  for (const [k, n, txt, msg] of [['torcido', 1, 'Bananas', 'Cobro torcido'], ['en_curso', 1, 'Clínica', 'Cobro en curso'], ['nadie', 1, 'Ferretería', 'Sin domiciliar'],
    ['espera', 1, 'Los Cristianos', 'Esperando pago'], ['stripe', 2, 'Playa del Duque', 'Stripe'], ['zoho', 1, 'Bananas', 'Zoho'], ['', 5, 'Bananas', 'Todas']]) {
    await page.click(`.chip-boton[data-action="mtFiltro"][data-p0="${k}"]`);
    await cuantas(page, n);
    ok((await filas(page)).some(f => f.includes(txt)), `filtro ${msg}`);
  }
  await page.fill('#mt-filtro', 'polinesia');
  await cuantas(page, 2);
  await page.fill('#mt-filtro', '');
  await cuantas(page, 5);
  await page.click('#mt-tabla tbody tr:has-text("Bananas")');
  await page.waitForFunction(() => location.hash === '#/sitios/l2');
  ok(true, 'la fila abre la ficha del sitio');
  ok(base.reg.escrituras.filter(e => e.metodo !== 'RPC').length === 0, 'no escribe nada');
  ok(base.reg.rest.every(r => r.perfil === 'hub'), 'todas las peticiones con Accept-Profile: hub');
  ok(errores.length === 0, `sin errores JS${errores.length ? ': ' + errores.join(' | ') : ''}`);
  await ctx.close();

  // ── Técnico: ni euros ni deuda ───────────────────────────────────────────
  ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 800 } });
  await preparar(ctx, { email: 'tec@ok.test', base: baseMemoria(FIX, { clases_clientes: () => [], linea_tiempo: () => [] }) });
  page = await ctx.newPage();
  await page.goto(`${srv.base}/#/mantenimientos`);
  await page.waitForSelector('#mt-tabla');
  await cuantas(page, 5);
  const texto = await page.textContent('#pantalla');
  ok(!texto.includes('€'), 'un técnico no ve ningún importe');
  ok((await page.textContent('.barras-tarjeta h3')) === 'Sedes por plan', 'barras por número de sedes');
  const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
  ok(ancho <= 390, `en el móvil no desborda (${ancho}px)`);
  await page.screenshot({ path: `${CAPTURAS}/mantenimientos-tecnico-movil.png`, fullPage: true });
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
