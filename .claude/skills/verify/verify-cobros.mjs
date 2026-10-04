// Arnés de Cobros del mantenimiento (paridad bloque 4, tanda 3): el cuadro de
// sedes con sus cifras (cuota domiciliada, cobrado este mes, sin domiciliar,
// sin medio de pago, recibos devueltos, sin factura en Zoho), filtros y
// buscador sobre sedes Y libro, los botones según quién cobra (Stripe, Zoho
// viva, Zoho de baja, nadie), domiciliar con la cuota del periodo + IGIC y el
// enlace de pago, pausar, baja, desvincular de Zoho, emitir en Zoho, traer el
// estado de Stripe con las cuotas descuadradas, la página de una sede con sus
// cuotas y abonos, cambiar plan (sugiere el precio, enseña lo que se cargará),
// abonar (con el máximo y el motivo) y los ajustes de facturación (desplegables
// de Zoho, serie de ejemplo). Sin el corte: se ve y no se toca. Solo admin.
// La función stripe-suscripcion va SIMULADA.
//
//   npm run build && node .claude/skills/verify/verify-cobros.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS, SB } from './comun.mjs';

const PUERTO = 4235;
const { ok, fallos, sumar } = contador();
const hoy = new Date().toLocaleDateString('sv-SE');
const dia = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString(); };

const C = (id, nombre, cliente, extra) => ({ local_id: id, local_nombre: nombre, cliente_id: `c-${id}`, cliente_nombre: cliente, cliente_email: `${id}@ok.test`,
  importe_incluye_impuesto: false, frecuencia_pago: 'Mensual', estado_pago: 'Al corriente', forma_pago: null, proxima_cuota: null, stripe_subscription_id: null,
  stripe_estado: null, stripe_mandato_estado: null, stripe_ultimo_error: null, stripe_cobro_en_curso_at: null, stripe_sync_at: null, zoho_subscription_id: null,
  zoho_estado: null, zoho_deuda: null, zoho_facturas_impagadas: null, zoho_sync_error: null, ultima_factura_numero: null, ultima_factura_zoho_estado: null, ...extra });
