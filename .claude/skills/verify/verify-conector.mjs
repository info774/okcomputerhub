// Arnés del Conector MCP: crear token (se ve UNA vez, con el comando de
// Claude Code), revocar, y que un técnico no ve la pantalla (ni por URL).
//   npm run build && node .claude/skills/verify/verify-conector.mjs
import { servidor, navegador, baseMemoria, preparar, contador, CAPTURAS } from './comun.mjs';

const { ok, fallos, sumar } = contador();
const srv = await servidor(4180);
const INICIAL = {
  usuarios: [{ id: 'u-ana', nombre: 'Ana Admin', email: 'ana@ok.test', rol: 'admin', activo: true },
             { id: 'u-tito', nombre: 'Tito', email: 'tito@ok.test', rol: 'tecnico', activo: true }],
  mcp_tokens: [{ id: 'k1', created_at: '2026-09-01T10:00:00Z', nombre: 'Viejo', prefijo: 'okh_abcdef', alcance: 'lectura',
    usuario_id: 'u-ana', expira: null, ultimo_uso: null, revocado_at: null }],
  areas: [], sync_estado: [], proyectos: [], proyecto_tareas: [],
};
const RPC = {
  mcp_crear_token(b, db) {
    const token = 'okh_' + 'f'.repeat(48);
    db.mcp_tokens.unshift({ id: 'k2', created_at: new Date().toISOString(), nombre: b.p_nombre, prefijo: token.slice(0, 10),
      alcance: b.p_alcance, usuario_id: b.p_usuario_id, expira: b.p_dias ? '2027-01-01T00:00:00Z' : null, ultimo_uso: null, revocado_at: null });
    return token;
  },
  mcp_revocar_token(b, db) { db.mcp_tokens.find(t => t.id === b.p_id).revocado_at = new Date().toISOString(); return null; },
};

const browser = await navegador();
try {
  const base = baseMemoria(INICIAL, RPC);
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  await preparar(ctx, { email: 'ana@ok.test', base });
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e)));
  page.on('dialog', d => d.accept());
  await page.goto(`${srv.base}/#/conector`);
  await page.waitForSelector('#cm-nombre');
  ok(await page.isVisible('.menu-item[data-mod="conector"]'), 'admin: Conector MCP en el menú');
  await page.fill('#cm-nombre', 'Claude Code de Ana');
  await page.check('input[name="cm-alcance"][value="escritura"]');
  await page.click('form[data-on-submit="cmCrear"] button[type=submit]');
  await page.waitForSelector('#cm-token');
  const llamada = base.reg.escrituras.find(e => e.tabla === 'mcp_crear_token');
  ok(llamada?.cuerpo.p_alcance === 'escritura' && llamada.cuerpo.p_dias === 90 && llamada.cuerpo.p_usuario_id === 'u-ana',
    'crear: RPC con alcance, caducidad (90 días) y persona');
  ok((await page.inputValue('#cm-token')).startsWith('okh_'), 'el token se enseña al crearlo');
  const cmd = await page.inputValue('#cm-comando');
  ok(cmd.includes('claude mcp add okhub') && cmd.includes('/functions/v1/mcp') && cmd.includes('Bearer okh_'), 'con el comando para Claude Code');
  await page.screenshot({ path: `${CAPTURAS}/conector.png`, fullPage: true });
  await page.click('[data-action="cmOcultar"]');
  await page.waitForSelector('#cm-token', { state: 'detached' });
  ok(!(await page.content()).includes('f'.repeat(48)), 'después ya no se ve en la página');
  await page.click('[data-action="cmRevocar"][data-p0="k1"]');
  await page.waitForFunction(() => document.body.textContent.includes('Revocado'));
  ok(!!base.db.mcp_tokens.find(t => t.id === 'k1').revocado_at, 'revocar llama a la RPC y lo marca');
  ok(errores.length === 0, `sin errores JS${errores.length ? ': ' + errores.join(' | ') : ''}`);
  await ctx.close();

  const ctx2 = await browser.newContext({ serviceWorkers: 'block' });
  await preparar(ctx2, { email: 'tito@ok.test', base: baseMemoria(INICIAL, RPC) });
  const p2 = await ctx2.newPage();
  await p2.goto(`${srv.base}/#/conector`);
  await p2.waitForSelector('#menu .menu-item');
  ok(await p2.locator('.menu-item[data-mod="conector"]').count() === 0, 'técnico: no está en el menú');
  ok(await p2.isVisible('text=solo para administradores') && await p2.locator('#cm-nombre').count() === 0, 'técnico: por URL tampoco');
  await ctx2.close();
} catch (e) { console.error('✗ excepción:', e); sumar(); }
finally { await browser.close(); srv.parar(); }
console.log(fallos() ? `\n${fallos()} fallo(s)` : '\nTodo bien');
process.exit(fallos() ? 1 : 0);
