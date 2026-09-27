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
// Lo que (aún) no: cola offline y deshacer. Llegarán con los módulos que los
// necesiten.

import { SUPABASE_URL, SUPABASE_ANON_KEY, ESQUEMA } from './config';
import { token, refrescarToken } from './auth';

export type Fila = Record<string, any>;
export interface ErrorApi { status?: number; message: string; code?: string }
export interface Resultado<T> { data: T | null; error: ErrorApi | null; total?: number | null }
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

export class API {
  static async req<T = Fila[]>(method: Metodo, tabla: string, params: Params = {}, body: unknown = null,
    opciones: { single?: boolean; contar?: boolean } = {}): Promise<Resultado<T>> {
    const url = new URL(`${API_BASE}/${tabla}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const extra: Record<string, string> = {
      Accept: opciones.single ? 'application/vnd.pgrst.object+json' : 'application/json',
    };
    const prefer: string[] = [];
    if (method === 'POST') prefer.push('return=representation');
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
