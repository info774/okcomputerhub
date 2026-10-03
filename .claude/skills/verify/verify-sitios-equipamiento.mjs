// Arnés de la paridad de sedes (bloque 2, tanda 3): pestañas Software,
// Hardware y Cámaras (añadir, editar, quitar; garantía = instalación + 1 año;
// contraseña de la cámara oculta tras «Ver»), Seguimiento del plan (marcar y
// desmarcar por periodo), «🖥 Remoto» (AnyDesk sin repetir + RustDesk con la
// contraseña de la sede al portapapeles), AnyDesk en la lista y en el Excel,
// vivienda sin Software ni Seguimiento, y eliminar llevándose lo que cuelga.
// Sin corte: todo en solo lectura.
//   npm run build && node .claude/skills/verify/verify-sitios-equipamiento.mjs
import { readFileSync } from 'node:fs';
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS } from './comun.mjs';

const { ok, fallos } = contador();
const srv = await servidor(4177);
const L1 = 'a1111111-1111-1111-1111-111111111111', L2 = 'a2222222-2222-2222-2222-222222222222';
const hoy = new Date();
const dia = n => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const mes = (d = hoy) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const mesPasado = mes(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1));
const base0 = cortado => ({
  usuarios: [{ id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true }, { id: 'u-tito', nombre: 'Tito Pérez', email: 'tito@ok.test', rol: 'tecnico', activo: true }],
  areas: [{ area: 'clientes', dueno: cortado ? 'hub' : 'app', tablas: ['clientes', 'locales', 'contactos', 'local_telefonos', 'local_software', 'local_hardware', 'local_camaras', 'rmm_despliegues', 'plan_tareas', 'sitio_tarea_seguimiento'] }],
  sync_estado: [], proyectos: [], clientes_crm: [], actividades: [], trabajos: [], tickets: [], presupuestos: [], oportunidades: [], contactos: [], local_telefonos: [],
  rmm_estado_local: [],
  rmm_equipos: [{ id: 'e1', local_id: L1, hostname: 'CAJA-1', rustdesk_id: '987 654 321', conectado: true }],
  rmm_despliegues: [{ local_id: L1, rustdesk_password: 'pass-sede' }],
  clientes: [{ id: 'c1', nombre: 'Hotel Playa SL', activo: true }],
  locales: [
    { id: L1, cliente_id: 'c1', nombre: 'Hotel Playa · Recepción', tipo: 'Local', estado: 'activo', activo: true, plan: 'Silver', estado_pago: 'Al corriente', programa_tpv: 'Glop' },
    { id: L2, cliente_id: 'c1', nombre: 'Casa de Pepe', tipo: 'Vivienda', estado: 'activo', activo: true, plan: null },
  ],
  local_hardware: [
    { id: 'h1', local_id: L1, tipo: 'TPV', nombre: 'TPV barra', num_serie: 'SN1', ip: null, anydesk_id: '123 456 789', garantia: dia(-5), fecha_instalacion: dia(-370), notas: null, created_at: '2026-01-01T00:00:00Z' },
    { id: 'h2', local_id: L1, tipo: 'Router', nombre: 'Router', num_serie: null, ip: '192.168.1.1', anydesk_id: null, garantia: null, fecha_instalacion: null, notas: null, created_at: '2026-01-02T00:00:00Z' },
  ],
  local_software: [{ id: 's1', local_id: L1, nombre: 'Glop', version: '7', num_licencia: 'LIC-1', anydesk_id: '123456789', fecha_caducidad_certificado: dia(10), notas: null, created_at: '2026-01-01T00:00:00Z' }],
  local_camaras: [{ id: 'k1', local_id: L1, marca: 'Hikvision', modelo: 'DS-2', num_serie: null, ip: '192.168.1.64', usuario: 'admin', contrasena: 'clave123', notas: null, created_at: '2026-01-01T00:00:00Z' }],
  plan_tareas: [
    { id: 't1', plan: 'Silver', nombre: 'Revisar la copia', periodicidad: 'mensual', es_backup: true, orden: 1, activa: true },
    { id: 't2', plan: 'Silver', nombre: 'Limpieza del TPV', periodicidad: 'trimestral', es_backup: false, orden: 2, activa: true },
  ],
  sitio_tarea_seguimiento: [{ id: 'g1', local_id: L1, tarea_id: 't1', periodo: mes(), completado: true, completado_at: hoy.toISOString() }],
});

async function contexto(browser, cortado, email = 'ana@ok.test') {
  const base = baseMemoria(base0(cortado), {});
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await preparar(ctx, { email, base });
  await ctx.addInitScript(() => {
    window.__abiertos = [];
    window.open = u => { window.__abiertos.push(String(u)); return null; };
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async t => { window.__copiado = t; } }, configurable: true });
  });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
  page.on('dialog', d => d.accept());
  return { ctx, page, base, errores };
}
const escr = (base, m, t) => base.reg.escrituras.filter(e => e.metodo === m && e.tabla === t);
const pestana = async (page, id, p) => {
  await page.goto(`${srv.base}/#/sitios/${id}/${p}`);
  await page.waitForFunction(() => document.getElementById('si-cuerpo') && !document.querySelector('#si-cuerpo .cargando'));
};

