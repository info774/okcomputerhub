// Arnés del modo escritorio (shell/escritorio.ts) y de la paleta Ctrl+K con
// modos, sobre comun.mjs (PostgREST en memoria): nunca contra datos reales.
//
//   npm run build && node .claude/skills/verify/verify-escritorio.mjs
//
// Comprueba: entrar desde el menú y por ?os=1; barra, dock, widgets con datos
// del espejo (Hoy, Avisos con el motor panorama_direccion, Cobros solo admin,
// Equipos, Agenda con «Sin técnico»); widgets que se arrastran, se recuerdan
// y se recolocan; una ventana por módulo que se abre por
// el dock y por la URL; arrastrar al borde encaja a media pantalla; atajos
// Alt+Mayús; minimizar/restaurar/cerrar; escritorios con nombre que se
// recuerdan al recargar; centro de avisos; lanzador «Todas»; paleta en modo
// Datos, Preguntar y Claude; volver a la app clásica; un técnico sin Cobros;
// que por debajo de 1024 px no entra; tema noche; Accept-Profile: hub; sin
// on*= inline; sin errores JS. Desde el 2026-10-03: el escritorio es la
// entrada por defecto (sin preferencia guardada), lleva las piezas de Oki como
// widgets (voz, Oki dice, estadísticas, órdenes), «Oki» en el dock abre la
// portada en su ventana y el chat de WhatsApp plegado es solo un botón.
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS } from './comun.mjs';

const PUERTO = 4186;
const { ok, fallos, sumar } = contador();
const hoy = new Date();
const a = (h, m = 0) => { const d = new Date(hoy); d.setHours(h, m, 0, 0); return d.toISOString(); };

const FIX = {
  usuarios: [
    { id: 'u-fran', nombre: 'Fran Admin', email: 'admin@ok.test', rol: 'admin', activo: true },
    { id: 'u-mat', nombre: 'Matteo Monastero', email: 'matteo@ok.test', rol: 'tecnico', activo: true },
  ],
  sync_estado: [{ clave: 'audit', ultima_ok: new Date(Date.now() - 4 * 60000).toISOString(), ultimo_error: null }],
  areas: [], config: [],
  clientes: [
    { id: 'c1', nombre: 'Polinesia Restaurante', telefono: '922000001', activo: true, zoho_id: 'z1' },
    { id: 'c2', nombre: 'Bananas Cafetería', telefono: '922000002', activo: true, zoho_id: 'z2' },
  ],
  clientes_crm: [],
  locales: [
    { id: 'l1', nombre: 'Polinesia · Playa del Duque', cliente_id: 'c1', activo: true, estado_pago: 'Al corriente', importe_mantenimiento: 84.53 },
    { id: 'l2', nombre: 'Bananas', cliente_id: 'c2', activo: true, estado_pago: 'Pendiente de pago', importe_mantenimiento: 49 },
    { id: 'l3', nombre: 'Kiosco Playa', cliente_id: 'c2', activo: true, estado_pago: 'No paga', importe_mantenimiento: 41.73 },
  ],
  trabajos: [
    { id: 't1', numero: 331, titulo: 'Instalar TPV nuevo', cliente_id: 'c2', estado: 'Pendiente', tecnicos: ['Matteo'] },
    { id: 't2', numero: 412, titulo: 'Impresora cocina', cliente_id: 'c1', estado: 'Pendiente', tecnicos: [] },
  ],
  agenda: [
    { id: 'a1', trabajo_id: 't1', inicio: a(9), fin: a(12), tecnicos: ['Matteo'], todo_el_dia: false },
    { id: 'a2', trabajo_id: 't2', inicio: a(13), fin: a(14), tecnicos: [], todo_el_dia: false },
    { id: 'a3', trabajo_id: null, titulo: 'Llamar Las Chafiras', inicio: a(10), fin: a(10, 30), tecnicos: ['Fran'], todo_el_dia: false },
  ],
  tickets: [
    { id: 'k1', numero: 412, titulo: 'Impresora cocina no saca', estado: 'Abierto', tecnico_id: null, prioridad: 'alta' },
    { id: 'k2', numero: 413, titulo: 'Cajón portamonedas', estado: 'Abierto', tecnico_id: 'Matteo', prioridad: 'media' },
  ],
  tareas: [{ id: 'ta1', titulo: 'Exportar tickets', estado: 'pendiente' }],
  cobros_recordatorios: [{ id: 'r1', estado: 'pendiente', saldo: 1240 }],
  rmm_equipos: [
    { id: 'e1', hostname: 'TPV-CAJA1', conectado: false, local_id: 'l3' },
    { id: 'e2', hostname: 'TPV-1', conectado: true, local_id: 'l2' },
    { id: 'e3', hostname: 'CAM-NVR', conectado: true, local_id: 'l1' },
  ],
  rmm_alertas: [{ id: 'al1', hostname: 'SRV-NAS', sitio: 'Ferretería', severidad: 'high', titulo: 'Disco al 91 %', estado: 'active', disparada: a(8) }],
  proyectos: [
    { id: 'p1', numero: 12, titulo: 'Migrar la wiki de Notion', estado: 'investigacion', prioridad: 'media', tipo: 'interno', orden: 0, created_at: a(7), updated_at: a(7) },
    { id: 'p2', numero: 11, titulo: 'Monitorización sobre Breeze', estado: 'en_marcha', prioridad: 'alta', tipo: 'interno', orden: 0, created_at: a(7), updated_at: a(7) },
  ],
  proyecto_objetivos: [], proyecto_hitos: [], proyecto_paginas: [], proyecto_tareas: [], proyecto_vinculos: [], claude_peticiones: [],
  auditoria: [], zoho_facturas: [], informes_programados: [], paginas: [], documentos: [], mcp_tokens: [], oportunidades: [], presupuestos: [],
  rmm_sitios: [], rmm_acciones: [],
};
const AVISOS = [
  { clave: 'f1', tipo: 'factura_vencida', gravedad: 'mal', titulo: 'Factura vencida: F26-0891', detalle: 'Polinesia · 21 días', importe: 1240, enlace: 'https://books.zoho.eu/x', fecha: a(6), persona: null, dinero: true },
  { clave: 'k1', tipo: 'ticket_sin_asignar', gravedad: 'mal', titulo: 'Ticket sin asignar: #412 Impresora cocina', detalle: 'Polinesia · prioridad alta', importe: null, enlace: 'https://okcomputertenerife.web.app', fecha: a(6), persona: null, dinero: false },
  { clave: 'p1', tipo: 'presupuesto_sin_respuesta', gravedad: 'aviso', titulo: 'Presupuesto sin respuesta: P-141', detalle: 'Bananas · enviado el 21/09', importe: 3900, enlace: null, fecha: a(6), persona: 'Matteo', dinero: false },
];
const RPC = {
  panorama_direccion: (_c, db) => AVISOS,
  direccion_resumen: () => null,
  clases_clientes: () => [],
};

