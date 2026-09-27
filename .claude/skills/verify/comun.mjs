// Piezas comunes de los arneses: servidor `vite preview` sobre dist/, sesión
// falsa de supabase-js y un PostgREST MÍNIMO en memoria (filtros eq/neq/in/lt/
// ilike/or básicos, HEAD con Content-Range, POST/PATCH/DELETE) para probar
// pantallas que escriben, sin tocar datos reales.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export const REF = 'adomalsxsymxzuozksmt';
export const SB = `https://${REF}.supabase.co`;
export const CAPTURAS = 'verify-capturas';
mkdirSync(CAPTURAS, { recursive: true });

export function contador() {
  let fallos = 0;
  const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fallos++; };
  return { ok, fallos: () => fallos, sumar: () => fallos++ };
}

export async function servidor(puerto) {
  const srv = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(puerto), '--strictPort', '--host', '127.0.0.1'], { stdio: 'pipe' });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('vite preview no arrancó')), 20000);
    srv.stdout.on('data', d => { if (String(d).includes(String(puerto))) { clearTimeout(t); res(); } });
  });
  return { base: `http://127.0.0.1:${puerto}`, parar: () => srv.kill() };
}

export async function navegador() {
  const CHROMIUM = '/opt/pw-browsers/chromium';
  return chromium.launch({ executablePath: existsSync(CHROMIUM) ? CHROMIUM : undefined });
}

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
export function sesion(email) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', email, role: 'authenticated', exp })}.firma`;
  return { access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: exp,
    user: { id: 'u1', email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} } };
}

