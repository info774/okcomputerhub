// Arnés de la paridad de trabajos (bloque 1, tanda 4): firma del cliente, parte
// imprimible y plantillas de trabajo. Dos mundos:
//   · ANTES del corte: la firma se ve y no se pide, el parte sale igual, las
//     plantillas se ven sin «Nueva» y el formulario no deja guardar.
//   · DESPUÉS: firmar (sin trazo no guarda; con trazo, PNG en firma_cliente),
//     crear/editar/eliminar plantillas con sus pasos y aplicarlas en el alta.
//   npm run build && node .claude/skills/verify/verify-parte.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS } from './comun.mjs';

const { ok, fallos } = contador();
const srv = await servidor(4197);
const hoy = new Date().toLocaleDateString('sv-SE');
const iso = h => new Date(`${hoy}T${h}:00`).toISOString();
const C1 = 'c1111111-1111-1111-1111-111111111111', L1 = 'l1111111-1111-1111-1111-111111111111';
const T1 = 'b1111111-1111-1111-1111-111111111111';
const FIRMA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const base0 = cortado => ({
  usuarios: [{ id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true }, { id: 'u-tito', nombre: 'Tito Pérez', email: 'tito@ok.test', rol: 'tecnico', activo: true }],
  areas: [{ area: 'trabajos', dueno: cortado ? 'hub' : 'app', tablas: ['trabajos', 'agenda', 'sesiones', 'documento_lineas', 'trabajo_comentarios', 'trabajo_fotos', 'plantillas_trabajo'] }],
  sync_estado: [], proyectos: [], tickets: [], agenda: [], sesiones: [], trabajo_comentarios: [], presupuestos: [], contactos: [],
  config: [{ clave: 'facturacion_emisor', valor: { nombre: 'Dalmon Sistemas S.L.', nombre_comercial: 'Ok Computer Tenerife', email: 'info@okcomputertenerife.com', telefono: '922 000 000' } }],
  clientes: [{ id: C1, nombre: 'Hotel Playa SL', nif: 'B12345678', telefono: '612345678', email: 'hotel@playa.test', activo: true }],
  locales: [{ id: L1, cliente_id: C1, nombre: 'Hotel Playa', direccion: 'Av. Adeje 1', activo: true }],
  trabajos: [{ id: T1, numero: 151, created_at: iso('08:00'), titulo: 'Cambiar router', tipo: 'Asistencia', descripcion: 'Router nuevo en recepción', estado: 'Completado', tecnicos: ['Tito Pérez'],
    cliente_id: C1, local_id: L1, fecha_programada: hoy, hora_llegada: iso('10:00'), hora_salida: iso('11:30'), materiales: 'Latiguillo', observaciones: 'Todo probado',
    firma_cliente: cortado ? null : FIRMA }],
  documento_lineas: [{ id: 'd1', trabajo_id: T1, nombre: 'Router', cantidad: 2, precio: 50, descuento: 0, orden: 1 }, { id: 'd2', trabajo_id: T1, nombre: 'Mano de obra', cantidad: 1, precio: 35, descuento: 0, orden: 2 }],
  trabajo_fotos: [{ id: 'f1', trabajo_id: T1, created_at: iso('11:00'), descripcion: 'Rack terminado', archivo_path: 'trabajos/f1.jpg', drive_url: null },
    { id: 'f2', trabajo_id: T1, created_at: iso('11:05'), descripcion: 'Antes', archivo_path: null, drive_url: 'https://drive.google.com/file/d/x/view' }],
  plantillas_trabajo: [{ id: 'pl1', nombre: 'Instalar TPV', tipo: 'Instalación', descripcion: 'Montar TPV, impresora y cajón', duracion_teorica: 120, checklist: [{ texto: 'Probar impresora', completado: false }], activa: true },
    { id: 'pl0', nombre: 'Vieja', tipo: 'Asistencia', descripcion: null, duracion_teorica: null, checklist: [], activa: false }],
});

async function contexto(browser, cortado, viewport = { width: 1280, height: 900 }) {
  const base = baseMemoria(base0(cortado));
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport });
  await preparar(ctx, { email: 'ana@ok.test', base });
  // La foto privada: enlace de minutos de la función trabajo-foto.
  await ctx.route('**/functions/v1/trabajo-foto', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://fotos.ok.test/f1.jpg' }) }));
  await ctx.route('https://fotos.ok.test/**', route => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(FIRMA.split(',')[1], 'base64') }));
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
  page.on('dialog', d => d.accept());
  return { ctx, page, base, errores };
}
const escr = (base, m, t) => base.reg.escrituras.filter(e => e.metodo === m && e.tabla === t);

