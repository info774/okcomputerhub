// Auth con supabase-js (SOLO Auth: los datos van por core/api.ts).
import { createClient, type Session } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    // Sin Web Lock: en Chrome un lock huérfano hacía esperar 5 s a getSession()
    // al recargar (mismo arreglo que la app actual).
    lock: (_n: string, _t: number, fn: () => Promise<any>) => fn(),
  },
});

let _token: string | null = null;
let _email: string | null = null;

export const token = () => _token;
export const emailSesion = () => _email;

function aplicar(s: Session | null) {
  _token = s?.access_token ?? null;
  _email = s?.user?.email ?? null;
}

export async function sesionInicial(): Promise<Session | null> {
  const { data } = await sb.auth.getSession();
  aplicar(data.session);
  return data.session;
}

// Token fresco tras un 401 por JWT caducado (lo usa api.ts).
export async function refrescarToken(): Promise<string | null> {
  const { data } = await sb.auth.getSession();
  aplicar(data.session);
  return _token;
}

export function alCambiarSesion(fn: (s: Session | null) => void) {
  sb.auth.onAuthStateChange((_e, s) => { aplicar(s); fn(s); });
}

export async function entrarConCorreo(email: string, password: string) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (!error) aplicar(data.session);
  return error?.message ?? null;
}

export async function entrarConGoogle() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.origin + location.pathname },
  });
  return error?.message ?? null;
}

export async function salir() {
  await sb.auth.signOut();
  aplicar(null);
}