const FIX = {
  usuarios: [
    { id: 'u-fran', nombre: 'Fran Admin', email: 'admin@ok.test', rol: 'admin', activo: true },
    { id: 'u-mat', nombre: 'Matteo Monastero', email: 'tec@ok.test', rol: 'tecnico', activo: true },
  ],
  sync_estado: [], config: [], areas: [],
  locales: [{ id: 'l5', nombre: 'Bar del Puerto', zoho_subscription_id: 'z5', zoho_estado: 'cancelled' },
    { id: 'l2', nombre: 'Bananas Cafetería', cliente_id: 'c-l2', activo: true, plan: 'Silver' }, { id: 'l2b', nombre: 'Bananas Puerto', cliente_id: 'c-l2', activo: true }],
  clientes: [{ id: 'c-l2', nombre: 'Bananas', zoho_id: '4600002', activo: true }],
  clientes_crm: [], actividades: [], oportunidades: [], contactos: [], rmm_estado_local: [],
  planes_mantenimiento: [
    { id: 'p1', nombre: 'Premium', orden: 1, precio_mensual: 49, activo: true }, { id: 'p2', nombre: 'Silver', orden: 2, precio_mensual: 79, activo: true },
    { id: 'p0', nombre: 'Sin mantenimiento', orden: 0, activo: true },
  ],
  mant_config: [{ id: true, serie_prefijo: 'MANT', serie_digitos: 4, precio_incluye_impuesto: false, zoho_tax_id: 'tx7', zoho_tax_percent: 7, zoho_cuenta_cobro_id: 'cta1',
    zoho_notas: null, facturar_automatico: true, enviar_factura_email: true, pago_metodos: ['card', 'sepa'] }],
  mant_cobros_estado: [
    C('l1', 'Playa del Duque', 'Polinesia', { plan: 'Premium', importe_mantenimiento: 49, stripe_subscription_id: 'sub_1', stripe_estado: 'active', stripe_mandato_estado: 'activo',
      proxima_cuota: dia(20).slice(0, 10), forma_pago: 'Stripe SEPA', ultima_factura_numero: 'MANT-2026-0007' }),
    C('l2', 'Bananas Cafetería', 'Bananas', { plan: 'Silver', importe_mantenimiento: 42.8, importe_incluye_impuesto: true, zoho_subscription_id: 'z2', zoho_estado: 'live', zoho_deuda: 85.6, zoho_facturas_impagadas: 2 }),
    C('l3', 'Ferretería Sur', 'Ferretería Sur', { plan: 'Basic', importe_mantenimiento: 25, frecuencia_pago: 'anual' }),
    C('l4', 'Clínica Norte', 'Clínica', { plan: 'Silver', importe_mantenimiento: 79, stripe_subscription_id: 'sub_4', stripe_estado: 'incomplete', stripe_mandato_estado: 'pendiente',
      stripe_cobro_en_curso_at: dia(-12) }),
    C('l5', 'Bar del Puerto', 'Bar del Puerto', { plan: 'Basic', importe_mantenimiento: 30, zoho_subscription_id: 'z5', zoho_estado: 'cancelled' }),
    C('l6', 'Sin plan', 'Nadie', { plan: 'Sin mantenimiento' }),
    C('l7', 'Taller Moto', 'Taller', { plan: 'Premium', importe_mantenimiento: 39, stripe_subscription_id: 'sub_7', stripe_estado: 'past_due', stripe_mandato_estado: 'activo',
      stripe_ultimo_error: 'El banco ha devuelto el recibo: sin fondos.' }),
  ],
  mant_facturas: [
    { id: 'f1', created_at: dia(-3), local_id: 'l1', numero_serie: 'MANT-2026-0007', importe: 52.43, estado: 'pagada', fecha_emision: hoy, zoho_invoice_id: 'z1',
      zoho_invoice_number: 'MANT-2026-0007', zoho_estado: 'pagada', email_enviado_at: dia(-3), email_destinatarios: ['pol@ok.test'], stripe_invoice_id: 'in_1',
      stripe_pdf_url: 'https://pay.stripe.com/x.pdf', tipo: 'cuota', saldo_aplicado: 0 },
    { id: 'f2', created_at: dia(-2), local_id: 'l1', numero_serie: null, importe: 52.43, estado: 'pagada', fecha_emision: hoy, zoho_invoice_id: null, zoho_estado: 'error',
      zoho_error: 'El cliente no tiene ficha en Zoho Books.', stripe_invoice_id: 'in_2', tipo: 'cuota', saldo_aplicado: 0 },
    { id: 'f3', created_at: dia(-1), local_id: 'l7', numero_serie: null, importe: 41.73, estado: 'fallida', error_pago: 'Sin fondos', stripe_invoice_id: 'in_3', zoho_estado: 'pendiente', saldo_aplicado: 0 },
  ],
  mant_abonos: [{ id: 'a1', factura_id: 'f1', local_id: 'l1', numero_serie: 'ABONO-2026-0001', importe: 5.92, motivo: 'Impuesto aplicado dos veces', zoho_creditnote_number: 'ABONO-2026-0001', stripe_balance_txn_id: 'cbtxn_1' }],
};
const RPC = { clases_clientes: () => [], linea_tiempo: () => [] };

