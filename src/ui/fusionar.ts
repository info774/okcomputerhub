// Botón «Fusionar con…» de las fichas de cliente, contacto y sede: lleva a
// #/duplicados/<tipo>/<id> para buscar la ficha repetida. Solo admins (la base
// también lo exige). Ver src/modulos/duplicados/.
import { esAdmin } from '../core/estado';
import { esc } from './dom';
import { ico } from '../shell/linea';

export function botonFusionar(tipo: 'cliente' | 'contacto' | 'sede', id: string | null | undefined): string {
  if (!esAdmin() || !id) return '';
  return `<a class="btn secundario" href="#/duplicados/${tipo}/${esc(id)}" title="Juntar con una ficha repetida">${ico('fusionar')} Fusionar con…</a>`;
}
