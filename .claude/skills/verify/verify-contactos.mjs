// Arnés de Contactos (#/contactos): listado con buscador, tipos, favoritos,
// etiquetas y de baja; ficha con datos, trabajos y tickets; solo lectura.
// Sobre comun.mjs (PostgREST en memoria): nunca contra datos reales.
//
//   npm run build && node .claude/skills/verify/verify-contactos.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS } from './comun.mjs';

const PUERTO = 4192;
const { ok, fallos, sumar } = contador();
const hace = h => new Date(Date.now() - h * 3600e3).toISOString();

const FIX = {
  usuarios: [{ id: 'u-fran', nombre: 'Fran Admin', email: 'admin@ok.test', rol: 'admin', activo: true }],
  sync_estado: [], config: [], clientes_crm: [],
  areas: [{ area: 'clientes', tablas: ['clientes', 'locales', 'contactos'], dueno: 'app' }],
  clientes: [{ id: 'c1', nombre: 'Polinesia Restaurante', activo: true }],
  locales: [{ id: 'l1', nombre: 'Polinesia · Playa del Duque', cliente_id: 'c1', activo: true }],
  contactos: [
    { id: 'p1', nombre: 'Ana Encargada', tipo: 'cliente', cargo: 'Encargada', telefono: '611 222 333', email: 'ana@poli.test', cliente_id: 'c1', local_id: 'l1', activo: true, favorito: true, etiquetas: ['TPV'], notas: 'Llamar por la mañana.' },
    { id: 'p2', nombre: 'Distribuidora Canarias', tipo: 'proveedor', empresa: 'DisCan SL', telefono: '922111222', activo: true, favorito: false, etiquetas: ['Hardware'] },
    { id: 'p3', nombre: 'Matteo Monastero', tipo: 'empleado', telefono: '600000000', activo: true, favorito: false, etiquetas: [] },
    { id: 'p4', nombre: 'Antiguo contacto', tipo: 'otro', activo: false, favorito: false, etiquetas: [] },
  ],
  trabajos: [
    { id: 't1', numero: 331, titulo: 'Instalar TPV nuevo', contacto_id: 'p1', estado: 'Pendiente', created_at: hace(5) },
    { id: 't2', numero: 332, titulo: 'De otro', contacto_id: 'p2', estado: 'Pendiente', created_at: hace(5) },
  ],
  tickets: [{ id: 'k1', numero: 5001, titulo: 'Impresora cocina', contacto_id: 'p1', estado: 'Abierto', created_at: hace(2) }],
  rmm_estado_local: [], rmm_equipos: [], oportunidades: [],
};

const srv = await servidor(PUERTO);
const browser = await navegador();
const filas = page => page.$$eval('#co-tabla tbody tr', trs => trs.map(t => t.textContent.replace(/\s+/g, ' ').trim()));
const cuantas = (page, n) => page.waitForFunction(k => document.querySelectorAll('#co-tabla tbody tr:not(:has(.vacio))').length === k, n);

try {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  const base = baseMemoria(FIX, { clases_clientes: () => [], linea_tiempo: () => [] });
  await preparar(ctx, { email: 'admin@ok.test', base });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));

  await page.goto(`${srv.base}/#/inicio`);
  await page.waitForSelector('#menu .menu-item');
  ok(!!(await page.$('#menu a[href="#/contactos"]')), 'Contactos sale en el menú');
  await page.goto(`${srv.base}/#/contactos`);
  await page.waitForSelector('#co-tabla');
  await cuantas(page, 3);
  const fa = (await filas(page)).find(f => f.includes('Ana Encargada')) ?? '';
  ok(fa.includes('Polinesia Restaurante') && fa.includes('Playa del Duque') && fa.includes('TPV'), 'fila con cliente, sitio y etiqueta');
  ok(!!(await page.$('#co-tabla a[href="tel:611 222 333"]')) && !!(await page.$('#co-tabla a[href="https://wa.me/34611222333"]')), 'llamar y WhatsApp desde la fila');
  ok(!!(await page.$('.aviso.area-app')), 'aviso de solo lectura');
  await page.screenshot({ path: `${CAPTURAS}/contactos-lista.png` });

  await page.click('[data-action="coTipo"][data-p0="proveedor"]');
  await cuantas(page, 1);
  ok((await filas(page))[0].includes('Distribuidora'), 'filtro por tipo: proveedores');
  await page.click('[data-action="coTipo"][data-p0="favorito"]');
  await cuantas(page, 1);
  ok((await filas(page))[0].includes('Ana'), 'filtro Favoritos');
  await page.click('[data-action="coTipo"][data-p0=""]');
  await cuantas(page, 3);
  await page.selectOption('#co-etiqueta', 'Hardware');
  await cuantas(page, 1);
  ok((await filas(page))[0].includes('Distribuidora'), 'filtro por etiqueta');
  await page.selectOption('#co-etiqueta', '');
  await cuantas(page, 3);
  await page.fill('#co-filtro', '611222');
  await cuantas(page, 1);
  ok((await filas(page))[0].includes('Ana'), 'buscar por teléfono sin espacios');
  await page.fill('#co-filtro', 'polinesia');
  await cuantas(page, 1);
  ok((await filas(page))[0].includes('Ana'), 'buscar por el nombre del cliente');
  await page.fill('#co-filtro', '');
  await cuantas(page, 3);
  await page.click('[data-action="coBaja"]');
  await cuantas(page, 1);
  ok((await filas(page))[0].includes('Antiguo'), '«De baja» enseña los dados de baja');
  await page.click('[data-action="coBaja"]');
  await cuantas(page, 3);

  await page.click('#co-tabla tbody tr:has-text("Ana Encargada") td:first-child');
  await page.waitForSelector('#co-cuerpo .me-grid');
  ok(await page.evaluate(() => location.hash) === '#/contactos/p1', 'la fila abre la ficha');
  const d = await page.textContent('#co-cuerpo');
  ok(d.includes('Encargada') && d.includes('ana@poli.test') && d.includes('Llamar por la mañana'), 'ficha con datos y notas');
  ok(!!(await page.$('#co-cuerpo a[href="#/clientes/c1"]')) && !!(await page.$('#co-cuerpo a[href="#/sitios/l1"]')), 'enlaza a su cliente y a su sitio');
  await page.screenshot({ path: `${CAPTURAS}/contactos-ficha.png` });
  await page.click('[data-action="coPestana"][data-p1="trabajos"]');
  await page.waitForFunction(() => document.querySelector('#co-cuerpo')?.textContent.includes('#331'));
  ok(!(await page.textContent('#co-cuerpo')).includes('#332'), 'trabajos: solo los suyos');
  await page.click('[data-action="coPestana"][data-p1="tickets"]');
  await page.waitForFunction(() => document.querySelector('#co-cuerpo')?.textContent.includes('#5001'));
  ok(true, 'tickets donde figura');

  await page.goto(`${srv.base}/#/sitios/l1/contactos`);
  await page.waitForSelector('#si-cuerpo a[href="#/contactos/p1"]');
  ok(true, 'el contacto de la ficha de Sitios enlaza a su ficha');
  await page.goto(`${srv.base}/#/clientes/c1/contactos`);
  await page.waitForSelector('#cl-cuerpo a[href="#/contactos/p1"]');
  ok(true, 'y el de la ficha del cliente también');

  ok(base.reg.escrituras.filter(e => e.metodo !== 'RPC').length === 0, 'Contactos no escribe nada');
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