const srv = await servidor(PUERTO);
const browser = await navegador();
async function contexto(email, fix) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  const base = baseMemoria(fix, RPC);
  await preparar(ctx, { email, base });
  const llamadas = [];
  await ctx.route(`${SB}/functions/v1/stripe-suscripcion`, async route => {
    const b = route.request().postDataJSON();
    llamadas.push(b);
    const r = {
      crear: { ok: true, pago_url: 'https://checkout.stripe.test/c/1', caduca: dia(1).slice(0, 10), mensaje: 'Alta hecha' },
      mandato_link: { ok: true, url: 'https://checkout.stripe.test/m/1', caduca: dia(1).slice(0, 10) },
      sincronizar: { ok: true, divergentes: [{ sede: 'Clínica Norte', app: 79, stripe: 84.53 }], mensaje: '3 suscripciones sincronizadas' },
      zoho_opciones: { ok: true, impuestos: [{ id: 'tx3', nombre: 'IGIC reducido', porcentaje: 3 }, { id: 'tx7', nombre: 'IGIC general', porcentaje: 7 }], cuentas: [{ id: 'cta1', nombre: 'Caixa' }] },
    }[b.accion] ?? { ok: true, mensaje: 'Hecho' };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r) });
  });
  const zc = [];
  const guarda = !(fix.areas ?? []).length;
  await ctx.route(`${SB}/functions/v1/zoho-cartera`, async route => {
    const b = route.request().postDataJSON();
    zc.push(b);
    const r = {
      comprobar: { ok: true, guardado: guarda, status: 'live', estado_pago: 'Pendiente de pago', deuda: 85.6, facturas_impagadas: 2, importe: 42.8, proxima_cuota: dia(9).slice(0, 10), url: 'https://billing.zoho.eu/app/1#/subscriptions/z2' },
      listar: { ok: true, puede_vincular: guarda, subscriptions: [{ subscription_id: 'z2', plan_name: 'Silver mensual', status: 'live', status_label: 'Activa', amount: 42.8, next_billing_at: dia(9).slice(0, 10), url: 'https://billing.zoho.eu/app/1#/subscriptions/z2' },
        { subscription_id: 'z9', plan_name: 'Basic', status: 'cancelled', status_label: 'Cancelada', amount: 25, next_billing_at: null, url: 'https://billing.zoho.eu/app/1#/subscriptions/z9' }] },
      vincular: { ok: true, guardado: true, estado_pago: 'Al corriente', mensaje: 'Vinculada' },
    }[b.accion] ?? { error: 'acción' };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r) });
  });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
  page.on('dialog', d => { page._dialogos = [...(page._dialogos ?? []), d.message()]; d.accept(); });
  return { ctx, base, page, llamadas, errores, zc };
}
const espera = (fn, ms = 4000) => new Promise((res, rej) => { const t0 = Date.now(); const i = setInterval(() => { if (fn()) { clearInterval(i); res(); } else if (Date.now() - t0 > ms) { clearInterval(i); rej(new Error('no llegó')); } }, 50); });
const sedes = page => page.$$eval('#mcb-sedes > li', l => l.map(x => x.dataset.sede));