const browser = await navegador();
try {
  // ── Sin corte ───────────────────────────────────────────────────────────
  const A = await contexto(browser, false);
  await pestana(A.page, L1, 'hardware');
  ok((await A.page.textContent('#si-eq-tabla')).includes('TPV barra') && await A.page.locator('#si-eq-form').count() === 0
    && (await A.page.textContent('#si-eq-tabla')).includes('Garantía vencido'), 'sin corte: el hardware se ve (garantía vencida marcada) sin formulario');
  await pestana(A.page, L1, 'software');
  ok((await A.page.textContent('#si-eq-tabla')).includes('vence en 10 d'), 'software: el certificado que vence en ≤ 30 días se avisa');
  await pestana(A.page, L1, 'camaras');
  ok((await A.page.textContent('[data-clave="k1"]')) === '••••' && !(await A.page.textContent('#si-eq-tabla')).includes('clave123'), 'cámaras: la contraseña sale oculta');
  await A.page.click('[data-action="siEqClave"]');
  ok((await A.page.textContent('[data-clave="k1"]')) === 'clave123', 'cámaras: «Ver» la enseña');
  await pestana(A.page, L1, 'seguimiento');
  ok(await A.page.locator('.si-seg-celda.hecha').count() === 1 && await A.page.locator('.si-seg-celda:not([disabled])').count() === 0
    && (await A.page.textContent('.si-seg')).includes('Revisar la copia'), 'sin corte: el seguimiento se ve marcado y no se toca');
  await pestana(A.page, L2, 'resumen');
  const tabs = await A.page.locator('.pestanas button').allTextContents();
  ok(!tabs.includes('Software') && !tabs.includes('Seguimiento') && tabs.includes('Hardware') && tabs.includes('Cámaras'), 'vivienda: sin Software ni Seguimiento');
  ok(A.base.reg.escrituras.filter(e => e.metodo !== 'RPC').length === 0 && A.errores.length === 0, `sin corte: nada escrito y sin errores${A.errores.length ? ': ' + A.errores.join(' | ') : ''}`);
  await A.ctx.close();

  // ── Con corte ───────────────────────────────────────────────────────────
  const B = await contexto(browser, true);
  const { page, base } = B;
  // Hardware: alta con garantía automática, editar, sin nombre ni tipo no entra
  await pestana(page, L1, 'hardware');
  await page.click('#si-eq-form button[type=submit]');
  await page.waitForFunction(() => document.getElementById('toast')?.textContent.includes('tipo o el nombre'));
  ok(escr(base, 'POST', 'local_hardware').length === 0, 'hardware: sin tipo ni nombre no se añade');
  await page.selectOption('#si-eq-tipo', 'Impresora');
  await page.fill('#si-eq-anydesk_id', '555 111 222');
  await page.fill('#si-eq-fecha_instalacion', '2026-10-03');
  await page.dispatchEvent('#si-eq-fecha_instalacion', 'input');
  ok((await page.inputValue('#si-eq-garantia')) === '2027-10-03', 'hardware: la garantía se pone a instalación + 1 año');
  await page.click('#si-eq-form button[type=submit]');
  await page.waitForFunction(() => document.getElementById('si-eq-tabla')?.textContent.includes('555 111 222'));
  const hw = escr(base, 'POST', 'local_hardware').at(-1)?.cuerpo;
  ok(hw?.local_id === L1 && hw?.tipo === 'Impresora' && hw?.nombre === 'Impresora' && hw?.garantia === '2027-10-03', 'hardware: se añade (sin nombre, el del tipo)');
  await page.click('tr[data-eq="h2"] [data-action="siEqEditar"]');
  ok((await page.inputValue('#si-eq-ip')) === '192.168.1.1' && (await page.inputValue('#si-eq-tipo')) === 'Router', 'hardware: «✎» lo sube al formulario');
  await page.fill('#si-eq-ip', '192.168.1.254');
  await page.click('#si-eq-form button[type=submit]');
  await page.waitForFunction(() => document.getElementById('si-eq-tabla')?.textContent.includes('192.168.1.254'));
  ok(escr(base, 'PATCH', 'local_hardware').at(-1)?.url.includes('id=eq.h2'), 'hardware: editar guarda sobre el mismo');
  // Software: el nombre es obligatorio
  await pestana(page, L1, 'software');
  await page.fill('#si-eq-version', '8');
  await page.click('#si-eq-form button[type=submit]');
  await page.waitForFunction(() => document.getElementById('toast')?.textContent.includes('obligatorio'));
  await page.fill('#si-eq-nombre', 'Sysme');
  await page.click('#si-eq-form button[type=submit]');
  await page.waitForFunction(() => document.getElementById('si-eq-tabla')?.textContent.includes('Sysme'));
  ok(escr(base, 'POST', 'local_software').length === 1 && escr(base, 'POST', 'local_software')[0].cuerpo.version === '8', 'software: sin nombre no entra; con nombre, sí');
  // Cámaras: quitar
  await pestana(page, L1, 'camaras');
  await page.click('tr[data-eq="k1"] [data-action="siEqBorrar"]');
  await page.waitForFunction(() => !document.querySelector('tr[data-eq="k1"]'));
  ok(escr(base, 'DELETE', 'local_camaras').at(-1)?.url.includes('id=eq.k1'), 'cámaras: se quitan');
  // Seguimiento: marcar y desmarcar
  await pestana(page, L1, 'seguimiento');
  await page.click(`[data-action="siSegMarcar"][data-p0="t1"][data-p1="${mesPasado}"]`);
  await page.waitForSelector(`[data-p0="t1"][data-p1="${mesPasado}"].hecha`);
  const seg = escr(base, 'POST', 'sitio_tarea_seguimiento').at(-1)?.cuerpo;
  ok(seg?.local_id === L1 && seg?.tarea_id === 't1' && seg?.periodo === mesPasado && seg?.completado_por === 'u-ana', 'seguimiento: marcar apunta periodo y quién');
  await page.click(`[data-action="siSegMarcar"][data-p0="t1"][data-p1="${mes()}"]`);
  await page.waitForSelector(`[data-p0="t1"][data-p1="${mes()}"]:not(.hecha)`);
  ok(escr(base, 'DELETE', 'sitio_tarea_seguimiento').at(-1)?.url.includes('id=eq.g1'), 'seguimiento: desmarcar lo quita');
  ok(await page.locator('[data-p0="t2"]').count() === 4, 'seguimiento: trimestral con sus cuatro periodos');
  await page.screenshot({ path: `${CAPTURAS}/sitios-seguimiento.png` });
  // Remoto: AnyDesk sin repetir + RustDesk con la contraseña al portapapeles
  await page.click('[data-action="siRemoto"]');
  await page.waitForSelector('#si-rem-lista:not([hidden])');
  const opciones = await page.locator('[data-action="siRemotoAbrir"]').allTextContents();
  ok(opciones.length === 3 && opciones.filter(o => o.includes('123456789')).length === 1 && opciones.some(o => o.includes('RustDesk') && o.includes('CAJA-1')),
    `remoto: cada AnyDesk una vez (hardware + software) y el RustDesk de Breeze (${opciones.length})`);
  await page.click('[data-action="siRemotoAbrir"]:has-text("RustDesk")');
  await page.waitForFunction(() => window.__abiertos.length > 0);
  ok((await page.evaluate(() => window.__copiado)) === 'pass-sede' && (await page.evaluate(() => window.__abiertos.at(-1))) === 'rustdesk://987654321',
    'remoto: RustDesk copia la contraseña de la sede y abre el equipo');
  // Lista y Excel con AnyDesk
  await page.goto(`${srv.base}/#/sitios`);
  await page.waitForSelector('#si-tabla');
  ok(await page.locator('#si-tabla a[href="anydesk://123456789"]').count() === 1, 'lista: enlace de AnyDesk del sitio');
  const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="siExcel"]')]);
  const csv = readFileSync(await descarga.path(), 'utf8');
  ok(csv.split('\n')[0].includes('AnyDesk') && csv.includes('123456789'), 'Excel: columna AnyDesk');
  await page.screenshot({ path: `${CAPTURAS}/sitios-equipamiento.png` });
  // Eliminar: primero lo que cuelga, después la sede
  await pestana(page, L1, 'resumen');
  await page.click('[data-action="siEliminar"]');
  await page.waitForFunction(() => location.hash === '#/sitios');
  const borr = base.reg.escrituras.filter(e => e.metodo === 'DELETE' && e.url.includes(L1)).map(e => e.tabla);
  ok(JSON.stringify(borr) === JSON.stringify(['local_telefonos', 'local_software', 'local_hardware', 'local_camaras', 'sitio_tarea_seguimiento', 'locales']),
    `eliminar: se lleva lo que cuelga y después la sede (${borr.join(', ')})`);
  ok(escr(base, 'DELETE', 'rmm_despliegues').length === 0, 'eliminar: la contraseña de RustDesk no se toca');
  ok(B.errores.length === 0, `con corte: sin errores${B.errores.length ? ': ' + B.errores.join(' | ') : ''}`);
  await B.ctx.close();
} finally {
  await browser.close();
  srv.parar();
}
process.exit(fallos() ? 1 : 0);