const srv = await servidor(PUERTO);
const browser = await navegador();
const nuevo = async ({ email = 'admin@ok.test', ancho = 1440, os = true, defecto = false } = {}) => {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: ancho, height: 900 } });
  const base = baseMemoria(FIX, RPC);
  await preparar(ctx, { email, base, escritorio: defecto ? 'defecto' : 'clasico' });
  if (os) await ctx.addInitScript(() => localStorage.setItem('hub_escritorio', '1'));
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
  page.on('dialog', d => d.accept(d.type() === 'prompt' ? 'Ventas' : undefined));
  return { ctx, page, base, errores };
};

try {
  // 1. Entrar desde el menú del hub clásico
  {
    const { ctx, page, errores } = await nuevo({ os: false });
    await page.goto(srv.base);
    await page.waitForSelector('#menu .menu-item');
    ok(!(await page.$('#os-root')), 'sin activarlo, el hub clásico de siempre');
    await page.click('.menu-escritorio');
    await page.waitForSelector('#os-root');
    ok(await page.evaluate(() => localStorage.getItem('hub_escritorio')) === '1', 'el botón del menú enciende el modo escritorio y lo recuerda');
    ok(!(await page.isVisible('.cabecera')), 'la cabecera clásica se aparta');
    ok(errores.length === 0, `sin errores JS al entrar${errores.length ? ': ' + errores.join(' | ') : ''}`);
    await ctx.close();
  }

  // 2. Escritorio del admin: widgets, ventanas, ajuste, escritorios, avisos, paleta
  {
    const { ctx, page, base, errores } = await nuevo();
    await page.goto(srv.base);
    await page.waitForSelector('#os-root');
    await page.waitForFunction(() => document.querySelector('#os-hoy-cifras b')?.textContent === '3');
    ok(true, 'widget Hoy: 3 bloques de agenda hoy');
    const cifras = await page.$$eval('#os-hoy-cifras b', bs => bs.map(b => b.textContent));
    ok(cifras.join(',') === '3,2,1,1', `Hoy: bloques, tickets, sin técnico, tareas (${cifras.join(',')})`);
    await page.waitForFunction(() => document.querySelector('#os-bell-n')?.textContent === '3');
    ok(true, 'campana con 3 avisos del motor panorama_direccion');
    ok((await page.textContent('#os-avisos-lista')).includes('F26-0891'), 'widget Avisos con la factura vencida');
    await page.waitForFunction(() => document.querySelector('#os-cobros .os-cifra')?.textContent.includes('175'));
    ok(true, 'widget Cobros: suma de cuotas (175 €)');
    const cob = await page.$$eval('#os-cobros .os-cifras b', bs => bs.map(b => b.textContent));
    ok(cob.slice(0, 3).join(',') === '1,1,1', `Cobros: al corriente, pendientes, impagadas (${cob.join(',')})`);
    await page.waitForFunction(() => document.querySelector('.os-anillo-n')?.textContent === '2');
    ok(true, 'widget Equipos: 2 de 3 en línea');
    ok((await page.textContent('#os-equipos')).includes('SRV-NAS'), 'widget Equipos enseña la alerta activa');
    await page.waitForFunction(() => document.querySelectorAll('#os-agenda .os-fila').length === 3);
    const sin = await page.$$eval('#os-agenda .os-fila.os-sin', fs => fs.map(f => f.textContent));
    ok(sin.length === 1 && sin[0].includes('#412') && sin[0].includes('Asignar'), 'agenda: el bloque sin técnico va marcado con «Asignar»');
    ok((await page.textContent('#os-agenda')).includes('Bananas Cafetería'), 'agenda: el cliente del trabajo sale por su nombre');
    ok((await page.textContent('#os-sync')).includes('Sync hace'), 'chip de sync en la barra');
    await page.screenshot({ path: `${CAPTURAS}/escritorio-dia.png` });

    // Widgets movibles: se arrastran, los demás no se mueven, se recuerdan y se recolocan
    const caja = sel => page.$eval(sel, e => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y) }; });
    const antesAvisos = await caja('#os-w-avisos');
    const antesEquipos = await caja('#os-w-equipos');
    await page.mouse.move(antesEquipos.x + 40, antesEquipos.y + 14);
    await page.mouse.down();
    await page.mouse.move(antesEquipos.x + 80, antesEquipos.y + 40, { steps: 4 });
    await page.mouse.move(1100, 520, { steps: 8 });
    await page.mouse.up();
    const trasEquipos = await caja('#os-w-equipos');
    ok(Math.abs(trasEquipos.x - (1100 - 40)) < 6 && Math.abs(trasEquipos.y - (520 - 14)) < 6, `el widget Equipos se arrastra donde se suelta (${trasEquipos.x},${trasEquipos.y})`);
    const trasAvisos = await caja('#os-w-avisos');
    ok(trasAvisos.x === antesAvisos.x && trasAvisos.y === antesAvisos.y, 'los demás widgets se quedan donde estaban');
    ok(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('hub_os_')))).escritorios[0].widgets ?? {}).length >= 5), 'el sitio de los widgets se guarda en la disposición');
    await page.reload();
    await page.waitForSelector('#os-w-equipos');
    const recargado = await caja('#os-w-equipos');
    ok(recargado.x === trasEquipos.x && recargado.y === trasEquipos.y, 'al recargar el widget sigue donde se dejó');
    await page.screenshot({ path: `${CAPTURAS}/escritorio-widgets.png` });
    await page.click('[data-action="osMenu"]');
    await page.click('[data-action="osRecolocarWidgets"]');
    const recolocado = await caja('#os-w-equipos');
    ok(recolocado.x === antesEquipos.x && recolocado.y === antesEquipos.y && !(await page.$('#os-widgets.libre')), '«Recolocar los widgets» los devuelve a la rejilla');

    // Ventanas por el dock y por la URL
    await page.click('.os-ditem[data-p0="proyectos"]');
    await page.waitForSelector('#os-win-proyectos .pr-kanban');
    ok(true, 'el dock abre Proyectos en una ventana con su kanban');
    ok(await page.evaluate(() => location.hash) === '#/proyectos', 'la URL sigue mandando (#/proyectos)');
    await page.goto(`${srv.base}/#/monitorizacion`);
    await page.waitForSelector('#os-win-monitorizacion');
    ok((await page.$$('.os-win')).length === 2, 'dos ventanas: Proyectos y Monitorización');
    ok(await page.$eval('#os-win-monitorizacion', e => e.classList.contains('activa')), 'la última abierta va delante');
    ok(await page.$eval('.os-ditem[data-p0="proyectos"]', e => e.classList.contains('abierta')), 'el dock marca Proyectos como abierta');

    // Arrastrar al borde izquierdo → media pantalla
    const cab = await page.$('#os-win-monitorizacion .os-win-cab');
    const r = await cab.boundingBox();
    await page.mouse.move(r.x + 120, r.y + 20);
    await page.mouse.down();
    await page.mouse.move(r.x + 60, r.y + 60, { steps: 4 });
    await page.mouse.move(4, 400, { steps: 8 });
    ok(await page.evaluate(() => document.body.dataset.osSnap) === 'izq', 'la guía de ajuste aparece al acercarse al borde');
    await page.mouse.up();
    const geo = await page.$eval('#os-win-monitorizacion', e => [e.offsetLeft, e.offsetWidth]);
    const area = await page.$eval('#os-escritorio', e => e.clientWidth);
    ok(geo[0] < 12 && Math.abs(geo[1] - area / 2) < 20, `soltar en el borde encaja a la mitad izquierda (${geo[1]} de ${area})`);
    await page.keyboard.press('Alt+Shift+ArrowRight');
    ok((await page.$eval('#os-win-monitorizacion', e => e.offsetLeft)) > area / 2 - 12, 'Alt+Mayús+→ la pasa a la derecha');
    await page.keyboard.press('Alt+Shift+ArrowUp');
    ok(await page.$eval('#os-win-monitorizacion', e => e.classList.contains('max')), 'Alt+Mayús+↑ maximiza');
    await page.dblclick('#os-win-monitorizacion .os-win-cab');
    ok(!(await page.$eval('#os-win-monitorizacion', e => e.classList.contains('max'))), 'doble clic en el título restaura');
    await page.screenshot({ path: `${CAPTURAS}/escritorio-ventanas.png` });

    // Minimizar, restaurar y cerrar
    await page.click('#os-win-monitorizacion [data-action="osMinimizar"]');
    ok(!(await page.isVisible('#os-win-monitorizacion')), 'minimizar la esconde');
    ok(await page.$eval('#os-win-proyectos', e => e.classList.contains('activa')), 'y la de detrás pasa delante');
    await page.click('.os-ditem[data-p0="monitorizacion"]');
    ok(await page.isVisible('#os-win-monitorizacion'), 'el dock la restaura');
    await page.click('#os-win-monitorizacion [data-action="osCerrar"]');
    ok(!(await page.$('#os-win-monitorizacion')), 'cerrar la quita');
    ok(await page.evaluate(() => location.hash) === '#/inicio', 'cerrar la ventana de la URL actual vuelve al panel');

    // Escritorios con nombre
    await page.click('[data-action="osNuevoEscritorio"]');
    await page.waitForFunction(() => document.querySelectorAll('.os-esc:not(.os-esc-mas)').length === 2);
    ok((await page.textContent('#os-escritorios')).includes('Ventas'), 'escritorio nuevo con nombre');
    ok((await page.$$('.os-win')).length === 0, 'el escritorio nuevo empieza vacío');
    await page.goto(`${srv.base}/#/clientes`);
    await page.waitForSelector('#os-win-clientes');
    await page.reload();
    await page.waitForSelector('#os-win-clientes');
    ok((await page.textContent('.os-esc.activo')).includes('Ventas') && (await page.$$('.os-win')).length === 1, 'al recargar sigue en «Ventas» con su ventana');
    await page.click('.os-esc[data-p0="0"]');
    await page.waitForSelector('#os-win-proyectos');
    ok(!(await page.$('#os-win-clientes')), 'cambiar de escritorio cambia de ventanas');

    // Centro de avisos, lanzador
    await page.click('#os-bell');
    await page.waitForSelector('#os-avisos:not([hidden])');
    ok((await page.$$('#os-avisos .os-av')).length === 3, 'centro de avisos con los 3');
    await page.click('[data-action="osAvisosMios"][data-p0="1"]');
    ok((await page.$$('#os-avisos .os-av')).length === 0, '«Los míos» filtra por persona (Fran no tiene ninguno)');
    await page.screenshot({ path: `${CAPTURAS}/escritorio-avisos.png` });
    await page.click('#os-avisos [data-action="osAvisos"]');
    await page.click('.os-ditem[data-p0="1"][data-action="osLanzador"]');
    await page.waitForSelector('#os-lanzador:not([hidden])');
    const lanz = await page.$$eval('.os-litem', as => as.map(a => a.textContent.trim()));
    ok(lanz.some(t => t.includes('Proyectos')) && lanz.some(t => t.includes('Calendario')), 'lanzador con las del hub y las de la app actual');
    await page.click('.os-lanzador-fondo', { position: { x: 10, y: 10 } });
    ok(await page.$eval('#os-lanzador', e => e.hidden), 'un clic fuera cierra el lanzador');

    // Paleta Ctrl+K: Datos, Preguntar, Claude
    await page.keyboard.press('Control+k');
    await page.waitForSelector('#buscador[open]');
    await page.keyboard.press('Tab');
    ok(await page.$eval('.bus-modo.activo', e => e.textContent.includes('Datos')), 'Tab pasa al modo Datos');
    await page.fill('#bus-campo', 'poli');
    await page.waitForFunction(() => document.querySelector('#bus-resultados a')?.textContent.includes('Polinesia'));
    const datos = await page.$$eval('#bus-resultados a', as => as.map(a => a.getAttribute('href')));
    ok(datos.includes('#/clientes/c1'), 'Datos encuentra el cliente y enlaza a su ficha');
    await page.click('[data-action="busModo"][data-p0="preguntar"]');
    await page.fill('#bus-campo', 'qué TPV tiene Bananas');
    ok(await page.$eval('#bus-resultados a', a => a.getAttribute('href')) === '#/buscar/qu%C3%A9%20TPV%20tiene%20Bananas', 'Preguntar lleva la pregunta a Buscar');
    await page.fill('#bus-campo', '');
    await page.click('[data-action="busModo"][data-p0="claude"]');
    await page.waitForFunction(() => document.querySelectorAll('#bus-resultados a').length === 2);
    ok(await page.$eval('#bus-resultados a', a => a.getAttribute('href')) === '#/proyectos/12/claude', 'Pedir a Claude lista los proyectos abiertos y abre su pestaña Claude');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#os-win-proyectos .pestanas');
    ok(await page.evaluate(() => location.hash) === '#/proyectos/12/claude', 'Enter abre la ficha en su ventana');
    await page.screenshot({ path: `${CAPTURAS}/escritorio-paleta.png` });

    // Tema noche
    await page.click('#os-root [data-action="alternarTema"]');
    const tema = await page.evaluate(() => document.documentElement.dataset.theme);
    ok(tema === 'dark' || tema === 'light', `tema cambia desde la barra (${tema})`);
    if (tema !== 'dark') await page.click('#os-root [data-action="alternarTema"]');
    await page.screenshot({ path: `${CAPTURAS}/escritorio-noche.png` });

    // Volver a la app clásica
    await page.click('[data-action="osMenu"]');
    await page.click('[data-action="osSalir"]');
    await page.waitForSelector('.cabecera', { state: 'visible' });
    ok(!(await page.$('#os-root')) && await page.evaluate(() => localStorage.getItem('hub_escritorio')) === '0', 'volver a la app clásica apaga el modo y se recuerda');
    await page.waitForSelector('#pantalla .pestanas');
    ok(true, 'la pantalla actual se repinta en el hub clásico');

    ok(base.reg.rest.length > 0 && base.reg.rest.every(r => r.perfil === 'hub'), `todas las peticiones REST con Accept-Profile: hub (${base.reg.rest.length})`);
    ok(base.reg.escrituras.filter(e => e.metodo !== 'RPC').length === 0, 'el escritorio no escribe nada');
    const inline = await page.evaluate(() => [...document.querySelectorAll('*')].filter(e => [...e.attributes].some(a => /^on[a-z]+$/.test(a.name))).length);
    ok(inline === 0, 'ningún on*= inline en el DOM');
    ok(errores.length === 0, `sin errores JS${errores.length ? ': ' + errores.join(' | ') : ''}`);
    await ctx.close();
  }

  // 2 bis. Entrada por defecto y piezas de Oki
  {
    const { ctx, page, errores } = await nuevo({ os: false, defecto: true });
    await page.goto(srv.base);
    await page.waitForSelector('#os-root');
    ok(true, 'sin preferencia guardada, a 1440 px se entra al modo escritorio');
    for (const [id, que] of [['os-w-voz', 'Voz de Oki'], ['os-w-dice', 'Oki dice'], ['os-w-stats', 'Estadísticas'], ['os-w-ordenes', 'Órdenes rápidas']]) {
      ok(await page.isVisible(`#${id}`), `widget ${que}`);
    }
    await page.waitForFunction(() => document.querySelector('#os-dice .ok-dice-txt p')?.textContent.includes('3 cosas'));
    ok((await page.textContent('#os-dice')).includes('F26-0891') && await page.locator('#os-dice a[href="#/direccion"]').count() >= 1,
      'Oki dice: lo más urgente (la factura vencida) desde el mismo motor de avisos');
    await page.waitForSelector('#os-w-stats .ok-titular');
    ok((await page.textContent('#os-w-stats')).includes('Trabajos completados'), 'widget Estadísticas con trabajos completados');
    ok(await page.locator('#os-w-ordenes .ok-orden').count() === 6, 'widget Órdenes rápidas: 6 atajos');
    // Los widgets nuevos también se arrastran y se recuerdan
    const caja = await page.locator('#os-w-voz').boundingBox();
    await page.mouse.move(caja.x + caja.width / 2, caja.y + 12);
    await page.mouse.down();
    await page.mouse.move(caja.x + caja.width / 2 + 200, caja.y + 160, { steps: 8 });
    await page.mouse.up();
    const pos = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('hub_os_')))).escritorios[0].widgets ?? {}).length);
    ok(pos >= 4, `arrastrar el widget de voz congela y guarda el sitio de todos (${pos})`);
    // «Oki» en el dock: la portada en su ventana
    await page.click('[data-action="osOki"]');
    await page.waitForSelector('#os-win-inicio .ok-portada');
    ok(await page.isVisible('#os-win-inicio .ok-escena') && await page.locator('#os-win-inicio .ok-voz[data-voz="portada"]').count() === 1, '«Oki» abre la portada de Oki como ventana');
    ok(await page.locator('#os-dock .os-oki.abierta').count() === 1, 'el dock marca la ventana de Oki abierta');
    // WhatsApp plegado: solo el botón
    const wa = await page.locator('#wa.cerrado').boundingBox();
    ok(wa && wa.width <= 64 && wa.height <= 64, `chat de WhatsApp plegado como botón (${Math.round(wa?.width)}×${Math.round(wa?.height)})`);
    await page.screenshot({ path: `${CAPTURAS}/escritorio-oki.png` });
    // Volver al clásico se recuerda al recargar
    await page.click('[data-action="osMenu"]');
    await page.click('[data-action="osSalir"]');
    await page.reload();
    await page.waitForSelector('#menu .menu-item');
    ok(!(await page.$('#os-root')), 'quien vuelve a la app clásica se queda en ella al recargar');
    ok(errores.length === 0, `sin errores JS${errores.length ? ': ' + errores.join(' | ') : ''}`);
    await ctx.close();
  }

  // 3. ?os=1 en la URL enciende; un técnico no ve Cobros; por debajo de 1024 no entra
  {
    const { ctx, page } = await nuevo({ email: 'matteo@ok.test', os: false });
    await page.goto(`${srv.base}/?os=1#/inicio`);
    await page.waitForSelector('#os-root');
    ok(await page.evaluate(() => location.search) === '', '?os=1 enciende el modo y se limpia de la URL');
    ok(!(await page.$('#os-w-cobros')), 'un técnico no tiene el widget de Cobros (dinero)');
    await page.waitForFunction(() => document.querySelector('#os-bell-n')?.textContent === '3');
    await page.click('#os-bell');
    await page.click('[data-action="osAvisosMios"][data-p0="1"]');
    ok((await page.$$('#os-avisos .os-av')).length === 1, '«Los míos» de Matteo: el presupuesto a su nombre');
    await ctx.close();
  }
  {
    const { ctx, page } = await nuevo({ ancho: 900 });
    await page.goto(srv.base);
    await page.waitForSelector('#menu');
    ok(!(await page.$('#os-root')), 'a 900 px el modo escritorio no entra aunque esté activado');
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
