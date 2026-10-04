// Última copia de las lecturas del técnico (paridad bloque 6: la caché de la
// app —snapshot-cache.js y las lecturas que guardaba su service worker—). Cada
// lectura buena de estas tablas se guarda en el móvil; si después falla la red,
// se sirve la última copia (y encima, lo que haya en la cola). Por persona: la
// clave lleva su id y al salir se borra todo. Solo las tablas de la calle.
import { idb, idbDisponible } from './idb';

export const LECTURAS_OFFLINE = new Set([
  'sesiones', 'agenda', 'trabajos', 'locales', 'clientes', 'contactos', 'tareas', 'lista_dia', 'tickets', 'comanda_tareas',
  'usuarios', 'areas', 'config', 'checklist_respuestas', 'trabajo_comentarios',
]);
const MAX = 300;
let _escritas = 0;

export const claveLectura = (usuario: string, tabla: string, params: Record<string, string>, unico: boolean) =>
  `${usuario}|${unico ? '1' : '*'}|${tabla}?${Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&')}`;

export function guardarLectura(clave: string, data: unknown) {
  if (!idbDisponible) return;
  void idb('lecturas', 'readwrite', s => s.put({ clave, data, at: Date.now() })).catch(() => {});
  if (++_escritas % 50 === 0) void podar();
}

export async function leerLectura(clave: string): Promise<{ data: unknown; at: number } | null> {
  if (!idbDisponible) return null;
  try { return (await idb<{ data: unknown; at: number } | undefined>('lecturas', 'readonly', s => s.get(clave))) ?? null; } catch { return null; }
}

async function podar() {
  try {
    const todas = (await idb<{ clave: string; at: number }[]>('lecturas', 'readonly', s => s.getAll())) ?? [];
    if (todas.length <= MAX) return;
    const viejas = todas.sort((a, b) => a.at - b.at).slice(0, todas.length - MAX);
    await idb('lecturas', 'readwrite', s => { for (const v of viejas) s.delete(v.clave); });
  } catch { /* da igual: es una caché */ }
}

export async function borrarLecturas() { if (idbDisponible) await idb('lecturas', 'readwrite', s => s.clear()).catch(() => {}); }