// ── PostgREST en memoria ────────────────────────────────────────────────────
function cumple(fila, k, v) {
  if (k === 'or' || k === 'and') {
    const partes = v.slice(1, -1).split(/,(?![^(]*\))/);
    const res = partes.map(p => { const [c, op, ...r] = p.split('.'); return cumple(fila, c, `${op}.${r.join('.')}`); });
    return k === 'or' ? res.some(Boolean) : res.every(Boolean);
  }
  const i = v.indexOf('.');
  const op = v.slice(0, i), arg = v.slice(i + 1);
  const x = fila[k];
  switch (op) {
    case 'eq': return String(x) === arg;
    case 'neq': return String(x) !== arg;
    case 'lt': return x != null && String(x) < arg;
    case 'lte': return x != null && String(x) <= arg;
    case 'gt': return x != null && String(x) > arg;
    case 'gte': return x != null && String(x) >= arg;
    case 'in': return arg.slice(1, -1).split(',').map(s => s.replace(/^"|"$/g, '')).includes(String(x));
    case 'ilike': return new RegExp('^' + arg.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i').test(String(x ?? ''));
    case 'is': return arg === 'null' ? x == null : String(x) === arg;
    default: return true;
  }
}
const RESERVADOS = new Set(['select', 'order', 'limit', 'offset', 'on_conflict']);

export function baseMemoria(inicial = {}, rpc = {}) {
  const db = structuredClone(inicial);
  const reg = { rest: [], escrituras: [], funciones: [] };
  let numero = 100;
  const filtrar = (tabla, url) => (db[tabla] ?? []).filter(f =>
    [...url.searchParams].every(([k, v]) => RESERVADOS.has(k) || cumple(f, k, v)));
  async function manejar(route) {
    const req = route.request();
    const url = new URL(req.url());
    const tabla = url.pathname.split('/').pop();
    const m = req.method();
    const h = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Range' };
    reg.rest.push({ metodo: m, tabla, perfil: req.headers()['accept-profile'], url: url.toString() });
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...h, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
    if (url.pathname.includes('/rpc/')) {
      const f = rpc[tabla];
      const cuerpo = req.postDataJSON();
      reg.escrituras.push({ metodo: 'RPC', tabla, cuerpo });
      if (!f) return route.fulfill({ status: 404, headers: h, contentType: 'application/json', body: '{"message":"rpc no simulada"}' });
      try { return route.fulfill({ status: 200, headers: h, contentType: 'application/json', body: JSON.stringify(await f(cuerpo, db)) }); }
      catch (e) { return route.fulfill({ status: 400, headers: h, contentType: 'application/json', body: JSON.stringify({ message: e.message }) }); }
    }
    const filas = filtrar(tabla, url);
    if (m === 'HEAD') return route.fulfill({ status: 200, headers: { ...h, 'Content-Range': `0-0/${filas.length}` }, body: '' });
    if (m === 'GET') {
      const lim = Number(url.searchParams.get('limit') ?? 1e9), off = Number(url.searchParams.get('offset') ?? 0);
      const unico = (req.headers()['accept'] ?? '').includes('pgrst.object');
      const out = filas.slice(off, off + lim);
      return route.fulfill({ status: 200, headers: h, contentType: 'application/json', body: JSON.stringify(unico ? out[0] ?? null : out) });
    }
    const cuerpo = req.postDataJSON();
    reg.escrituras.push({ metodo: m, tabla, cuerpo, url: url.toString() });
    if (m === 'POST') {
      db[tabla] ??= [];
      const nuevas = (Array.isArray(cuerpo) ? cuerpo : [cuerpo]).map(c => ({
        id: randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        ...(tabla === 'proyectos' ? { numero: ++numero, estado: 'idea', prioridad: 'media', tipo: 'interno', orden: 0 } : {}),
        ...(tabla.startsWith('proyecto_') ? { orden: 0, fuentes: [], hecho: false, estado: 'pendiente' } : {}),
        ...(tabla === 'tickets' ? { numero: ++numero + 5000, valoracion_token: randomUUID(), primera_respuesta_at: null, cerrado_at: null, valoracion: null } : {}),
        ...(tabla === 'ticket_comentarios' ? { enviado_at: null, envio_error: null, canal: null } : {}),
        ...(tabla === 'paginas' ? { version: 1, archivada: false, orden: 0, icono: null, proyecto_id: null, creado_por: 'u-ana', actualizado_por: null } : {}),
        ...(tabla === 'claude_peticiones' ? { estado: 'pendiente', resultado: null, error: null } : {}),
        ...c,
      }));
      const clave = url.searchParams.get('on_conflict');
      if (clave) {
        // upsert: si ya hay una fila con esa clave, se mezcla con ella
        const hechas = nuevas.map(n => { const v = db[tabla].find(f => f[clave] === n[clave]); if (v) { Object.assign(v, n, { id: v.id }); return v; } db[tabla].push(n); return n; });
        return route.fulfill({ status: 201, headers: h, contentType: 'application/json', body: JSON.stringify(hechas) });
      }
      db[tabla].push(...nuevas);
      return route.fulfill({ status: 201, headers: h, contentType: 'application/json', body: JSON.stringify(nuevas) });
    }
    if (m === 'PATCH') { filas.forEach(f => Object.assign(f, cuerpo, { updated_at: new Date().toISOString() })); return route.fulfill({ status: 204, headers: h, body: '' }); }
    if (m === 'DELETE') {
      db[tabla] = (db[tabla] ?? []).filter(f => !filas.includes(f));
      if (tabla === 'proyectos') for (const t of Object.keys(db)) if (t.startsWith('proyecto_')) db[t] = db[t].filter(f => !filas.some(p => p.id === f.proyecto_id));
      return route.fulfill({ status: 204, headers: h, body: '' });
    }
    return route.fulfill({ status: 405, headers: h, body: '' });
  }
  return { db, reg, manejar };
}

export async function preparar(ctx, { email, base }) {
  await ctx.route(`${SB}/rest/v1/**`, base.manejar);
  await ctx.route(`${SB}/functions/v1/**`, async route => {
    base.reg.funciones.push({ url: route.request().url(), body: route.request().postDataJSON() });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  await ctx.route(`${SB}/auth/v1/**`, route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  if (email) {
    await ctx.addInitScript(([k, v]) => { localStorage.setItem(k, v); localStorage.setItem('hub_tour_visto', '1'); },
      [`sb-${REF}-auth-token`, JSON.stringify(sesion(email))]);
  }
}
