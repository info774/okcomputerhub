// Personas del equipo (hub.usuarios activos), para responsables y nombres.
// Una sola carga en vuelo y caché de 5 minutos: la lista cambia poco.
import { API } from './api';
import type { Usuario } from './estado';

let _lista: Usuario[] = [];
let _cargado = 0;
let _enVuelo: Promise<Usuario[]> | null = null;

export function equipo(): Promise<Usuario[]> {
  if (Date.now() - _cargado < 5 * 60_000) return Promise.resolve(_lista);
  return (_enVuelo ??= API.get<Usuario[]>('usuarios', { select: 'id,nombre,email,rol,activo', activo: 'eq.true', order: 'nombre' })
    .then(r => {
      _cargado = Date.now(); // se apunta el intento aunque falle: no se reintenta en cada repintado
      if (!r.error && r.data) _lista = r.data;
      return _lista;
    })
    .finally(() => { _enVuelo = null; }));
}

export function nombreDe(id: string | null | undefined): string {
  if (!id) return '';
  const u = _lista.find(x => x.id === id);
  return u ? u.nombre.replace(/\s*\(.*\)\s*$/, '') : '';
}
