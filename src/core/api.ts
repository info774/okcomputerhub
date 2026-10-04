// Cliente PostgREST del hub, portado de okcomputerclaude/public/js/api.js.
// Siempre sobre el esquema `hub` (Accept-Profile / Content-Profile): `public`
// es de Breeze y ni siquiera está expuesto.
//
// Lo que se conserva de la app actual:
//   · timeout de 10 s en lecturas y 30 s en escrituras (pensado para 3G: un
//     POST abortado a los 10 s deja sin saber si el registro se creó);
//   · un reintento si el JWT caducó (401 PGRST303) con el token refrescado;
//   · fetchAll() para pasar del tope de 1000 filas, que PROPAGA el error: una
//     caída a mitad de paginación no puede parecer una lista completa.
// Y desde la paridad del bloque 6 (2026-10-04), como la app:
//   · cola sin red (core/cola.ts): las escrituras de la calle se guardan en el
//     móvil y salen solas al volver la red; los POST llevan su id de cliente;
//   · última copia de las lecturas de la calle (core/lecturas.ts) cuando falla
//     la red, con lo pendiente de la cola superpuesto;
//   · deshacer (core/deshacer.ts): un observador de escrituras que fotografía
//     lo que va a cambiar (registrarObservadorEscrituras).

import { SUPABASE_URL, SUPABASE_ANON_KEY, ESQUEMA } from './config';
import { token, refrescarToken } from './auth';
import { usuario } from './estado';
import { encolable, soloSinRed, encolar, conIdCliente, aplicarPendientes, registrarEnviador } from './cola';
import { LECTURAS_OFFLINE, claveLectura, guardarLectura, leerLectura } from './lecturas';

export type Fila = Record<string, any>;
export interface ErrorApi { status?: number; message: string; code?: string }
// `encolado`: sin red, guardado en el móvil (saldrá solo). `deCache`: lectura sin red, con la última copia (su fecha).
export interface Resultado<T> { data: T | null; error: ErrorApi | null; total?: number | null; encolado?: boolean; deCache?: number }

// El deshacer se engancha aquí (como en la app): `antes` fotografía lo que se va
// a tocar y `despues` lo apunta si salió bien. Sin import circular: se registra.
export interface ObservadorEscrituras {
  antes(metodo: string, tabla: string, params: Params, body: unknown): Promise<unknown>;
  despues(ctx: unknown, res: Resultado<unknown>): void;
}
let _observador: ObservadorEscrituras | null = null;
export function registrarObservadorEscrituras(o: ObservadorEscrituras) { _observador = o; }
type Params = Record<string, string>;
type Metodo = 'GET' | 'HEAD' | 'POST' | 'PATCH' | 'DELETE';

const API_BASE = `${SUPABASE_URL}/rest/v1`;

function cabeceras(extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token() ?? SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    'Accept-Profile': ESQUEMA,
    'Content-Profile': ESQUEMA,
    // La auditoría del hub apunta de dónde sale cada escritura.
    'x-hub-origen': 'app-hub',
    ...extra,
  };
}

function totalDe(res: Response): number | null {
  const m = res.headers.get('Content-Range')?.match(/\/(\d+)$/);
  return m ? Number(m[1]) : null;
}

async function unaVez(method: Metodo, url: string, extra: Record<string, string>, body: unknown, ms: number) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      method,
      headers: cabeceras(extra),
      body: body == null ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

type Opciones = { single?: boolean; contar?: boolean; upsert?: boolean };

export class API {
  static async req<T = Fila[]>(method: Metodo, tabla: string, params: Params = {}, body: unknown = null, opciones: Opciones = {}): Promise<Resultado<T>> {
    if (method === 'GET') return this.leer<T>(tabla, params, opciones);
    if (method === 'HEAD') return this._raw<T>(method, tabla, params, body, opciones);
    // Escrituras: cola sin red y deshacer.
    const cola = encolable(method, tabla, !!opciones.upsert);
    if (cola && navigator.onLine === false) return this.aCola<T>(method, tabla, params, body);
    // El id del POST se pone ANTES del primer intento: si la respuesta se pierde, el reenvío lleva el mismo.
    const cuerpo = cola && method === 'POST' && !tabla.startsWith('rpc/') ? conIdCliente(body) : body;
    const foto = _observador && !tabla.startsWith('rpc/') && !opciones.upsert ? await _observador.antes(method, tabla, params, cuerpo) : null;
    const res = await this._raw<T>(method, tabla, params, cuerpo, opciones);
    if (cola && res.error && !res.error.status && !soloSinRed(tabla)) return this.aCola<T>(method, tabla, params, cuerpo);
    if (foto) _observador!.despues(foto, res as Resultado<unknown>);
    return res;
  }

  private static async aCola<T>(method: Metodo, tabla: string, params: Params, body: unknown): Promise<Resultado<T>> {
    const { body: cuerpo } = await encolar(method, tabla, params, body);
    const data = method === 'POST' && !tabla.startsWith('rpc/') ? (Array.isArray(cuerpo) ? cuerpo : [cuerpo]) : null;
    return { data: data as T, error: null, encolado: true };
  }

