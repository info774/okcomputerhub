// Arnés de Sitios (#/sitios): listado con buscador y filtros, ficha con sus
// pestañas, solo lectura, sobre comun.mjs (PostgREST en memoria).
//
//   npm run build && node .claude/skills/verify/verify-sitios.mjs
//
// Comprueba: la entrada del menú; lista con cliente, mantenimiento, TPV y
// equipos; buscar por cliente; filtros (sin mantenimiento, cobro torcido,
// equipos con aviso, de baja); la cuota solo para admin; la ficha (resumen,
// código de alarma oculto hasta pulsar, contactos, trabajos, tickets,
// equipos); la sede de la ficha del cliente enlaza aquí; que no escribe
// nada; Accept-Profile: hub; sin on*= inline; sin errores JS.
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS } from './comun.mjs';

const PUERTO = 4191;
const { ok, fallos, sumar } = contador();
const hace = h => new Date(Date.now() - h * 3600e3).toISOString();

const FIX = {
  usuarios: [
    { id: 'u-fran', nombre: 'Fran Admin', email: 'admin@ok.test', rol: 'admin', activo: true },
    { id: 'u-mat', nombre: 'Matteo Monastero', email: 'matteo@ok.test', rol: 'tecnico', activo: true },
  ],
  sync_estado: [], config: [],
  areas: [{ area: 'clientes', tablas: ['clientes', 'locales', 'contactos'], dueno: 'app' }],
  clientes: [
    { id: 'c1', nombre: 'Polinesia Restaurante', activo: true },
    { id: 'c2', nombre: 'Bananas Cafetería', activo: true },
  ],
  clientes_crm: [],
  locales: [
    { id: 'l1', nombre: 'Polinesia · Playa del Duque', cliente_id: 'c1', activo: true, estado: 'activo', direccion: 'C/ Londres 5, Adeje', plan: 'Premium', estado_pago: 'Al corriente', importe_mantenimiento: 84.53, programa_tpv: 'Ágora', lat: 28.09, lng: -16.74,
      horario: '12:00-24:00', notas_tecnicas: 'Router en el almacén.\nClave wifi en la caja.', alarma_empresa: 'Securitas', alarma_telefono: '902000000', alarma_codigo: '4321' },
    { id: 'l2', nombre: 'Bananas', cliente_id: 'c2', activo: true, estado: 'activo', plan: 'Silver', estado_pago: 'No paga', importe_mantenimiento: 49, programa_tpv: 'Revo' },
    { id: 'l3', nombre: 'Kiosco Playa', cliente_id: 'c2', activo: true, estado: 'activo', plan: 'Sin mantenimiento', estado_pago: 'Al corriente', programa_tpv: null },
    { id: 'l4', nombre: 'Local cerrado', cliente_id: 'c1', activo: false, estado: 'cerrado', plan: 'Sin mantenimiento' },
  ],
  contactos: [
    { id: 'p1', nombre: 'Ana Encargada', cargo: 'Encargada', telefono: '611222333', local_id: 'l1', cliente_id: 'c1', activo: true, favorito: true },
    { id: 'p2', nombre: 'Otro', local_id: 'l2', cliente_id: 'c2', activo: true },
  ],
  trabajos: [
    { id: 't1', numero: 331, titulo: 'Instalar TPV nuevo', local_id: 'l1', estado: 'Pendiente', tecnicos: ['Matteo'], created_at: hace(5) },
    { id: 't2', numero: 332, titulo: 'Otro sitio', local_id: 'l2', estado: 'Pendiente', tecnicos: [], created_at: hace(5) },
  ],
  tickets: [{ id: 'k1', numero: 5001, titulo: 'Impresora cocina', local_id: 'l1', estado: 'Abierto', prioridad: 'alta', created_at: hace(2) }],
  rmm_estado_local: [
    { local_id: 'l1', equipos: 2, conectados: 2, alertas: 0, visto_ultimo: hace(0.1), estado: 'ok' },
    { local_id: 'l2', equipos: 1, conectados: 0, alertas: 1, visto_ultimo: hace(30), estado: 'caido' },
  ],
  rmm_equipos: [
    { id: 'e1', hostname: 'TPV-CAJA1', so: 'Windows 11', conectado: true, local_id: 'l1', visto_ultimo: hace(0.1) },
    { id: 'e2', hostname: 'CAM-NVR', so: 'Linux', conectado: true, local_id: 'l1', visto_ultimo: hace(0.1) },
  ],
};

const srv = await servidor(PUERTO);
const browser = await navegador();
const nuevo = async (email = 'admin@ok.test') => {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  const base = baseMemoria(FIX, { clases_clientes: () => [], linea_tiempo: () => [] });
  await preparar(ctx, { email, base });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
  return { ctx, page, base, errores };
};
const n1 = page => page.waitForFunction(() => document.querySelectorAll('#si-tabla tbody tr').length === 1);
const filas = page => page.$$eval('#si-tabla tbody tr', trs => trs.map(t => t.textContent.replace(/\s+/g, ' ').trim()));

