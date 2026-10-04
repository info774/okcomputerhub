// Arnés de Mantenimientos (#/mantenimientos, solo lectura con el área en la
// app): el Resumen (cifras, barras por plan que llevan a Locales filtrado,
// lo que requiere atención, próximas visitas y garantías) y la tabla maestra
// de Locales con quién cobra (Stripe, esperando primer pago, Zoho vieja —una
// Zoho cancelada no cuenta—, sin domiciliar), cobro torcido y en curso, la
// cuota NETA (el bruto heredado de Zoho sin el IGIC) solo para admins,
// certificado, copia, control horario, teléfonos y código; un técnico no ve
// euros. Lo que escribe está en verify-mantenimientos-escritura.mjs.
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
  sync_estado: [], config: [], clientes_crm: [], contactos: [], tickets: [], plan_tareas: [], sitio_tarea_seguimiento: [],
  trabajos: [{ id: 't1', numero: 151, titulo: 'Revisión trimestral', tipo: 'Mantenimiento', estado: 'Pendiente', fecha_programada: dia(3).slice(0, 10), tecnicos: ['Matteo'], local_id: 'l1' }],
  local_hardware: [{ id: 'h1', local_id: 'l1', nombre: 'TPV caja', tipo: 'TPV', garantia: dia(10).slice(0, 10) }, { id: 'h2', local_id: 'l1', nombre: 'Impresora', garantia: dia(90).slice(0, 10) }],
  local_telefonos: [{ id: 'lt1', local_id: 'l1', nombre: 'Lola', numero: '+34 600 111 222', rol: 'dueno', created_at: dia(-30) },
    { id: 'lt2', local_id: 'l2', nombre: 'Barra', numero: '922 333 444', rol: 'empleado', created_at: dia(-30) }],
  areas: [{ area: 'clientes', tablas: ['clientes', 'locales', 'contactos', 'local_telefonos'], dueno: 'app' },
    { area: 'mantenimiento', tablas: ['planes_mantenimiento', 'mant_seguimiento', 'checklist_plantillas', 'mantenimientos_programados'], dueno: 'app' }],
  clientes: [{ id: 'c1', nombre: 'Polinesia Restaurante', activo: true, email: 'pol@ok.test' }, { id: 'c2', nombre: 'Bananas Cafetería', activo: true }],
  locales: [
    { id: 'l1', nombre: 'Polinesia · Playa del Duque', cliente_id: 'c1', activo: true, plan: 'Premium', importe_mantenimiento: 79, frecuencia_pago: 'Mensual',
      estado_pago: 'Al corriente', stripe_subscription_id: 'sub_1', stripe_mandato_estado: 'activo', proxima_cuota: dia(20).slice(0, 10),
      cert_caducidad: dia(12).slice(0, 10), backup_tipo: 'nube', backup_destino: 'Google Drive', control_horario: true, codigo_verificacion: '482913' },
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
  await page.waitForSelector('#mt-barras');
  ok(!!(await page.$('.aviso.area-app')), 'aviso de solo lectura');
  const pest = await page.$$eval('nav.pestanas a', as => as.map(a => a.textContent));
  ok(pest.join(',') === 'Resumen,Locales,Cobros,Checklist,Seguimiento,Plantillas,Documentos', `pestañas de la app (${pest.join(',')})`);
  const cifras = await page.$$eval('.pp-cifras .di-cifra', cs => cs.map(c => c.textContent.replace(/\s+/g, ' ').replace(/\./g, '').trim()));
  ok(cifras[0].includes('5') && cifras[0].includes('3 planes'), `contratos y planes (${cifras[0]})`);
  ok(cifras[1].includes('262 €'), `al mes neto: 79+40+39+25+79 (${cifras[1]})`);
  ok(cifras[2].startsWith('Cuotas en 90 días1') && cifras[2].includes('Playa del Duque'), `cuotas en 90 días (${cifras[2]})`);
  ok(cifras[3].startsWith('Pagos pendientes1'), `pagos pendientes (${cifras[3]})`);
  const barras = await page.$$eval('#mt-barras tr', trs => trs.map(t => t.querySelector('th').textContent));
  ok(barras.join(',') === 'Premium,Silver,Basic', `barras por plan, de más a menos sedes (${barras.join(',')})`);
  const resumen = await page.textContent('#pantalla');
  ok(resumen.includes('#151 Revisión trimestral'), 'próximas visitas de mantenimiento');
  ok(resumen.includes('TPV · TPV caja') && !resumen.includes('Impresora'), 'garantías en los próximos 30 días');
  ok(/Requieren atención[\s\S]*Bananas/.test(resumen), 'lo que requiere atención');
  await page.screenshot({ path: `${CAPTURAS}/mantenimientos-resumen.png`, fullPage: true });

  // La barra lleva a Locales filtrado por ese plan.
  await page.click('#mt-barras tr:has-text("Silver")');
  await page.waitForFunction(() => location.hash === '#/mantenimientos/locales');
  await cuantas(page, 2);
  ok((await filas(page)).every(f => f.includes('Silver')), 'la barra de un plan abre Locales filtrado por él');
  await page.selectOption('#mt-plan', '');
  await cuantas(page, 5);
  let fs = await filas(page);
  ok(!fs.some(f => /sin plan|sin nada|de baja/.test(f)), 'solo sedes activas con plan');
  ok(fila(fs, 'Playa del Duque').includes('Stripe') && fila(fs, 'Los Cristianos').includes('Esperando el primer pago'), 'Stripe con mandato / esperando el primer pago');
  ok(fila(fs, 'Bananas').includes('Zoho (cartera vieja)') && fila(fs, 'Ferretería').includes('Sin domiciliar'), 'Zoho viva cuenta; Zoho cancelada = sin domiciliar');
  ok(fila(fs, 'Bananas').includes('40,00 €'), 'el bruto heredado de Zoho se enseña neto (42,80 → 40,00)');
  ok(fila(fs, 'Clínica').includes('Cobro en curso · 12 d'), 'cobro SEPA en curso con sus días');
  ok(fila(fs, 'Los Cristianos').includes('Anual'), 'frecuencia no mensual a la vista');
  ok(fila(fs, 'Playa del Duque').includes('En 12 d') && fila(fs, 'Playa del Duque').includes('nube · Google Drive'), 'certificado a punto de caducar y copia');
  ok(fila(fs, 'Playa del Duque').includes('+34 600 111 222') && fila(fs, 'Bananas').includes('Sin dueño') && fila(fs, 'Ferretería').includes('Sin teléfonos'), 'teléfonos: dueño, sin dueño, ninguno');
  ok(fila(fs, 'Playa del Duque').includes('482913') && !!(await page.$('#mt-tabla a[href^="https://wa.me/34600111222?text="]')) && !!(await page.$('#mt-tabla a[href^="mailto:pol@ok.test"]')), 'código de verificación con WhatsApp y correo');
  ok(!(await page.$('#mt-tabla input, #mt-tabla select')), 'con el área en la app no hay nada editable en la fila');
  await page.screenshot({ path: `${CAPTURAS}/mantenimientos-admin.png` });
  await page.selectOption('#mt-ficha', 'sin_dueno');
  await cuantas(page, 4);
  ok(!(await filas(page)).some(f => f.includes('Playa del Duque')), 'filtro de ficha: sin teléfono de dueño');
  await page.selectOption('#mt-ficha', 'cert');
  await cuantas(page, 1);
  await page.selectOption('#mt-ficha', '');
  await cuantas(page, 5);
  await page.fill('#mt-filtro', '922333');
  await cuantas(page, 1);
  ok((await filas(page))[0].includes('Bananas'), 'busca por teléfono');
  await page.fill('#mt-filtro', '');
  await cuantas(page, 5);
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
  await page.click('#mt-tabla tbody tr:has-text("Bananas") a[href="#/sitios/l2"]');
  await page.waitForFunction(() => location.hash === '#/sitios/l2');
  ok(true, 'el nombre abre la ficha del sitio');
  await page.goto(`${srv.base}/#/mantenimientos/ficha/l1`);
  await page.waitForSelector('#fm-form');
  ok(await page.$eval('#fm-form button[type=submit]', b => b.disabled), 'la ficha de mantenimiento, en solo lectura');
  ok(base.reg.escrituras.filter(e => e.metodo !== 'RPC').length === 0, 'no escribe nada');
  ok(base.reg.rest.every(r => r.perfil === 'hub'), 'todas las peticiones con Accept-Profile: hub');
  ok(errores.length === 0, `sin errores JS${errores.length ? ': ' + errores.join(' | ') : ''}`);
  await ctx.close();

  // ── Técnico: ni euros ni deuda ───────────────────────────────────────────
  ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 800 } });
  await preparar(ctx, { email: 'tec@ok.test', base: baseMemoria(FIX, { clases_clientes: () => [], linea_tiempo: () => [] }) });
  page = await ctx.newPage();
  await page.goto(`${srv.base}/#/mantenimientos`);
  await page.waitForSelector('#mt-barras');
  ok(!(await page.textContent('#pantalla')).includes('€'), 'un técnico no ve ningún importe en el Resumen');
  ok((await page.textContent('.barras-tarjeta h3')) === 'Sedes por plan', 'barras por número de sedes');
  let ancho = await page.evaluate(() => document.documentElement.scrollWidth);
  ok(ancho <= 390, `el Resumen no desborda en el móvil (${ancho}px)`);
  await page.goto(`${srv.base}/#/mantenimientos/locales`);
  await page.waitForSelector('#mt-tabla');
  await cuantas(page, 5);
  ok(!(await page.textContent('#pantalla')).includes('€'), 'ni en Locales');
  ancho = await page.evaluate(() => document.documentElement.scrollWidth);
  ok(ancho <= 390, `la tabla maestra no desborda la página en el móvil (${ancho}px)`);
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
