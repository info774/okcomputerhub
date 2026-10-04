// Cola de escrituras sin red (paridad bloque 6, portada de offline-cola.js de
// la app). El técnico trabaja en naves, sótanos y garajes: lo que guarda sin
// cobertura se queda en el móvil (IndexedDB) y sale solo al volver la red.
// Las cuatro reglas de la app, iguales:
//  1. FIFO estricto: de una en una y en orden (un fichaje sobre el trabajo
//     recién creado llega después del trabajo).
//  2. El `id` lo pone el móvil: todo POST de la lista lleva su uuid ANTES del
//     primer intento; reenviarlo es idempotente (un 409 de la clave = ya estaba).
//  3. Lista blanca: solo lo que tiene sentido en la calle y no arrastra
//     integraciones (clientes NO: va a Zoho).
//  4. Lo que el servidor rechaza (400/403/422: validación, RLS, área de la app)
//     no se reintenta para siempre: queda en rojo y la persona decide.
// Lo propio del hub: el fichaje no es una fila sino `hub.fichar` (la misma del
// reloj y de #/hoy). Se encola SOLO sin red (si la petición llegó y se perdió la
// respuesta, repetirla ficharía dos veces) y lleva `p_cuando`, la hora de la
// pulsación: la base la acepta hasta 72 h atrás (20261029_fichar_cuando.sql).
import { idb, idbDisponible } from './idb';
import { usuario } from './estado';

export const TABLAS_OFFLINE = new Set([
  'trabajos', 'tareas', 'tickets', 'agenda', 'trabajo_comentarios', 'ticket_comentarios', 'tablero_notas',
  'checklist_respuestas', 'locales', 'lista_dia', 'comanda_tareas',
]);
// Funciones de la base que se pueden encolar. `soloSinRed`: no idempotentes.
export const RPCS_OFFLINE: Record<string, { soloSinRed: boolean }> = { fichar: { soloSinRed: true }, lista_dia_marcar: { soloSinRed: false } };

const NOMBRE: Record<string, string> = {
  trabajos: 'Trabajo', tareas: 'Tarea', tickets: 'Ticket', agenda: 'Día de agenda', trabajo_comentarios: 'Comentario',
  ticket_comentarios: 'Comentario', tablero_notas: 'Nota', checklist_respuestas: 'Checklist', locales: 'Sitio', lista_dia: 'Lista del día',
  comanda_tareas: 'Comanda', 'rpc/fichar': 'Fichaje', 'rpc/lista_dia_marcar': 'Lista del día',
};
const VERBO: Record<string, string> = { POST: 'Nuevo', PATCH: 'Cambio en', DELETE: 'Borrado de' };
const MAX_INTENTOS = 20;

export interface Op {
  id?: number; ts: number; method: string; table: string; params: Record<string, string>; body: any;
  estado: 'pendiente' | 'error'; intentos: number; ultimoError: string | null; etiqueta: string;
  // De quién es: con otra persona en el mismo móvil, lo suyo no sale con la sesión de otro.
  usuario: string | null;
}
export interface ErrorEnvio { status?: number; message: string }

let _cache: Op[] = [];
const avisar = () => document.dispatchEvent(new CustomEvent('hub:cola', { detail: { pendientes: contarPendientes(), total: _cache.length } }));

// Solo lo de quien ha entrado (lo de otra persona del mismo móvil espera a que vuelva ella).
const mias = (ops: Op[]) => ops.filter(o => !o.usuario || o.usuario === usuario()?.id);

export async function refrescar() {
  try { _cache = idbDisponible ? mias((await idb<Op[]>('cola', 'readonly', s => s.getAll())) ?? []) : []; }
  catch (e) { console.error('Cola: no se pudo leer', e); _cache = []; }
  avisar();
  return _cache;
}

export const operaciones = () => _cache;
export const contarPendientes = () => _cache.filter(o => o.estado === 'pendiente').length;

