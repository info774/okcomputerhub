// ¿Quién manda en cada tabla? (hub.areas). Mientras un área es de la app, el
// hub la enseña en SOLO LECTURA; al cortarla (supabase/cortes/), las mismas
// pantallas escriben. Caché de 5 min y una carga en vuelo.
import { API } from './api';
import { APP_ACTUAL_URL } from './config';
import { esc } from '../ui/dom';

let _duenos = new Map<string, string>();
let _at = 0;
let _vuelo: Promise<Map<string, string>> | null = null;

function cargar(): Promise<Map<string, string>> {
  if (Date.now() - _at < 5 * 60_000) return Promise.resolve(_duenos);
  return (_vuelo ??= API.get<{ tablas: string[]; dueno: string }[]>('areas', { select: 'tablas,dueno' }).then(r => {
    _at = Date.now();
    if (!r.error && r.data) _duenos = new Map(r.data.flatMap(a => (a.tablas ?? []).map(t => [t, a.dueno] as [string, string])));
    return _duenos;
  }).finally(() => { _vuelo = null; }));
}

// Una tabla sin área es propia del hub.
export async function esDelHub(...tablas: string[]): Promise<boolean> {
  const m = await cargar();
  return tablas.every(t => (m.get(t) ?? 'hub') === 'hub');
}

export const avisoSoloLectura = (que: string) => `<p class="aviso area-app">🔒 <strong>${esc(que)} se sigue llevando en la app</strong> hasta el cambio: aquí se ve todo, pero se cambia en la
  <a href="${esc(APP_ACTUAL_URL)}" target="_blank" rel="noopener">app actual ↗</a>.</p>`;
