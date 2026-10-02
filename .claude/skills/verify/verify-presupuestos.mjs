// Arnés de Presupuestos (#/presupuestos): cifras (abiertos, sin respuesta,
// aceptado y tasa), importe por estado (la barra filtra), filtros, por persona,
// buscador y ficha con líneas y lo que enlaza; solo lectura.
// Sobre comun.mjs (PostgREST en memoria): nunca contra datos reales.
//
//   npm run build && node .claude/skills/verify/verify-presupuestos.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS } from './comun.mjs';

const PUERTO = 4194;
const { ok, fallos, sumar } = contador();
const dia = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };

const FIX = {
  usuarios: [{ id: 'u-fran', nombre: 'Fran Admin', email: 'admin@ok.test', rol: 'admin', activo: true }],
  sync_estado: [], config: [], clientes_crm: [],
  areas: [{ area: 'presupuestos', tablas: ['presupuestos'], dueno: 'app' }],
  clientes: [{ id: 'c1', nombre: 'Polinesia Restaurante', activo: true }, { id: 'c2', nombre: 'Bananas Cafetería', activo: true }],
  locales: [{ id: 'l1', nombre: 'Polinesia · Playa del Duque', cliente_id: 'c1', activo: true }],
  contactos: [{ id: 'p1', nombre: 'Ana Encargada', telefono: '611222333', activo: true }],
  oportunidades: [{ id: 'o1', titulo: 'TPV nuevo Polinesia' }],
  trabajos: [{ id: 'tr1', numero: 331, titulo: 'Instalar TPV nuevo', estado: 'Programado', presupuesto_id: 'b3' }],
  presupuestos: [
    { id: 'b1', numero_presupuesto: 'P-0101', titulo: 'Cámaras cocina', estado: 'Borrador', total: 850, fecha: dia(-2), created_at: dia(-2), tecnico_id: 'Fran', cliente_id: 'c2' },
    { id: 'b2', numero_presupuesto: 'P-0102', titulo: 'Red wifi terraza', estado: 'Enviado', total: 1200, fecha: dia(-20), created_at: dia(-20), tecnico_id: 'Matteo Monastero', cliente_id: 'c2' },
    { id: 'b3', numero_presupuesto: 'P-0103', titulo: 'TPV Glop dos puestos', estado: 'Aceptado', total: 2400.5, fecha: dia(-40), created_at: dia(-40), tecnico_id: 'Fran',
      cliente_id: 'c1', local_id: 'l1', contacto_id: 'p1', oportunidad_id: 'o1', zoho_estimate_id: 'z9', exigencias: 'Que funcione con la impresora de cocina.' },
    { id: 'b4', numero_presupuesto: 'P-0104', titulo: 'Servidor oficina', estado: 'Rechazado', total: 3000, fecha: dia(-60), created_at: dia(-60), tecnico_id: 'Fran', cliente_id: 'c1' },
    { id: 'b5', numero_presupuesto: 'P-0105', titulo: 'Impresora etiquetas', estado: 'Enviado', total: 300, fecha: dia(-3), created_at: dia(-3), tecnico_id: 'Fran', cliente_id: 'c1' },
  ],
  documento_lineas: [
    { id: 'd1', presupuesto_id: 'b3', nombre: 'TPV táctil 15"', cantidad: 2, precio: 900, subtotal: 1800, orden: 1, categoria: 'Hardware' },
    { id: 'd2', presupuesto_id: 'b3', nombre: 'Instalación y formación', cantidad: 1, precio: 443.46, subtotal: 443.46, orden: 2 },
    { id: 'd3', presupuesto_id: 'b2', nombre: 'Punto de acceso', cantidad: 3, precio: 400, subtotal: 1200, orden: 1 },
  ],
};

const srv = await servidor(PUERTO);
const browser = await navegador();
const filas = page => page.$$eval('#pp-tabla tbody tr', trs => trs.map(t => t.textContent.replace(/\s+/g, ' ').trim()));
const cuantas = (page, n) => page.waitForFunction(k => document.querySelectorAll('#pp-tabla tbody tr:not(:has(.vacio))').length === k, n);