/** ¿Se puede encolar esta escritura? (lista blanca; los upsert no: pueden pisar filas que no son suyas). */
export function encolable(method: string, tabla: string, upsert = false): boolean {
  if (!idbDisponible || upsert) return false;
  if (tabla.startsWith('rpc/')) return method === 'POST' && !!RPCS_OFFLINE[tabla.slice(4)];
  return TABLAS_OFFLINE.has(tabla);
}
export const soloSinRed = (tabla: string) => !!RPCS_OFFLINE[tabla.replace(/^rpc\//, '')]?.soloSinRed && tabla.startsWith('rpc/');

/** El cuerpo de un POST con su `id` puesto aquí (regla 2). */
export function conIdCliente(body: any): any {
  if (!body || typeof body !== 'object') return body;
  return Array.isArray(body) ? body.map(b => (b.id ? b : { ...b, id: crypto.randomUUID() })) : (body.id ? body : { ...body, id: crypto.randomUUID() });
}

function detalle(body: any): string {
  const b = Array.isArray(body) ? body[0] : body;
  if (!b || typeof b !== 'object') return '';
  for (const k of ['titulo', 'descripcion', 'texto', 'nombre', 'concepto']) if (typeof b[k] === 'string' && b[k].trim()) return b[k].trim().slice(0, 60);
  if (b.p_accion) return ({ traslado: 'traslado', inicio: 'inicio', fin: 'fin' } as Record<string, string>)[b.p_accion] ?? b.p_accion;
  if (b.estado) return `estado: ${b.estado}`;
  return '';
}

export async function encolar(method: string, table: string, params: Record<string, string>, body: any): Promise<{ op: Op; body: any }> {
  let cuerpo = body;
  if (method === 'POST' && !table.startsWith('rpc/')) cuerpo = conIdCliente(cuerpo);
  // El fichaje lleva la hora de la pulsación, no la del envío.
  if (table === 'rpc/fichar') cuerpo = { ...cuerpo, p_cuando: cuerpo?.p_cuando ?? new Date().toISOString() };
  const nombre = NOMBRE[table] ?? table, det = detalle(cuerpo);
  const op: Op = { ts: Date.now(), method, table, params: params ?? {}, body: cuerpo ?? null, estado: 'pendiente', intentos: 0, ultimoError: null, usuario: usuario()?.id ?? null,
    etiqueta: `${table.startsWith('rpc/') ? nombre : `${VERBO[method] ?? method} ${nombre.toLowerCase()}`}${det ? ` · ${det}` : ''}` };
  await idb('cola', 'readwrite', s => s.add(op));
  await refrescar();
  return { op, body: cuerpo };
}

export async function descartar(id: number) { await idb('cola', 'readwrite', s => s.delete(id)); await refrescar(); }
export async function reintentar(id: number) {
  const op = _cache.find(o => o.id === id);
  if (!op) return;
  await idb('cola', 'readwrite', s => s.put({ ...op, estado: 'pendiente', intentos: 0, ultimoError: null }));
  await refrescar();
}

// ── Lectura optimista (aplicarPendientes de la app) ─────────────────────────
// Lo que sigue en la cola, superpuesto a lo leído: el técnico ve lo que acaba
// de guardar. Un PATCH/DELETE solo toca filas que ya venían; un POST solo se
// añade si la consulta no filtraba (si no, colaría donde no toca).
const SIN_FILTRO = new Set(['select', 'order', 'limit', 'offset']);
const idDe = (p: Record<string, string>) => (typeof p?.id === 'string' && p.id.startsWith('eq.') ? p.id.slice(3) : null);

export function aplicarPendientes(tabla: string, filas: any, params: Record<string, string>): any {
  if (!_cache.length || !Array.isArray(filas)) return filas;
  if (tabla === 'sesiones') return sesionesConFichajes(filas, params);
  const ops = _cache.filter(o => o.table === tabla && o.estado === 'pendiente');
  if (!ops.length) return filas;
  const nuevos = Object.keys(params ?? {}).every(k => SIN_FILTRO.has(k));
  let out = filas.slice();
  for (const op of ops) {
    if (op.method === 'POST') {
      if (!nuevos) continue;
      for (const n of (Array.isArray(op.body) ? op.body : [op.body]).filter(Boolean)) if (!out.some(f => f.id === n.id)) out.push({ ...n, _pendiente: true });
    } else {
      const id = idDe(op.params);
      if (!id) continue;
      out = op.method === 'DELETE' ? out.filter(f => f.id !== id) : out.map(f => (f.id === id ? { ...f, ...op.body, _pendiente: true } : f));
    }
  }
  return out;
}

// Los fichajes encolados sobre las sesiones abiertas (la consulta de #/hoy:
// `fin=is.null`), con las MISMAS reglas que hub.fichar: el inicio cierra la que
// estaba en curso y reusa un traslado abierto; el fin cierra la que tiene inicio.
function sesionesConFichajes(filas: any[], params: Record<string, string>) {
  const ops = _cache.filter(o => o.table === 'rpc/fichar' && o.estado === 'pendiente');
  if (!ops.length || params?.fin !== 'is.null') return filas;
  let abiertas = filas.filter(f => !f.fin).map(f => ({ ...f }));
  for (const op of ops) {
    const b = op.body ?? {}, t = b.p_cuando;
    const actual = abiertas[0];
    if (b.p_accion === 'traslado') abiertas.unshift({ id: `pendiente-${op.id}`, traslado: t, inicio: null, fin: null, created_at: t, _pendiente: true });
    else if (b.p_accion === 'inicio') {
      if (actual && !actual.inicio) Object.assign(actual, { inicio: t, entidad_tipo: b.p_tipo, entidad_id: b.p_id, _pendiente: true });
      else { if (actual?.inicio) abiertas = abiertas.slice(1); abiertas.unshift({ id: `pendiente-${op.id}`, inicio: t, entidad_tipo: b.p_tipo, entidad_id: b.p_id, fin: null, created_at: t, _pendiente: true }); }
    } else if (b.p_accion === 'fin' && actual?.inicio) abiertas = abiertas.slice(1);
  }
  return abiertas;
}

// ── Envío ───────────────────────────────────────────────────────────────────
let _enviador: ((op: Op) => Promise<{ error: ErrorEnvio | null }>) | null = null;
export function registrarEnviador(fn: typeof _enviador) { _enviador = fn; }
let _enviando = false;

function veredicto(error: ErrorEnvio | null, op: Op): 'ok' | 'reintentar' | 'error' {
  if (!error) return 'ok';
  const st = error.status;
  if (!st) return 'reintentar';                     // sin respuesta: red caída o timeout
  if (st === 409 && op.method === 'POST' && /_pkey|duplicate key/i.test(error.message)) return 'ok';  // ya había llegado
  if (st === 401 || st === 408 || st === 429 || st >= 500) return 'reintentar';
  return 'error';
}

/** Manda la cola en orden. Se para al primer fallo de red; lo rechazado queda en rojo y no bloquea lo de detrás. */
export async function enviarCola(): Promise<{ enviadas: number; fallidas: number; pendientes: number }> {
  if (!idbDisponible || !_enviador || _enviando || navigator.onLine === false) return { enviadas: 0, fallidas: 0, pendientes: contarPendientes() };
  _enviando = true;
  let enviadas = 0, fallidas = 0;
  try {
    const cola = mias((await idb<Op[]>('cola', 'readonly', s => s.getAll())) ?? []);
    for (const op of cola.filter(o => o.estado === 'pendiente')) {
      const { error } = await _enviador(op);
      const v = veredicto(error, op);
      if (v === 'ok') { await idb('cola', 'readwrite', s => s.delete(op.id!)); enviadas++; continue; }
      if (v === 'reintentar') {
        const intentos = op.intentos + 1;
        if (intentos < MAX_INTENTOS) { await idb('cola', 'readwrite', s => s.put({ ...op, intentos, ultimoError: error?.message ?? 'Sin conexión' })); break; }
        await idb('cola', 'readwrite', s => s.put({ ...op, estado: 'error', intentos, ultimoError: `No se pudo enviar tras muchos intentos: ${error?.message ?? ''}` }));
        fallidas++;
        continue;
      }
      await idb('cola', 'readwrite', s => s.put({ ...op, estado: 'error', intentos: op.intentos + 1, ultimoError: error?.message ?? 'Rechazado por el servidor' }));
      fallidas++;
    }
  } catch (e) { console.error('Cola: fallo enviando', e); }
  finally { _enviando = false; await refrescar(); }
  return { enviadas, fallidas, pendientes: contarPendientes() };
}

if (idbDisponible) void refrescar();