try {
  {
    const { ctx, page, base, errores } = await nuevo();
    await page.goto(`${srv.base}/#/inicio`);
    await page.waitForSelector('#menu .menu-item');
    ok(!!(await page.$('#menu a[href="#/sitios"]')), 'Sitios sale en el menú');
    await page.goto(`${srv.base}/#/sitios`);
    await page.waitForSelector('#si-tabla');
    let fs = await filas(page);
    ok(fs.length === 3, `lista con los 3 sitios de alta (${fs.length})`);
    const fb = fs.find(f => f.startsWith('Bananas')) ?? '';
    ok(fb.includes('Bananas Cafetería') && fb.includes('No paga') && fb.includes('49,00 €'), 'fila con cliente, plan, cuota (admin) y cobro torcido');
    ok(!!(await page.$('.aviso.area-app')), 'aviso de solo lectura (el área es de la app)');
    await page.screenshot({ path: `${CAPTURAS}/sitios-lista.png` });

    await page.fill('#si-filtro', 'polinesia');
    await page.waitForFunction(() => document.querySelectorAll('#si-tabla tbody tr').length === 1);
    ok((await filas(page))[0].includes('Playa del Duque'), 'buscar por el nombre del cliente');
    await page.fill('#si-filtro', '');
    await page.waitForFunction(() => document.querySelectorAll('#si-tabla tbody tr').length === 3);
    await page.click('[data-action="siMant"][data-p0="sin"]');
    await n1(page);
    fs = await filas(page);
    ok(fs.length === 1 && fs[0].includes('Kiosco'), 'filtro «Sin mantenimiento»');
    await page.click('[data-action="siMant"][data-p0=""]');
    await page.click('[data-action="siAviso"][data-p0="cobro"]');
    await n1(page);
    fs = await filas(page);
    ok(fs.length === 1 && fs[0].includes('Bananas'), 'filtro «Cobro torcido»');
    await page.click('[data-action="siAviso"][data-p0="equipos"]');
    await n1(page);
    fs = await filas(page);
    ok(fs.length === 1 && fs[0].includes('Bananas') && fs[0].includes('0/1'), 'filtro «Equipos con aviso»');
    await page.click('[data-action="siAviso"][data-p0=""]');
    await page.click('[data-action="siBaja"]');
    await page.waitForFunction(() => document.querySelector('#si-tabla tbody')?.textContent.includes('Local cerrado'));
    ok((await filas(page)).length === 1, '«De baja» enseña solo los dados de baja');
    await page.click('[data-action="siBaja"]');
    await page.waitForFunction(() => document.querySelectorAll('#si-tabla tbody tr').length === 3);

    // Ficha
    await page.click('#si-tabla tbody tr:has-text("Playa del Duque")');
    await page.waitForSelector('#si-cuerpo .me-grid');
    ok(await page.evaluate(() => location.hash) === '#/sitios/l1', 'la fila abre la ficha');
    const res = await page.textContent('#si-cuerpo');
    ok(res.includes('Premium') && res.includes('84,53 €') && res.includes('Ágora') && res.includes('Todo en línea') && res.includes('Router en el almacén'), 'resumen: mantenimiento, TPV, equipos y notas técnicas');
    ok(!res.includes('4321'), 'el código de la alarma no se ve hasta pulsar');
    await page.click('[data-action="siCodigo"]');
    ok((await page.textContent('#si-codigo')) === '4321', '«Ver» enseña el código de la alarma');
    ok((await page.getAttribute('.tarjeta-cab a[href*="google.com/maps"]', 'href')).includes('28.09,-16.74'), '«Cómo llegar» con las coordenadas');
    ok(await page.getAttribute('.nota a[href="#/clientes/c1"]', 'href') === '#/clientes/c1', 'enlace a la ficha del cliente');
    await page.screenshot({ path: `${CAPTURAS}/sitios-ficha.png` });
    for (const [p, txt, sin] of [['contactos', 'Ana Encargada', 'Otro'], ['trabajos', '#331', '#332'], ['tickets', '#5001', null], ['equipos', 'TPV-CAJA1', null]]) {
      await page.click(`[data-action="siPestana"][data-p1="${p}"]`);
      await page.waitForFunction(t => document.querySelector('#si-cuerpo')?.textContent.includes(t), txt);
      const t = await page.textContent('#si-cuerpo');
      ok(!sin || !t.includes(sin), `pestaña ${p}: solo lo de este sitio`);
    }
    await page.click('#si-cuerpo tbody tr');
    await page.waitForFunction(() => location.hash === '#/monitorizacion/equipo/e1');
    ok(true, 'un equipo abre su ficha en Monitorización');

    // Sedes de la ficha del cliente → Sitios
    await page.goto(`${srv.base}/#/clientes/c2/sedes`);
    await page.waitForSelector('#cl-cuerpo a[href="#/sitios/l2"]');
    ok(true, 'la sede en la ficha del cliente enlaza a su ficha de Sitios');

    ok(base.reg.escrituras.filter(e => e.metodo !== 'RPC').length === 0, 'Sitios no escribe nada');
    ok(base.reg.rest.every(r => r.perfil === 'hub'), 'todas las peticiones con Accept-Profile: hub');
    const inline = await page.evaluate(() => [...document.querySelectorAll('*')].filter(e => [...e.attributes].some(a => /^on[a-z]+$/.test(a.name))).length);
    ok(inline === 0, 'ningún on*= inline');
    ok(errores.length === 0, `sin errores JS${errores.length ? ': ' + errores.join(' | ') : ''}`);
    await ctx.close();
  }
  {
    const { ctx, page } = await nuevo('matteo@ok.test');
    await page.goto(`${srv.base}/#/sitios`);
    await page.waitForSelector('#si-tabla');
    ok(!(await page.textContent('#si-tabla')).includes('49,00'), 'un técnico no ve la cuota');
    await page.goto(`${srv.base}/#/sitios/l1`);
    await page.waitForSelector('#si-cuerpo .me-grid');
    ok(!(await page.textContent('#si-cuerpo')).includes('84,53'), 'ni en la ficha');
    await ctx.close();
  }
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
