// Arnés de Reloj (#/reloj): vincular con el código que enseña el reloj (también
// llegando con el código en la URL), ver los relojes y desvincular. Lo ve
// cualquier persona del equipo (cada una vincula los suyos).
//   npm run build && node .claude/skills/verify/verify-reloj.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS } from './comun.mjs';

const { ok, fallos, sumar } = contador();
const srv = await servidor(4191);
const INICIAL = {
  usuarios: [{ id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true },
             { id: 'u-tito', nombre: 'Tito Pérez', email: 'tito@ok.test', rol: 'tecnico', activo: true }],
  reloj_dispositivos: [{ id: 'r1', nombre: 'Reloj viejo', usuario_id: 'u-tito', aprobado_at: '2026-09-01T10:00:00Z',
    ultimo_uso: null, revocado_at: null }],
  areas: [], sync_estado: [],
};
const RPC = {
  reloj_aprobar(b, db) {
    if (b.p_codigo.replace('-', '') !== 'K7M4QP') throw new Error('Ese código no existe o ha caducado: pide otro en el reloj');
    db.reloj_dispositivos.unshift({ id: 'r2', nombre: b.p_nombre ?? 'Reloj de Tito', usuario_id: 'u-tito',
      aprobado_at: new Date().toISOString(), ultimo_uso: null, revocado_at: null });
    return 'r2';
  },
  reloj_revocar(b, db) { db.reloj_dispositivos.find(r => r.id === b.p_id).revocado_at = new Date().toISOString(); return null; },
};

const browser = await navegador();
try {
  const base = baseMemoria(INICIAL, RPC);
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  await preparar(ctx, { email: 'tito@ok.test', base });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
  page.on('dialog', d => d.accept());
  await page.goto(`${srv.base}/#/reloj/k7m-4qp`);
  await page.waitForSelector('#rl-codigo');
  ok(await page.isVisible('.menu-item[data-mod="reloj"]'), 'técnico: Reloj en el menú');
  ok(await page.inputValue('#rl-codigo') === 'K7M-4QP', 'el código de la URL llega puesto (en mayúsculas)');
  await page.fill('#rl-nombre', 'Galaxy Watch de Tito');
  await page.click('form[data-on-submit="rlAprobar"] button[type=submit]');
  await page.waitForFunction(() => document.body.textContent.includes('Galaxy Watch de Tito'));
  const llamada = base.reg.escrituras.find(e => e.tabla === 'reloj_aprobar');
  ok(llamada?.cuerpo.p_codigo === 'K7M-4QP' && llamada.cuerpo.p_nombre === 'Galaxy Watch de Tito', 'vincular: RPC con código y nombre');
  ok(!(await page.inputValue('#rl-codigo')), 'tras vincular, el código ya no queda en el campo');
  await page.screenshot({ path: `${CAPTURAS}/reloj.png`, fullPage: true });
  await page.fill('#rl-codigo', 'AAA-AAA');
  await page.click('form[data-on-submit="rlAprobar"] button[type=submit]');
  await page.waitForFunction(() => document.body.textContent.includes('caducado'));
  ok(true, 'un código malo enseña el aviso de la base');
  await page.click('[data-action="rlRevocar"][data-p0="r1"]');
  await page.waitForFunction(() => document.body.textContent.includes('Desvinculado'));
  ok(!!base.db.reloj_dispositivos.find(r => r.id === 'r1').revocado_at, 'desvincular llama a la RPC y lo marca');
  ok(errores.length === 0, `sin errores JS${errores.length ? ': ' + errores.join(' | ') : ''}`);
  await ctx.close();
} catch (e) { console.error('✗ excepción:', e); sumar(); }
finally { await browser.close(); srv.parar(); }
console.log(fallos() ? `\n${fallos()} fallo(s)` : '\nTodo bien');
process.exit(fallos() ? 1 : 0);
