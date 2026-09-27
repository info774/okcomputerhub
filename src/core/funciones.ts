// Llamar a una edge function del hub con la sesión de la persona. Devuelve
// { data, error } en vez de lanzar, como API.
import { token } from './auth';
import { FUNCIONES_URL, SUPABASE_ANON_KEY } from './config';

export async function llamarFuncion<T = Record<string, any>>(nombre: string, cuerpo: Record<string, unknown>, ms = 40000): Promise<{ data: T | null; error: string | null }> {
  try {
    const res = await fetch(`${FUNCIONES_URL}/${nombre}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token()}` },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(ms),
    });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) return { data: null, error: r.error ?? `error ${res.status}` };
    return { data: r as T, error: null };
  } catch (e: any) {
    return { data: null, error: e?.name === 'TimeoutError' ? 'No contesta — inténtalo de nuevo' : String(e?.message ?? e) };
  }
}