try {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  const base = baseMemoria(FIX, { clases_clientes: () => [], linea_tiempo: () => [] });
  await preparar(ctx, { email: 'admin@ok.test', base });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));

  await page.goto(`${srv.base}/#/inicio`);
  await page.waitForSelector('#menu .menu-item');
  const enlace = await page.$('#menu a[href="#/presupuestos"]');
  ok(!!enlace && !(await enlace.getAttribute('target')), 'Presupuestos es pantalla del hub (ya no abre la app)');
  await page.goto(`${srv.base}/#/presupuestos`);
  await page.waitForSelector('#pp-tabla');
  await cuantas(page, 3);
  let fs = await filas(page);
  ok(fs[0].includes('P-0101') && fs.some(f => f.includes('P-0102')) && fs.some(f => f.includes('P-0105')), 'por defecto: abiertos (borrador y enviados)');
  ok(fs.find(f => f.includes('P-0102')).includes('20 d') && !fs.find(f => f.includes('P-0105')).includes(' d '), 'marca el enviado sin respuesta y no el reciente');
  ok(!!(await page.$('.aviso.area-app')), 'aviso de solo lectura (el área es de la app)');
  // es-ES no agrupa las cifras de cuatro dígitos (2350 €): se compara sin puntos.
  const cifras = await page.$$eval('.pp-cifras .di-cifra', cs => cs.map(c => c.textContent.replace(/\s+/g, ' ').replace(/\./g, '').trim()));
  ok(cifras[0].includes('2350 €'), `abiertos en euros (${cifras[0]})`);
  ok(cifras[1].includes('1') && cifras[1].includes('1200 €'), 'sin respuesta: uno, con su importe');
  ok(cifras[2].includes('2401 €'), `aceptado 12 meses (${cifras[2]})`);
  ok(cifras[3].includes('50 %'), 'tasa de aceptación 1 de 2');
  const barras = await page.$$eval('#pp-barras tr', trs => trs.map(t => [t.querySelector('th').textContent, t.querySelector('.barras-barra').style.width]));
  ok(barras.map(b => b[0]).join(',') === 'Borrador,Enviado,Aceptado,Rechazado', 'barras en el orden del recorrido');
  ok(parseFloat(barras[3][1]) === 100, 'la barra mayor (Rechazado, 3.000 €) llena la pista');
  await page.screenshot({ path: `${CAPTURAS}/presupuestos-lista.png` });

  await page.click('#pp-barras tr:has-text("Aceptado")');
  await cuantas(page, 1);
  ok((await filas(page))[0].includes('P-0103'), 'la barra filtra por su estado');
  for (const [k, n, txt, msg] of [['sin_respuesta', 1, 'P-0102', 'Sin respuesta'], ['Rechazado', 1, 'P-0104', 'Rechazados'], ['', 5, 'P-0104', 'Todos']]) {
    await page.click(`.chip-boton[data-action="ppFiltro"][data-p0="${k}"]`);
    await cuantas(page, n);
    ok((await filas(page)).some(f => f.includes(txt)), `filtro ${msg}`);
  }
  await page.selectOption('#pp-persona', '__mios');
  await cuantas(page, 4);
  ok(!(await filas(page)).some(f => f.includes('P-0102')), '«Los míos» (Fran por nombre de pila)');
  await page.selectOption('#pp-persona', 'Matteo Monastero');
  await cuantas(page, 1);
  await page.selectOption('#pp-persona', '');
  await page.fill('#pp-filtro', 'polinesia');
  await cuantas(page, 3);
  ok((await filas(page)).every(f => f.includes('Polinesia')), 'buscar por cliente');
  await page.fill('#pp-filtro', 'P-0103');
  await cuantas(page, 1);

  await page.click('#pp-tabla tbody tr');
  await page.waitForSelector('#pp-lineas');
  ok(await page.evaluate(() => location.hash) === '#/presupuestos/b3', 'la fila abre la ficha');
  const ficha = (await page.textContent('#pantalla')).replace(/(\d)\.(\d{3})/g, '$1$2');
  ok(ficha.includes('2400,50 €') && ficha.includes('impresora de cocina') && ficha.includes('En Zoho Books'), 'ficha con total, lo que pide el cliente y Zoho');
  ok(ficha.includes('suman 2243,46 €'), 'avisa de que las líneas suman sin impuestos');
  ok((await page.$$('#pp-lineas tbody tr')).length === 2, 'sus dos líneas (no las de otro)');
  for (const h of ['#/clientes/c1', '#/sitios/l1', '#/contactos/p1', '#/oportunidades/o1', '#/trabajos/tr1']) ok(!!(await page.$(`.me-grid a[href="${h}"]`)), `enlaza a ${h}`);
  await page.screenshot({ path: `${CAPTURAS}/presupuestos-ficha.png`, fullPage: true });

  // Tema noche: la barra sigue viéndose (lima sobre la pista).
  await page.goto(`${srv.base}/#/presupuestos`);
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForSelector('#pp-barras');
  const color = await page.$eval('.barras-barra', b => getComputedStyle(b).backgroundColor);
  ok(color === 'rgb(125, 217, 86)', `en noche la serie es lima (${color})`);
  await page.screenshot({ path: `${CAPTURAS}/presupuestos-noche.png` });

  ok(base.reg.escrituras.filter(e => e.metodo !== 'RPC').length === 0, 'Presupuestos no escribe nada');
  ok(base.reg.rest.every(r => r.perfil === 'hub'), 'todas las peticiones con Accept-Profile: hub');
  const inline = await page.evaluate(() => [...document.querySelectorAll('*')].filter(e => [...e.attributes].some(a => /^on[a-z]+$/.test(a.name))).length);
  ok(inline === 0, 'ningún on*= inline');

  // Móvil: sin desbordar a lo ancho.
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(200);
  const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
  ok(ancho <= 390, `en el móvil no desborda (${ancho}px)`);
  await page.screenshot({ path: `${CAPTURAS}/presupuestos-movil.png`, fullPage: true });
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
