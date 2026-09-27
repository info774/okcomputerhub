// Arnés de Monitorización (fase 2): sedes con semáforo, equipos y buscador,
// alertas y «Acusar» (por breeze-api, nunca escribiendo en las vistas),
// emparejado de un Site a mano, ficha del equipo (resumen con TPV, gráfica con
// hover, comando y script por breeze-api, enlaces a Breeze), aviso cuando falta
// el usuario de servicio, y móvil sin desbordar.
//   npm run build && node .claude/skills/verify/verify-monitorizacion.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS, SB } from './comun.mjs';

const { ok, fallos, sumar } = contador();
const srv = await servidor(4181);
const ahora = Date.now();
const iso = ms => new Date(ms).toISOString();
const L1 = '11111111-1111-1111-1111-111111111111', L2 = '22222222-2222-2222-2222-222222222222';
const D1 = 'dddddddd-0000-0000-0000-000000000001', D2 = 'dddddddd-0000-0000-0000-000000000002', D3 = 'dddddddd-0000-0000-0000-000000000003';
const equipo = (id, hostname, local_id, conectado, extra = {}) => ({
  id, hostname, nombre: hostname, site_id: `s-${hostname}`, sitio: local_id ? 'El Rebajon' : 'Oficina', organizacion: 'JJ PUMARAN SL', local_id,
  so: 'windows', so_version: 'Microsoft Windows 11 Pro 24H2', so_build: '26100', arquitectura: 'x64', version_agente: '1.2.3',
  estado: conectado ? 'online' : 'offline', visto_ultimo: iso(conectado ? ahora - 60000 : ahora - 3 * 86400000), conectado,
  ultimo_usuario: 'CAJA', encendido_seg: 90000, reinicio_pendiente: false, ip_publica: '1.2.3.4', ip_local: '192.168.1.10', virtual: false,
  alta: iso(ahora - 30 * 86400000), cpu: 'Intel i5', nucleos: 4, ram_mb: 8192, disco_gb: 120, fabricante: 'HP', modelo: 'ProDesk', serie: 'ABC',
  antivirus: 'windows_defender', av_tiempo_real: true, firewall: true, cifrado: null, amenazas: 0, parches_pendientes: 3, alertas_abiertas: 0,
  discos: [{ unidad: 'C:', total_gb: 118, libre_gb: 11, uso: 91 }], rustdesk_id: null, programa_tpv: local_id ? 'Sysme' : null,
  tpv_version: local_id ? '5.39' : null, ...extra,
});
const INICIAL = {
  usuarios: [{ id: 'u-tito', nombre: 'Tito', email: 'tito@ok.test', rol: 'tecnico', activo: true }],
  areas: [], sync_estado: [], proyectos: [], proyecto_tareas: [],
  locales: [{ id: L1, nombre: 'El Rebajón', direccion: 'Calle 1', activo: true }, { id: L2, nombre: 'Pizzería San Marco', direccion: 'Calle 2', activo: true }],
  rmm_estado_local: [{ local_id: L1, equipos: 2, conectados: 1, alertas: 1, visto_ultimo: iso(ahora - 60000), estado: 'alerta' }],
  rmm_equipos: [equipo(D1, 'ELREBAJON', L1, true, { alertas_abiertas: 1 }), equipo(D2, 'ELREBAJON2', L1, false), equipo(D3, 'ALMACEN', null, false)],
  rmm_alertas: [{ id: 'a1', device_id: D1, hostname: 'ELREBAJON', local_id: L1, sitio: 'El Rebajon', estado: 'active', severidad: 'high',
    titulo: 'Disco casi lleno', mensaje: 'C: al 91 %', disparada: iso(ahora - 3600000), acusada: null, acusada_por: null, resuelta: null, nota_resolucion: null }],
  rmm_sites: [
    { site_id: 's-ok', sitio: 'El Rebajon', organizacion: 'JJ', local_id: L1, manual: false, local_nombre: 'El Rebajón', equipos: 2, conectados: 1 },
    { site_id: 's-sin', sitio: 'Pizzeria SM', organizacion: 'AMADIO', local_id: null, manual: false, local_nombre: null, equipos: 1, conectados: 0 },
  ],
  rmm_sitios: [],
  rmm_metricas: Array.from({ length: 120 }, (_, i) => ({ device_id: D1, momento: iso(ahora - (120 - i) * 60000), cpu: 20 + (i % 30), ram: 55, disco: 91 })),
  rmm_parches: [{ id: 'p1', device_id: D1, estado: 'pending', titulo: 'KB5030211', severidad: 'important', categoria: 'security', referencia: 'KB5030211',
    publicado: '2026-09-10', pide_reinicio: true, instalado: null, ultimo_error: null }],
  rmm_software: [{ device_id: D1, nombre: 'Sysme TPV', version: '5.39', fabricante: 'Sysme', instalado: '2026-01-01' },
                 { device_id: D1, nombre: 'Google Chrome', version: '129', fabricante: 'Google', instalado: '2026-09-01' }],
  rmm_scripts: [{ id: 'sc1', nombre: 'Limpiar temporales', descripcion: 'Borra %TEMP%', categoria: 'Mantenimiento', sistemas: ['windows'], lenguaje: 'powershell', parametros: null }],
  rmm_comandos: [], rmm_scripts_ejecuciones: [
    { id: 'x1', script_id: 'sc1', script: 'Limpiar temporales', device_id: D1, hostname: 'ELREBAJON', estado: 'completed', pedido: iso(ahora - 7200000),
      inicio: null, fin: null, codigo_salida: 0, salida: 'Liberados 2 GB', errores: null, error: null }],
  rmm_sesiones_remotas: [], rmm_acciones: [],
};

