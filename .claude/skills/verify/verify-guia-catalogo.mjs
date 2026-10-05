// Arnés de la tanda 4 del bloque 8: la guía de instalación del trabajo (elegir
// tipo, pasos, finalizar: observaciones, «En progreso» por hub.trabajo_estado
// SIMULADA y el equipo a la sede; resumen con contraseñas tapadas), el escáner
// de códigos en el material (sin cámara: el campo; uno → línea, varios →
// elegir, ninguno → aviso), el catálogo (por categoría, buscar, alta, cambiar
// categoría en bloque; con el área de la app, solo lectura) y la base de
// conocimiento de la wiki (lista, filtro, alta; solo lectura con la app).
// Sin datos reales.
//   npm run build && node .claude/skills/verify/verify-guia-catalogo.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS } from './comun.mjs';

const { ok, fallos } = contador();
const srv = await servidor(4209);
const C1 = 'c1111111-1111-1111-1111-111111111111', L1 = 'l1111111-1111-1111-1111-111111111111', W1 = 'w1111111-1111-1111-1111-111111111111';
const FIX = areas => ({
  usuarios: [{ id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true }],
  areas, sync_estado: [], config: [], proyectos: [], paginas: [], paginas_versiones: [],
  clientes: [{ id: C1, nombre: 'Hotel Playa SL', telefono: null, activo: true }],
  locales: [{ id: L1, cliente_id: C1, nombre: 'Hotel Playa', direccion: 'Adeje', activo: true, plan: null }],
  contactos: [], agenda: [], sesiones: [], documento_lineas: [], trabajo_comentarios: [], trabajo_fotos: [], tickets: [], checklist_respuestas: [], plantillas_checklist: [],
  trabajos: [{ id: W1, numero: 151, titulo: 'Montar cámaras', estado: 'Pendiente', cliente_id: C1, local_id: L1, contacto_id: null, tecnicos: [], descripcion: 'Cuatro cámaras', observaciones: 'Llevar escalera',
    created_at: new Date().toISOString(), fecha_programada: null, hora_llegada: null, presupuesto_id: null, zoho_invoice_number: null, duracion_teorica: null, materiales: null }],
  instalaciones: [], local_hardware: [], local_software: [], local_camaras: [],
  furgonetas: [{ id: 'f1', nombre: 'Furgo 1' }, { id: 'f2', nombre: 'Tienda' }],
  furgoneta_inventario: [
    { id: 'i1', furgoneta_id: 'f1', nombre: 'Cámara domo 4MP', cantidad: 6, precio: 45, categoria: 'CCTV', codigo_barra: '8412345678901', codigo_principal: null },
    { id: 'i2', furgoneta_id: 'f1', nombre: 'Cable UTP', cantidad: 3, precio: 0.5, categoria: 'Redes', codigo_barra: '777', codigo_principal: null },
    { id: 'i3', furgoneta_id: 'f2', nombre: 'Cable UTP', cantidad: 9, precio: 0.5, categoria: 'Redes', codigo_barra: '777', codigo_principal: null },
  ],
  catalogo: [
    { id: 'k1', nombre: 'Router 4G', categoria: 'Hardware', precio: 120, unidad: 'ud', referencia: 'R4G', descripcion: null, activo: true, zoho_item_id: 'z1' },
    { id: 'k2', nombre: 'Hora técnica', categoria: 'Servicio', precio: 40, unidad: 'h', referencia: null, descripcion: 'Mano de obra', activo: true, zoho_item_id: null },
    { id: 'k3', nombre: 'Viejo', categoria: 'Hardware', precio: 1, unidad: 'ud', referencia: null, descripcion: null, activo: false, zoho_item_id: null },
  ],
  conocimiento: [
    { id: 'a1', titulo: 'Manual Glop', categoria: 'TPV', tipo: 'pdf_drive', descripcion: 'Cierre de caja', url: 'https://drive.google.com/x', palabras_clave: 'cierre' },
    { id: 'a2', titulo: 'Hik-Connect alta', categoria: 'Cámaras', tipo: 'youtube', descripcion: null, url: 'https://youtube.com/watch?v=1', palabras_clave: null },
  ],
});
const RPC = { trabajo_estado: (c, db) => { db.trabajos.find(t => t.id === c.p_id).estado = c.p_estado; return null; } };
const APP = [
  { area: 'trabajos', tablas: ['trabajos', 'agenda', 'sesiones', 'documento_lineas', 'instalaciones'], dueno: 'app' },
  { area: 'inventario', tablas: ['catalogo', 'furgonetas', 'furgoneta_inventario', 'furgoneta_movimientos'], dueno: 'app' },
  { area: 'conocimiento', tablas: ['conocimiento', 'tablero_notas'], dueno: 'app' },
];