const browser = await navegador();
try {
  // ── Sin corte ───────────────────────────────────────────────────────────
  const A = await contexto(browser, false);
  await A.page.goto(`${srv.base}/#/trabajos/151`);
  await A.page.waitForSelector('.op-ficha');
  ok(await A.page.locator('img.tr-firma').count() === 1 && await A.page.locator('[data-action="trFirmar"]').count() === 0, 'sin corte: la firma se ve y no se pide');
  await A.page.click('a[href="#/trabajos/151/parte"]');
  await A.page.waitForSelector('.tr-parte');
  const parte = await A.page.textContent('.tr-parte');
  ok(parte.includes('Ok Computer Tenerife') && parte.includes('Parte de trabajo') && parte.includes('#151'), 'parte: empresa (de hub.config) y número');
  ok(parte.includes('Hotel Playa SL') && parte.includes('B12345678') && parte.includes('Local: Hotel Playa — Av. Adeje 1'), 'parte: cliente, NIF y local');
  ok(parte.includes('Duración: 1 h 30 min') && parte.includes('Router nuevo en recepción') && parte.includes('Latiguillo') && parte.includes('Todo probado'), 'parte: duración, descripción, materiales y observaciones');
  ok(/135,00\s*€/.test(parte) && /144,45\s*€/.test(parte), 'parte: productos con total (135 €) y total con IGIC (144,45 €)');
  ok(await A.page.locator('.tr-parte img.pa-firma').count() === 1, 'parte: lleva la firma del cliente');
  await A.page.waitForSelector('.pa-fotos img');
  ok(await A.page.locator('.pa-fotos a[href^="https://drive.google.com"]').count() === 1, 'parte: la foto subida al hub entra por su enlace y la de Drive, como enlace');
  ok(await A.page.locator('[data-action="paImprimir"]').count() === 1, 'parte: «Imprimir o guardar en PDF»');
  await A.page.emulateMedia({ media: 'print' });
  ok(await A.page.locator('.tr-parte').isVisible() && !(await A.page.locator('#menu').isVisible()), 'parte: al imprimir sale solo el parte');
  // Que no se corte al alto de la ventana (con `inset: 0` las fotos quedaban fuera).
  ok(await A.page.evaluate(() => { const a = document.querySelector('.tr-parte').getBoundingClientRect(), p = document.querySelector('.pa-pie').getBoundingClientRect(); return p.bottom <= a.bottom + 1; }), 'parte: al imprimir cabe entero, hasta el pie');
  await A.page.screenshot({ path: `${CAPTURAS}/parte-imprimir.png`, fullPage: true });
  await A.page.emulateMedia({ media: 'screen' });
  await A.page.goto(`${srv.base}/#/trabajos/plantillas`);
  await A.page.waitForSelector('.tp-lista');
  ok((await A.page.textContent('.tp-lista')).includes('Instalar TPV') && !(await A.page.textContent('.tp-lista')).includes('Vieja')
    && await A.page.locator('a[href="#/trabajos/plantillas/nueva"]').count() === 0 && await A.page.locator('.area-app').count() === 1, 'sin corte: plantillas activas a la vista, sin «Nueva» y avisado');
  ok(A.base.reg.escrituras.length === 0 && A.errores.length === 0, `sin corte: nada escrito y sin errores${A.errores.length ? ': ' + A.errores.join(' | ') : ''}`);
  await A.ctx.close();

  // ── Con corte ───────────────────────────────────────────────────────────
  const B = await contexto(browser, true);
  const { page, base } = B;
  await page.goto(`${srv.base}/#/trabajos/151`);
  await page.waitForSelector('.op-ficha');
  ok((await page.textContent('.op-ficha')).includes('Sin firmar'), 'ficha: «Sin firmar»');
  await page.click('[data-action="trFirmar"]');
  await page.waitForSelector('#fc-lienzo');
  await page.click('[data-action="fcGuardar"]');
  await page.waitForFunction(() => document.getElementById('toast')?.textContent.includes('firmar primero'));
  ok(escr(base, 'PATCH', 'trabajos').length === 0, 'firma: sin trazo no se guarda');
  const caja = await page.locator('#fc-lienzo').boundingBox();
  await page.mouse.move(caja.x + 40, caja.y + 60);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(caja.x + 40 + i * 25, caja.y + 60 + (i % 2 ? 30 : -10));
  await page.mouse.up();
  ok(await page.locator('#fc-ayuda[hidden]').count() === 1, 'firma: al trazar se quita «Firme aquí»');
  await page.click('[data-action="fcGuardar"]');
  await page.waitForSelector('img.tr-firma');
  const firma = escr(base, 'PATCH', 'trabajos').at(-1)?.cuerpo?.firma_cliente ?? '';
  ok(firma.startsWith('data:image/png;base64,') && firma.length > 200 && await page.locator('#fc-capa').count() === 0, 'firma: se guarda como PNG en firma_cliente y se ve en la ficha');

  // Plantillas
  await page.goto(`${srv.base}/#/trabajos/plantillas/nueva`);
  await page.waitForSelector('#tp-form');
  await page.fill('#tp-nombre', 'Revisar alarma');
  await page.selectOption('#tp-tipo', 'Mantenimiento');
  await page.fill('#tp-duracion', '45');
  await page.fill('#tp-paso', 'Probar sirena');
  await page.press('#tp-paso', 'Enter');
  await page.fill('#tp-paso', 'Cambiar batería');
  await page.click('[data-action="tpPaso"]');
  await page.fill('#tp-paso', 'Sobra');
  await page.click('[data-action="tpPaso"]');
  await page.click('#tp-pasos li:has-text("Sobra") [data-action="tpQuitarPaso"]');
  await page.click('#tp-form button[type=submit]');
  await page.waitForSelector('.tp-lista');
  const nueva = escr(base, 'POST', 'plantillas_trabajo').at(-1)?.cuerpo;
  ok(nueva?.nombre === 'Revisar alarma' && nueva?.tipo === 'Mantenimiento' && nueva?.duracion_teorica === 45 && JSON.stringify(nueva?.checklist?.map(x => x.texto)) === '["Probar sirena","Cambiar batería"]',
    'plantilla nueva: nombre, tipo, duración y pasos (Enter y botón; quitar uno)');
  await page.click('.tp-lista a:has-text("Instalar TPV")');
  await page.waitForSelector('#tp-form');
  ok((await page.textContent('#tp-pasos')).includes('Probar impresora'), 'editar plantilla: trae sus pasos');
  await page.fill('#tp-duracion', '90');
  await page.click('#tp-form button[type=submit]');
  await page.waitForSelector('.tp-lista');
  ok(escr(base, 'PATCH', 'plantillas_trabajo').at(-1)?.cuerpo?.duracion_teorica === 90, 'editar plantilla: guarda el cambio');

  // Alta con plantilla
  await page.goto(`${srv.base}/#/trabajos/nuevo`);
  await page.waitForSelector('#tf-plantilla');
  await page.selectOption('#tf-plantilla', 'pl1');
  ok(await page.inputValue('#tf-tipo') === 'Instalación' && await page.inputValue('#tf-descripcion') === 'Montar TPV, impresora y cajón' && await page.inputValue('#tf-duracion') === '90'
    && await page.inputValue('#tf-titulo') === 'Instalar TPV', 'alta: la plantilla pone tipo, descripción, duración y (vacío) el título');
  await page.fill('#tf-titulo', 'TPV Bar Sol');
  await page.click('#tf-form button[type=submit]');
  await page.waitForSelector('.op-ficha');
  const alta = escr(base, 'POST', 'trabajos').at(-1)?.cuerpo;
  ok(alta?.titulo === 'TPV Bar Sol' && alta?.tipo === 'Instalación' && alta?.descripcion === 'Montar TPV, impresora y cajón' && alta?.duracion_teorica === 90, 'alta: el trabajo nace con lo de la plantilla');

  // Eliminar = desactivar
  await page.goto(`${srv.base}/#/trabajos/plantillas/pl1`);
  await page.waitForSelector('#tp-form');
  await page.click('[data-action="tpEliminar"]');
  await page.waitForSelector('.tp-lista');
  ok(escr(base, 'PATCH', 'plantillas_trabajo').at(-1)?.cuerpo?.activa === false && escr(base, 'DELETE', 'plantillas_trabajo').length === 0, 'eliminar plantilla: se desactiva, no se borra');
  ok(B.errores.length === 0, `con corte: sin errores${B.errores.length ? ': ' + B.errores.join(' | ') : ''}`);
  await B.ctx.close();

  // ── Móvil: el lienzo de firma ocupa la pantalla y el parte no desborda ──
  const M = await contexto(browser, true, { width: 390, height: 844 });
  await M.page.goto(`${srv.base}/#/trabajos/151`);
  await M.page.waitForSelector('[data-action="trFirmar"]');
  await M.page.click('[data-action="trFirmar"]');
  await M.page.waitForSelector('#fc-lienzo');
  const lz = await M.page.locator('#fc-lienzo').boundingBox();
  ok(lz.width > 300 && lz.height > 500, `móvil: el lienzo ocupa la pantalla (${Math.round(lz.width)}×${Math.round(lz.height)})`);
  await M.page.screenshot({ path: `${CAPTURAS}/firma-movil.png` });
  await M.page.click('[data-action="fcCerrar"]');
  await M.page.goto(`${srv.base}/#/trabajos/151/parte`);
  await M.page.waitForSelector('.tr-parte');
  const ancho = await M.page.evaluate(() => document.documentElement.scrollWidth);
  ok(ancho <= 390, `móvil: el parte no desborda (${ancho} px)`);
  await M.ctx.close();
} finally {
  await browser.close();
  srv.parar();
}
process.exit(fallos() ? 1 : 0);
