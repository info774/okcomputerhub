// Enlace «🕘 Historial de cambios» de una ficha (paridad bloque 6, verCambios
// de la app): lleva a #/registro/<tabla>/<id>. Solo para admins, como la app
// (la auditoría solo la leen ellos); a los demás no se les pinta nada.
import { esAdmin } from '../core/estado';
import { esc } from './dom';

export function enlaceHistorial(tabla: string, id: string | null | undefined): string {
  if (!esAdmin() || !id) return '';
  return `<a class="btn secundario" href="#/registro/${esc(tabla)}/${esc(id)}" title="Quién cambió qué y cuándo">🕘 Historial</a>`;
}