async function contexto(browser, areas) {
  const base = baseMemoria(FIX(areas), RPC);
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1400, height: 950 } });
  await preparar(ctx, { email: 'ana@ok.test', base });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e.stack ?? e)));
  page.on('dialog', d => d.accept());
  return { ctx, page, base, errores };
}
const toast = (page, txt) => page.waitForFunction(t => document.getElementById('toast')?.textContent.includes(t), txt);

const browser = await navegador();
const errores = [];
try {
  let C = await contexto(browser, []);
  let { page, base } = C;

  // ── Guía de instalación ─────────────────────────────────────────────────
  await page.goto(`${srv.base}/#/trabajos/151`);
  await page.waitForSelector('#gi-lista');
  await page.click('#gi-lista a.btn');
  await page.waitForSelector('.gi-tipos');
  ok(await page.locator('.gi-tipo').count() === 5 && !/[\u{1F300}-\u{1FAFF}]/u.test(await page.textContent('.gi-tipos')), 'guía: los cinco tipos de la app, sin emojis');
  await page.click('[data-action="giIniciar"][data-p0="camaras"]');
  await page.waitForSelector('#gi-form');
  const inst = base.db.instalaciones[0];
  ok(inst && inst.tipo === 'camaras' && inst.trabajo_id === W1 && inst.local_id === L1 && inst.tecnico_id === 'Ana Admin' && inst.completada === false, 'guía: elegir el tipo crea la instalación (de la sede del trabajo)');
  ok((await page.textContent('.gi-progreso')).includes('Paso 1 de 4'), 'guía: paso 1 de 4');
  await page.fill('#gi-c-ip_nvr', '192.168.1.50');
  await page.fill('#gi-c-pass_nvr', 'secreta');
  await page.click('#gi-siguiente');
  await page.waitForFunction(() => document.querySelector('.gi-progreso')?.textContent.includes('Paso 2 de 4'));
  ok(base.db.instalaciones[0].datos.camaras_red_cam_ip_nvr === '192.168.1.50', 'guía: cada paso se guarda con la clave de la app (<tipo>_<paso>_<campo>)');
  await page.fill('#gi-c-cam1_ip', '192.168.1.201');
  await page.fill('#gi-c-cam1_ubi', 'Entrada');
  await page.click('#gi-siguiente');
  await page.waitForFunction(() => document.querySelector('.gi-progreso')?.textContent.includes('Paso 3 de 4'));
  await page.click('#gi-siguiente');
  await page.waitForFunction(() => document.querySelector('.gi-progreso')?.textContent.includes('Paso 4 de 4'));
  ok((await page.textContent('#gi-form')).includes('OK') && !(await page.textContent('#gi-form')).includes('✅'), 'guía: las opciones se ven sin emoji');
  ok(await page.locator('#gi-form option[value="✅ OK"]').count() > 0, 'guía: … pero guardan el mismo valor que la app');
  await page.click('#gi-siguiente');
  await toast(page, 'Instalación completada');
  const fin = base.db.instalaciones[0], t = base.db.trabajos[0];
  ok(fin.completada === true && t.observaciones.startsWith('Llevar escalera\n\n[Videovigilancia]') && t.observaciones.includes('ip_nvr: 192.168.1.50'), 'finalizar: completada y el resumen en las observaciones del trabajo');
  ok(t.estado === 'En progreso', 'finalizar: el trabajo Pendiente pasa a «En progreso» (hub.trabajo_estado)');
  ok(base.db.local_hardware.some(h => h.tipo === 'NVR' && h.ip === '192.168.1.50' && h.local_id === L1)
    && base.db.local_camaras.some(c => c.ip === '192.168.1.201' && c.notas === 'Entrada' && c.contrasena === 'secreta'), 'finalizar: el NVR y las cámaras a la ficha de la sede');
  await page.waitForSelector('.gi-estado');
  const res = await page.textContent('.vista');
  ok(res.includes('192.168.1.50') && !res.includes('secreta') && res.includes('••••'), 'resumen: los datos, con las contraseñas tapadas');
  await page.click('.tarjeta-cab a[href$="/paso/0/r"]');
  await page.waitForSelector('#gi-form');
  ok((await page.textContent('#gi-siguiente')).includes('Guardar y volver'), 'resumen: editar un paso vuelve al resumen');
  await page.screenshot({ path: `${CAPTURAS}/guia-instalacion.png` });

  // ── Escáner del material ────────────────────────────────────────────────
  await page.goto(`${srv.base}/#/trabajos/151`);
  await page.waitForSelector('[data-action="trEscanear"]');
  ok((await page.textContent('#gi-lista')).includes('Videovigilancia') && (await page.textContent('#gi-lista')).includes('Completada'), 'ficha: la instalación en su sección');
  await page.click('[data-action="trEscanear"]');
  await page.waitForSelector('#esc-codigo');
  ok(await page.locator('#esc-video').count() === 0, 'escáner: sin BarcodeDetector, el campo para el lector de mano');
  await page.fill('#esc-codigo', '8412345678901');
  await page.press('#esc-codigo', 'Enter');
  await page.waitForFunction(() => document.querySelector('.tr-lineas')?.textContent.includes('Cámara domo 4MP'));
  ok(!(await page.locator('#esc-capa').count()), 'escáner: un código de un solo producto lo añade al material');
  await page.click('[data-action="trEscanear"]');
  await page.fill('#esc-codigo', '777');
  await page.press('#esc-codigo', 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('#tr-inv-res li').length === 2);
  ok((await page.textContent('#tr-inv-res')).includes('Tienda'), 'escáner: el mismo código en dos ubicaciones → elegir de dónde sale');
  await page.click('[data-action="trEscanear"]');
  await page.fill('#esc-codigo', '000');
  await page.press('#esc-codigo', 'Enter');
  await toast(page, 'no encontrado');
  ok(true, 'escáner: un código que no está lo dice');

  // ── Catálogo ────────────────────────────────────────────────────────────
  await page.goto(`${srv.base}/#/inventario/catalogo`);
  await page.waitForSelector('#cat-lista');
  let cat = await page.textContent('#cat-lista');
  ok(cat.includes('Router 4G') && cat.includes('Hora técnica') && cat.includes('Oculto') && cat.includes('120,00 €'), 'catálogo: por categoría, con precio y unidad (lo oculto lo ve el admin)');
  await page.click('[data-action="catFiltro"][data-p0="Servicio"]');
  await page.waitForFunction(() => !document.getElementById('cat-lista')?.textContent.includes('Router 4G'));
  await page.click('[data-action="catFiltro"][data-p0=""]');
  await page.waitForSelector('#cat-q');
  await page.fill('#cat-q', 'r4g');
  await page.waitForFunction(() => !document.getElementById('cat-lista')?.textContent.includes('Hora técnica'));
  ok(true, 'catálogo: filtro por categoría y buscador por referencia');
  await page.goto(`${srv.base}/#/inventario/catalogo/nuevo`);
  await page.waitForSelector('#cat-form');
  await page.fill('#cat-nombre', 'Switch 8 puertos'); await page.fill('#cat-precio', '35.5'); await page.selectOption('#cat-categoria', 'Redes');
  await page.click('#cat-form button[type="submit"]');
  await toast(page, 'Producto creado');
  ok(base.db.catalogo.some(p => p.nombre === 'Switch 8 puertos' && p.precio === 35.5 && p.categoria === 'Redes' && p.activo === true), 'catálogo: alta de un producto');
  await page.waitForSelector('[data-action="catSeleccionar"]');
  await page.fill('#cat-q', '');
  await page.click('[data-action="catSeleccionar"]');
  await page.waitForSelector('.cat-sel');
  await page.check('[data-on-change^="catMarcar:k1"]'); await page.check('[data-on-change^="catMarcar:k2"]');
  await page.selectOption('#cat-bloque-cat', 'Redes');
  await page.click('[data-action="catCambiarCategoria"]');
  await toast(page, 'Categoría cambiada');
  ok(['k1', 'k2'].every(id => base.db.catalogo.find(p => p.id === id).categoria === 'Redes'), 'catálogo: cambiar la categoría de varios a la vez');
  await page.screenshot({ path: `${CAPTURAS}/catalogo.png` });

  // ── Base de conocimiento ────────────────────────────────────────────────
  await page.goto(`${srv.base}/#/wiki/conocimiento`);
  await page.waitForSelector('#kc-cuerpo');
  ok((await page.getAttribute('#kc-cuerpo a[href^="https://drive"]', 'target')) === '_blank' && (await page.textContent('#kc-cuerpo')).includes('Hik-Connect'), 'conocimiento: los artículos, que se abren en su enlace');
  await page.click('[data-action="kcFiltro"][data-p0="TPV"]');
  await page.waitForFunction(() => !document.getElementById('kc-cuerpo')?.textContent.includes('Hik-Connect'));
  await page.goto(`${srv.base}/#/wiki/conocimiento/nuevo`);
  await page.waitForSelector('#kc-form');
  await page.fill('#kc-titulo', 'Reset Ajax'); await page.fill('#kc-url', 'https://youtube.com/watch?v=2'); await page.selectOption('#kc-categoria', 'Alarmas'); await page.selectOption('#kc-tipo', 'youtube');
  await page.click('#kc-form button[type="submit"]');
  await toast(page, 'Artículo guardado');
  ok(base.db.conocimiento.some(a => a.titulo === 'Reset Ajax' && a.categoria === 'Alarmas' && a.tipo === 'youtube'), 'conocimiento: alta de un artículo');
  errores.push(...C.errores);
  await C.ctx.close();

  // ── Con las áreas de la app ─────────────────────────────────────────────
  C = await contexto(browser, APP);
  ({ page } = C);
  await page.goto(`${srv.base}/#/trabajos/151`);
  await page.waitForSelector('.tr-lineas, .op-ficha');
  ok(await page.locator('#gi-lista a.btn').count() === 0 && await page.locator('[data-action="trEscanear"]').count() === 0, 'área de la app: sin guía nueva ni escáner (el material no se toca)');
  await page.goto(`${srv.base}/#/inventario/catalogo`);
  await page.waitForSelector('#cat-lista');
  ok(await page.isVisible('.area-app') && await page.locator('a[href="#/inventario/catalogo/nuevo"]').count() === 0, 'catálogo: con el área de la app, solo lectura');
  await page.goto(`${srv.base}/#/wiki/conocimiento`);
  await page.waitForSelector('#kc-cuerpo');
  ok(await page.isVisible('.area-app') && await page.locator('a[href="#/wiki/conocimiento/nuevo"]').count() === 0, 'conocimiento: con el área de la app, solo lectura');
  errores.push(...C.errores);
  await C.ctx.close();

  ok(!errores.length, `sin errores JS${errores.length ? ': ' + errores.join(' | ') : ''}`);
} finally {
  await browser.close();
  srv.parar();
}
if (!fallos()) console.log('\nTodo bien');
process.exit(fallos() ? 1 : 0);