async function contexto(browser, { configurado = true, viewport = { width: 1280, height: 900 } } = {}) {
  const base = baseMemoria(INICIAL);
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport });
  await preparar(ctx, { email: 'tito@ok.test', base });
  const breeze = [];
  await ctx.route(`${SB}/functions/v1/breeze-api`, async route => {
    const b = route.request().postDataJSON();
    breeze.push({ ...b, auth: route.request().headers()['authorization'] });
    const r = b.accion === 'estado'
      ? { configurado, url: 'https://breeze.oksistemas.online', comandos: { refresh_inventory: 'Refrescar inventario', reboot: 'Reiniciar', shutdown: 'Apagar', wake: 'Encender (Wake-on-LAN)' } }
      : b.accion === 'script' ? { ok: true, equipos: [{ device_id: D1, admitido: true, ejecucion_id: 'x2', entrega: 'delivered', motivo: null }] }
        : { ok: true, estado: 'acknowledged', entrega: 'delivered' };
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(r) });
  });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
  page.on('dialog', d => d.accept());
  return { ctx, page, base, breeze, errores };
}

const browser = await navegador();
try {
  const { ctx, page, base, breeze, errores } = await contexto(browser);
  await page.goto(`${srv.base}/#/monitorizacion`);
  await page.waitForSelector('.mo-sede');
  ok(await page.isVisible('.menu-item[data-mod="monitorizacion"]'), 'Monitorización en el menú');
  ok((await page.textContent('.mo-sede')).includes('El Rebajón') && (await page.textContent('.mo-sede')).includes('Con alertas'), 'sedes: tarjeta con nombre y semáforo');
  ok(await page.isVisible('text=sin sede del hub'), 'sedes: avisa de equipos sin sede');
  await page.screenshot({ path: `${CAPTURAS}/monitorizacion-sedes.png`, fullPage: true });

  await page.click('.mo-sede');
  await page.waitForSelector('text=Alertas abiertas');
  ok(await page.locator('#vista tbody tr, main tbody tr').count() >= 3, 'sede: equipos y alertas de la sede');

  await page.goto(`${srv.base}/#/monitorizacion/equipos`);
  await page.waitForSelector('#mo-filtro');
  ok(await page.locator('#mo-cuerpo tbody tr').count() === 3, 'equipos: los tres');
  ok((await page.textContent('#mo-cuerpo')).includes('5.39'), 'equipos: versión del TPV');
  await page.fill('#mo-filtro', 'rebajon2');
  await page.waitForFunction(() => document.querySelectorAll('#mo-cuerpo tbody tr').length === 1);
  ok(true, 'equipos: el buscador filtra');

  await page.goto(`${srv.base}/#/monitorizacion/alertas`);
  await page.waitForSelector('[data-action="moAcusar"]');
  ok(await page.locator('a[href="https://breeze.oksistemas.online/alerts/a1"]').count() === 1, 'alertas: enlace para resolver en Breeze');
  await page.click('[data-action="moAcusar"]');
  await page.waitForFunction(() => document.getElementById('toast')?.textContent.includes('acusada'));
  const acuse = breeze.find(b => b.accion === 'acusar_alerta');
  ok(acuse?.alerta_id === 'a1' && acuse.auth?.startsWith('Bearer '), 'acusar: por breeze-api con la sesión');

  await page.goto(`${srv.base}/#/monitorizacion/emparejado`);
  await page.waitForSelector('[data-action="moEditarSite"][data-p0="s-sin"]');
  await page.click('[data-action="moEditarSite"][data-p0="s-sin"]');
  await page.fill('#mo-local-q', 'pizz');
  await page.waitForSelector(`[data-action="moPonerSede"][data-p0="${L2}"]`);
  await page.click(`[data-action="moPonerSede"][data-p0="${L2}"]`);
  await page.waitForFunction(() => document.getElementById('toast')?.textContent.includes('emparejado'));
  const emp = base.reg.escrituras.find(e => e.tabla === 'rmm_sitios');
  ok(emp?.cuerpo.site_id === 's-sin' && emp.cuerpo.local_id === L2 && emp.cuerpo.manual === true && emp.url.includes('on_conflict=site_id'),
    'emparejado: upsert en rmm_sitios, marcado como manual');

  await page.goto(`${srv.base}/#/monitorizacion/equipo/${D1}`);
  await page.waitForSelector('.me-datos');
  ok((await page.textContent('#me-cuerpo')).includes('5.39') && await page.isVisible('.me-barra .mal'), 'equipo: resumen con TPV y disco en rojo al 91 %');
  await page.click('[data-action="mePestana"][data-p1="metricas"]');
  await page.waitForSelector('.me-linea');
  const caja = await page.locator('.me-graf').first().boundingBox();
  await page.mouse.move(caja.x + caja.width * 0.5, caja.y + caja.height / 2);
  await page.waitForSelector('.me-tip:not([hidden])');
  ok((await page.textContent('.me-tip:not([hidden])')).includes('%'), 'métricas: gráfica con valor al pasar el ratón');
  await page.screenshot({ path: `${CAPTURAS}/monitorizacion-metricas.png`, fullPage: true });

  await page.click('[data-action="mePestana"][data-p1="acciones"]');
  await page.waitForSelector('[data-action="meComando"][data-p0="reboot"]:not([disabled])');
  await page.click('[data-action="meComando"][data-p0="reboot"]');
  await page.waitForFunction(() => document.getElementById('toast')?.textContent.includes('Reiniciar'));
  ok(breeze.some(b => b.accion === 'comando' && b.tipo === 'reboot' && b.device_id === D1), 'comando: reiniciar por breeze-api (tras confirmar)');
  await page.waitForSelector('#me-script');
  await page.selectOption('#me-script', 'sc1');
  await page.click('[data-action="meScript"]');
  await page.waitForFunction(() => document.getElementById('toast')?.textContent.includes('Script lanzado'));
  const sc = breeze.find(b => b.accion === 'script');
  ok(sc?.script_id === 'sc1' && sc.device_ids?.[0] === D1, 'script: se lanza por breeze-api en el equipo');
  ok((await page.textContent('#me-cuerpo')).includes('Limpiar temporales'), 'script: sale en «Scripts recientes»');

  await page.click('[data-action="mePestana"][data-p1="remoto"]');
  await page.waitForSelector(`a[href="https://breeze.oksistemas.online/remote/terminal/${D1}"]`);
  ok(true, 'remoto: enlaces al panel de Breeze');

  const aVistas = base.reg.escrituras.filter(e => e.tabla !== 'rmm_sitios');
  ok(aVistas.length === 0, `nada se escribe salvo rmm_sitios${aVistas.length ? ': ' + aVistas.map(e => `${e.metodo} ${e.tabla}`).join(', ') : ''}`);
  ok(base.reg.rest.every(r => r.metodo === 'OPTIONS' || r.perfil === 'hub'), 'todas las lecturas con Accept-Profile: hub');
  ok(await page.locator('[onclick],[onchange],[oninput]').count() === 0, 'sin on*= inline');
  ok(errores.length === 0, `sin errores JS${errores.length ? ': ' + errores.join(' | ') : ''}`);
  await ctx.close();

  // Sin usuario de servicio: se ve todo, pero las acciones están apagadas.
  const s = await contexto(browser, { configurado: false });
  await s.page.goto(`${srv.base}/#/monitorizacion/equipo/${D1}/acciones`);
  await s.page.waitForSelector('[data-action="meComando"]');
  ok(await s.page.isDisabled('[data-action="meComando"][data-p0="reboot"]') && await s.page.isVisible('text=Falta el usuario de servicio'),
    'sin usuario de servicio: botones apagados y aviso');
  await s.ctx.close();

  // Móvil
  const m = await contexto(browser, { viewport: { width: 390, height: 844 } });
  for (const ruta of ['monitorizacion/sedes', 'monitorizacion/equipos', `monitorizacion/equipo/${D1}/metricas`]) {
    await m.page.goto(`${srv.base}/#/${ruta}`);
    await m.page.waitForSelector('.mo-sede, #mo-filtro, .me-linea');
    const ancho = await m.page.evaluate(() => document.documentElement.scrollWidth);
    ok(ancho <= 390, `móvil ${ruta}: sin scroll horizontal (${ancho}px)`);
  }
  await m.page.screenshot({ path: `${CAPTURAS}/monitorizacion-movil.png`, fullPage: true });
  ok(m.errores.length === 0, 'móvil: sin errores JS');
  await m.ctx.close();
} catch (e) { console.error('✗ excepción:', e); sumar(); }
finally { await browser.close(); srv.parar(); }
console.log(fallos() ? `\n${fallos()} fallo(s)` : '\nTodo bien');
process.exit(fallos() ? 1 : 0);