  // Lectura con la última copia si falla la red (solo las tablas de la calle) y lo pendiente encima.
  private static async leer<T>(tabla: string, params: Params, opciones: Opciones): Promise<Resultado<T>> {
    const res = await this._raw<T>('GET', tabla, params, null, opciones);
    const u = usuario()?.id;
    const guardable = u && LECTURAS_OFFLINE.has(tabla);
    const clave = guardable ? claveLectura(u, tabla, params, !!opciones.single) : '';
    if (!res.error) {
      if (guardable) guardarLectura(clave, res.data);
      return { ...res, data: aplicarPendientes(tabla, res.data, params) };
    }
    if (guardable && !res.error.status) {
      const copia = await leerLectura(clave);
      if (copia) return { data: aplicarPendientes(tabla, copia.data, params) as T, error: null, deCache: copia.at };
    }
    return res;
  }

  // La petición tal cual, sin cola, copia ni deshacer (la usan la cola al vaciarse y el deshacer al revertir).
  static async _raw<T = Fila[]>(method: Metodo, tabla: string, params: Params = {}, body: unknown = null, opciones: Opciones = {}): Promise<Resultado<T>> {
    const url = new URL(`${API_BASE}/${tabla}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const extra: Record<string, string> = {
      Accept: opciones.single ? 'application/vnd.pgrst.object+json' : 'application/json',
    };
    const prefer: string[] = [];
    if (method === 'POST') prefer.push('return=representation');
    if (method === 'POST' && opciones.upsert) prefer.push('resolution=merge-duplicates');
    if (method === 'PATCH' || method === 'DELETE') prefer.push('return=minimal');
    if (opciones.contar) prefer.push('count=exact');
    if (prefer.length) extra.Prefer = prefer.join(',');

    const ms = method === 'GET' || method === 'HEAD' ? 10000 : 30000;
    try {
      let res = await unaVez(method, url.toString(), extra, body, ms);
      if (res.status === 401) {
        const txt = await res.text();
        let caducado = false;
        try { caducado = JSON.parse(txt)?.code === 'PGRST303'; } catch { /* no es JSON */ }
        if (!caducado || !(await refrescarToken())) return { data: null, error: { status: 401, message: txt } };
        res = await unaVez(method, url.toString(), extra, body, ms);
      }
      if (!res.ok) {
        const txt = await res.text();
        let code: string | undefined;
        try { code = JSON.parse(txt)?.code; } catch { /* idem */ }
        console.error(`API ${method} ${tabla}:`, res.status, txt);
        return { data: null, error: { status: res.status, message: txt, code } };
      }
      const total = totalDe(res);
      if (res.status === 204 || method === 'HEAD') return { data: null, error: null, total };
      const data = await res.json();
      return { data: opciones.single && Array.isArray(data) ? data[0] : data, error: null, total };
    } catch (e: any) {
      const timeout = e?.name === 'AbortError';
      console.error(timeout ? `API timeout ${method} ${tabla}` : 'Fetch error:', e);
      return { data: null, error: { message: timeout ? 'Sin conexión — inténtalo de nuevo' : String(e?.message ?? e) } };
    }
  }

  static get<T = Fila[]>(tabla: string, params: Params = {}) { return this.req<T>('GET', tabla, params); }
  static single<T = Fila>(tabla: string, params: Params = {}) { return this.req<T>('GET', tabla, params, null, { single: true }); }
  static post<T = Fila[]>(tabla: string, body: unknown) { return this.req<T>('POST', tabla, {}, body); }
  // Insertar o actualizar por la clave indicada (on_conflict).
  static upsert<T = Fila[]>(tabla: string, clave: string, body: unknown) {
    return this.req<T>('POST', tabla, { on_conflict: clave }, body, { upsert: true });
  }
  static patch(tabla: string, filtro: Params, body: unknown) { return this.req<null>('PATCH', tabla, filtro, body); }
  static delete(tabla: string, filtro: Params) { return this.req<null>('DELETE', tabla, filtro); }
  // Función SQL expuesta por PostgREST (esquema hub).
  static rpc<T = unknown>(funcion: string, args: Record<string, unknown> = {}) { return this.req<T>('POST', `rpc/${funcion}`, {}, args); }

  // Cuántas filas cumplen el filtro, sin traerlas (HEAD + count=exact).
  // Para las baldosas: un número en vivo no puede costar una tabla entera.
  static async contar(tabla: string, filtro: Params = {}): Promise<number | null> {
    const r = await this.req<null>('HEAD', tabla, { ...filtro, select: 'id', limit: '1' }, null, { contar: true });
    return r.error ? null : r.total ?? null;
  }

  static async fetchAll<T = Fila>(tabla: string, params: Params = {}): Promise<Resultado<T[]>> {
    const PAGINA = 1000;
    const todo: T[] = [];
    for (let offset = 0; ; offset += PAGINA) {
      const { data, error } = await this.req<T[]>('GET', tabla, { ...params, limit: String(PAGINA), offset: String(offset) });
      if (error) return { data: todo, error };
      if (!data?.length) break;
      todo.push(...data);
      if (data.length < PAGINA) break;
    }
    return { data: todo, error: null };
  }
}

// La cola manda por aquí (es quien tiene el token y la URL).
registrarEnviador(op => API._raw(op.method as Metodo, op.table, op.params, op.body));