try {
  let { ctx, base, page, llamadas, errores, zc } = await contexto('admin@ok.test', FIX);
  await page.goto(`${srv.base}/#/mantenimientos/cobros`);
  await page.waitForSelector('#mcb-sedes');
  ok(!(await page.$('.aviso.area-app')) && (await page.$$eval('nav.pestanas a', a => a.map(x => x.textContent))).includes('Cobros'), 'admin con el corte: la pestaña Cobros, sin aviso');
  const cifras = await page.$$eval('.mcb-cifras .di-cifra', cs => cs.map(c => c.textContent.replace(/\s+/g, ' ').replace(/ /g, ' ').trim()));
  ok(cifras[0].includes('167,00 €'), `cuota mensual domiciliada: 49 + 79 + 39 (${cifras[0]})`);
  ok(cifras[1].includes('104,86 €'), `cobrado este mes (${cifras[1]})`);
  ok(cifras[2].includes('3') && cifras[2].includes('2 sin domiciliar'), `sedes en Stripe (${cifras[2]})`);
  ok(cifras[3].includes('1') && cifras[4].includes('Cobros en curso') && cifras[4].includes('1 sin liquidar'), `sin medio de pago y cobro SEPA en curso (${cifras[3]} | ${cifras[4]})`);
  ok(cifras[5].includes('Recibos devueltos1') && cifras[6].includes('Cobros sin factura en Zoho1'), `devueltos y sin factura (${cifras[5]} | ${cifras[6]})`);
  ok((await sedes(page)).join(',') === 'l1,l2,l3,l4,l5,l7', 'las sedes con plan (sin la de «Sin mantenimiento»)');
  const t = async id => (await page.textContent(`#mcb-sedes li[data-sede="${id}"]`)).replace(/ /g, ' ');
  ok((await t('l1')).includes('Activa') && (await t('l1')).includes('Tarjeta o SEPA') && !!(await page.$('#mcb-sedes li[data-sede="l1"] [data-action="mcbPausar"]'))
    && !!(await page.$('#mcb-sedes li[data-sede="l1"] a[href="#/mantenimientos/cobros/cambiar/l1"]')), 'Stripe al día: cuotas, cambiar plan, medio de pago, portal, pausar, baja');
  ok((await t('l2')).includes('Debe 85,60 € (2)') && !!(await page.$('#mcb-sedes li[data-sede="l2"] a[href*="billing.zoho.eu"]')) && !(await page.$('#mcb-sedes li[data-sede="l2"] [data-action="mcbCrear"]')),
    'Zoho viva: su deuda, «Ver en Zoho» y sin «Domiciliar»');
  ok(!!(await page.$('#mcb-sedes li[data-sede="l5"] [data-action="mcbCrear"]')) && (await t('l5')).includes('Baja en Zoho'), 'Zoho de baja: se puede domiciliar (y desvincular)');
  ok(!!(await page.$('#mcb-sedes li[data-sede="l4"] [data-action="mcbMandato"]')) && (await t('l4')).includes('Falta el medio de pago') && (await t('l4')).includes('Cobro sin liquidar (12 días)'), 'alta sin pagar: «Enlace de pago» y el cobro SEPA lento');
  ok((await t('l7')).includes('Recibo devuelto') && (await t('l7')).includes('sin fondos'), 'recibo devuelto con el motivo del banco');
  for (const [k, n] of [['sin_domiciliar', 'l3,l5'], ['sin_mandato', 'l4'], ['impagados', 'l7'], ['activos', 'l1'], ['', 'l1,l2,l3,l4,l5,l7']]) {
    await page.click(`[data-action="mcbFiltro"][data-p0="${k}"]`);
    await page.waitForFunction(x => [...document.querySelectorAll('#mcb-sedes > li')].map(l => l.dataset.sede).join(',') === x, n);
    ok(true, `filtro «${k || 'todas'}»: ${n}`);
  }
  const libro = (await page.textContent('#mcb-libro')).replace(/ /g, ' ');
  ok(libro.includes('Zoho MANT-2026-0007') && libro.includes('Enviada al cliente') && libro.includes('cobro interno') && libro.includes('ABONO-2026-0001') && libro.includes('−5,92 €')
    && libro.includes('Sin facturar') && libro.includes('Devuelta'), 'libro: factura de Zoho enviada, apunte interno, abono, sin facturar y devuelta');
  await page.fill('#mcb-q', 'banan');
  await page.waitForFunction(() => document.querySelectorAll('#mcb-sedes > li').length === 1 && !document.querySelector('#mcb-libro'));
  ok(true, 'el buscador filtra sedes y libro');
  await page.fill('#mcb-q', '');
  await page.waitForFunction(() => document.querySelectorAll('#mcb-sedes > li').length === 6);
  await page.screenshot({ path: `${CAPTURAS}/cobros.png`, fullPage: true });

  // Domiciliar: la cuota del PERIODO con el impuesto, y el enlace con WhatsApp y correo.
  await page.click('#mcb-sedes li[data-sede="l3"] [data-action="mcbCrear"]');
  await page.waitForSelector('#mcb-enlace');
  ok((page._dialogos ?? []).at(-1).replace(/ /g, ' ').includes('300,00 € + impuestos = 321,00 € cada año (25,00 €/mes × 12 meses)'), 'domiciliar confirma la cuota anual con IGIC (frecuencia en minúscula normalizada)');
  ok(llamadas.at(-1).accion === 'crear' && llamadas.at(-1).local_id === 'l3', 'domiciliar = «crear» en la función');
  ok((await page.inputValue('#mcb-url')) === 'https://checkout.stripe.test/c/1' && (await page.getAttribute('#mcb-enlace a[href^="https://wa.me/"]', 'href')).includes(encodeURIComponent('https://checkout.stripe.test/c/1'))
    && (await page.getAttribute('#mcb-enlace a[href^="mailto:"]', 'href')).startsWith('mailto:l3%40ok.test'), 'el enlace de pago, para mandarlo por WhatsApp o correo');
  await page.click('[data-action="mcbCerrarEnlace"]');
  await page.click('#mcb-sedes li[data-sede="l4"] [data-action="mcbMandato"]');
  await page.waitForSelector('#mcb-enlace');
  ok(llamadas.at(-1).accion === 'mandato_link' && (await page.inputValue('#mcb-url')).endsWith('/m/1'), 'enlace de pago de un alta sin pagar');
  await page.click('[data-action="mcbCerrarEnlace"]');
  await page.click('#mcb-sedes li[data-sede="l1"] [data-action="mcbPausar"]');
  await espera(() => llamadas.at(-1)?.accion === 'pausar');
  await page.waitForSelector('#mcb-sedes li[data-sede="l1"] [data-action="mcbCancelar"]');
  await page.click('#mcb-sedes li[data-sede="l1"] [data-action="mcbCancelar"]');
  await espera(() => llamadas.at(-1)?.accion === 'cancelar');
  ok(llamadas.at(-1).local_id === 'l1', 'pausar y dar de baja (confirmados)');
  await page.waitForSelector('#mcb-sedes li[data-sede="l5"] [data-action="mcbDesvincular"]');
  await page.click('#mcb-sedes li[data-sede="l5"] [data-action="mcbDesvincular"]');
  await espera(() => base.reg.escrituras.some(e => e.metodo === 'PATCH' && e.tabla === 'locales'));
  const pd = base.reg.escrituras.find(e => e.metodo === 'PATCH' && e.tabla === 'locales');
  ok(pd.url.includes('id=eq.l5') && pd.cuerpo.zoho_subscription_id === null && !('zoho_deuda' in pd.cuerpo), 'desvincular de Zoho: suelta la suscripción, la deuda se queda');
  await page.waitForSelector('#mcb-libro [data-action="mcbEmitir"]');
  await page.click('#mcb-libro [data-action="mcbEmitir"]');
  await espera(() => llamadas.at(-1)?.accion === 'emitir_zoho');
  ok(llamadas.at(-1).factura_id === 'f2', '«Emitir en Zoho» de una cuota cobrada sin factura');
  await page.waitForSelector('[data-action="mcbSync"]');
  await page.click('[data-action="mcbSync"]');
  await page.waitForSelector('#mcb-divergentes');
  ok((await page.textContent('#mcb-divergentes')).replace(/ /g, ' ').includes('Clínica Norte') && (await page.textContent('#mcb-divergentes')).replace(/ /g, ' ').includes('84,53 €'), 'traer el estado de Stripe avisa de las cuotas descuadradas');
  await page.click('[data-action="mcbCerrarDivergentes"]');

  // La sede: su cobro y sus cuotas.
  await page.goto(`${srv.base}/#/mantenimientos/cobros/sede/l1`);
  await page.waitForSelector('#mcb-sede');
  const s1 = (await page.textContent('#pantalla')).replace(/\u00a0/g, ' ');
  ok(s1.includes('Se le cargan 52,43 € cada mes') && s1.includes('Stripe SEPA') && await page.$$eval('#mcb-libro > li', l => l.length) === 2 && s1.includes('ABONO-2026-0001'), 'la sede: cuota, se le carga, forma de pago, cuotas y abono');
  await page.screenshot({ path: `${CAPTURAS}/cobros-sede.png`, fullPage: true });

  // Cambiar plan.
  await page.goto(`${srv.base}/#/mantenimientos/cobros/cambiar/l1`);
  await page.waitForSelector('#mcc-form');
  await page.selectOption('#mcc-plan', 'Silver');
  ok((await page.inputValue('#mcc-importe')) === '79', 'al elegir plan se sugiere su precio');
  await page.selectOption('#mcc-frecuencia', 'Anual');
  ok((await page.textContent('#mcc-bruto')).replace(/ /g, ' ').includes('Se le cargarán 1014,36 €') || (await page.textContent('#mcc-bruto')).replace(/ /g, ' ').includes('1.014,36 €'), `lo que se cargará: 79 × 12 + IGIC (${await page.textContent('#mcc-bruto')})`);
  await page.click('#mcc-form button[type=submit]');
  await page.waitForFunction(() => location.hash === '#/mantenimientos/cobros/sede/l1');
  ok(llamadas.at(-1).accion === 'cambiar' && llamadas.at(-1).plan === 'Silver' && llamadas.at(-1).importe === 79 && llamadas.at(-1).frecuencia === 'Anual', 'cambiar plan va a la función');

  // Abonar.
  await page.goto(`${srv.base}/#/mantenimientos/cobros/abonar/f1`);
  await page.waitForSelector('#mab-form');
  ok((await page.textContent('#mab-max')).replace(/ /g, ' ') === '46,51 €', 'se puede abonar lo cobrado menos lo ya abonado');
  await page.fill('#mab-importe', '10');
  await page.fill('#mab-motivo', 'Cambio de plan');
  await page.click('#mab-form button[type=submit]');
  await page.waitForFunction(() => location.hash === '#/mantenimientos/cobros/sede/l1');
  ok(llamadas.at(-1).accion === 'abonar' && llamadas.at(-1).factura_id === 'f1' && llamadas.at(-1).importe === 10 && llamadas.at(-1).motivo === 'Cambio de plan', 'abonar con importe y motivo');

  // Ajustes de facturación.
  await page.goto(`${srv.base}/#/mantenimientos/cobros/ajustes`);
  await page.waitForFunction(() => document.querySelectorAll('#mcfg-tax option').length === 3);
  ok((await page.inputValue('#mcfg-tax')) === 'tx7' && (await page.inputValue('#mcfg-cuenta')) === 'cta1', 'los desplegables de Zoho, con lo guardado elegido');
  await page.fill('#mcfg-prefijo', 'mnt');
  ok((await page.textContent('#mcfg-ejemplo')).includes(`MNT-${new Date().getFullYear()}-0001`), 'la serie de ejemplo');
  await page.selectOption('#mcfg-metodos', 'sepa');
  await page.click('#mcfg-form button[type=submit]');
  await page.waitForFunction(() => location.hash === '#/mantenimientos/cobros');
  const pc = base.reg.escrituras.find(e => e.metodo === 'PATCH' && e.tabla === 'mant_config').cuerpo;
  ok(pc.serie_prefijo === 'MNT' && pc.zoho_tax_id === 'tx7' && pc.zoho_tax_percent === 7 && pc.pago_metodos.join() === 'sepa', 'guardar ajustes (el % del impuesto se conserva si no cambia)');
  // Cartera vieja de Zoho Billing: comprobar una sede y vincular desde el cliente.
  await page.waitForSelector('#mcb-sedes li[data-sede="l2"] [data-action="mcbComprobarZoho"]');
  await page.click('#mcb-sedes li[data-sede="l2"] [data-action="mcbComprobarZoho"]');
  await page.waitForSelector('#mcb-zoho');
  const zt = (await page.textContent('#mcb-zoho')).replace(/\u00a0/g, ' ');
  ok(zc.at(-1).accion === 'comprobar' && zc.at(-1).local_id === 'l2' && zt.includes('85,60 € (2 facturas)') && zt.includes('Pendiente de pago') && zt.includes('Guardado en la sede'),
    '«Comprobar en Zoho»: estado, deuda real y, con el corte, guardado');
  ok(!!(await page.$('#mcb-sedes li[data-sede="l5"] [data-action="mcbComprobarZoho"]')), 'también en una sede con la suscripción de Zoho de baja');
  await page.click('[data-action="mcbCerrarZoho"]');
  await page.goto(`${srv.base}/#/clientes/c-l2/sedes`);
  await page.waitForSelector('#czb [data-action="czbBuscar"]');
  await page.click('#czb [data-action="czbBuscar"]');
  await page.waitForSelector('#czb-subs');
  ok(zc.at(-1).accion === 'listar' && zc.at(-1).zoho_customer_id === '4600002' && await page.$$eval('#czb-subs > li', l => l.length) === 2
    && await page.$$eval('#czb-sede-z2 option', o => o.map(x => x.value).join()) === ',l2,l2b', 'ficha del cliente: sus suscripciones de Zoho Billing y sus sedes para vincular');
  await page.click('[data-action="czbVincular"][data-p0="z2"]');
  await page.waitForTimeout(200);
  ok(zc.at(-1).accion === 'listar', 'sin elegir sede no se vincula');
  await page.selectOption('#czb-sede-z2', 'l2b');
  await page.click('[data-action="czbVincular"][data-p0="z2"]');
  await espera(() => zc.at(-1)?.accion === 'vincular');
  ok(zc.at(-1).local_id === 'l2b' && zc.at(-1).subscription_id === 'z2', 'vincular la suscripción a la sede elegida');
  ok(errores.length === 0, `sin errores JS${errores.length ? ': ' + errores.join(' | ') : ''}`);
  await ctx.close();

  // ── Sin el corte: se ve y no se toca ───────────────────────────────────
  ({ ctx, base, page, llamadas, zc } = await contexto('admin@ok.test', { ...FIX, areas: [{ area: 'mantenimiento', tablas: ['mant_facturas', 'mant_config'], dueno: 'app' }] }));
  await page.goto(`${srv.base}/#/mantenimientos/cobros`);
  await page.waitForSelector('#mcb-sedes');
  ok(!!(await page.$('.aviso.area-app')) && await page.$$eval('#mcb-sedes button[data-action]:not([data-action="mcbComprobarZoho"])', b => b.every(x => x.disabled)), 'sin el corte: el cuadro se ve con los botones apagados (salvo comprobar en Zoho)');
  await page.goto(`${srv.base}/#/mantenimientos/cobros/ajustes`);
  await page.waitForSelector('#mcfg-form');
  ok(await page.$eval('#mcfg-form button[type=submit]', b => b.disabled) && llamadas.length === 0 && base.reg.escrituras.filter(e => e.metodo !== 'RPC').length === 0, 'ni ajustes ni llamadas a Stripe');
  await page.goto(`${srv.base}/#/mantenimientos/cobros`);
  await page.waitForSelector('#mcb-sedes li[data-sede="l2"] [data-action="mcbComprobarZoho"]:not([disabled])');
  await page.click('#mcb-sedes li[data-sede="l2"] [data-action="mcbComprobarZoho"]');
  await page.waitForSelector('#mcb-zoho');
  ok((await page.textContent('#mcb-zoho')).includes('Solo consultado'), 'sin el corte, «Comprobar en Zoho» consulta y no guarda');
  await page.goto(`${srv.base}/#/clientes/c-l2/sedes`);
  await page.click('#czb [data-action="czbBuscar"]');
  await page.waitForSelector('#czb-subs');
  ok(!(await page.$('[data-action="czbVincular"]')) && (await page.textContent('#czb')).includes('se sigue haciendo en la app'), 'sin el corte, se ven las suscripciones pero se vinculan en la app');
  await ctx.close();

  // ── Técnico: ni la pestaña ─────────────────────────────────────────────
  ({ ctx, page } = await contexto('tec@ok.test', FIX));
  await page.goto(`${srv.base}/#/mantenimientos/cobros`);
  await page.waitForSelector('nav.pestanas');
  ok(!(await page.$$eval('nav.pestanas a', a => a.map(x => x.textContent))).includes('Cobros') && (await page.textContent('#pantalla, main')).includes('solo para administración'), 'un técnico no ve los cobros');
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
