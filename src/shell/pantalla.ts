// Pintar una pantalla (módulo) dentro de un contenedor. Lo comparten el shell
// clásico (en #pantalla) y el modo escritorio (en el cuerpo de su ventana).
import type { Modulo } from '../core/modulo';
import { esAdmin } from '../core/estado';
import { esc } from '../ui/dom';
import { ico } from './linea';

export async function pintarPantalla(el: HTMLElement, m: Modulo, params: string[]) {
  el.innerHTML = '';
  // El menú ya no enseña lo de admin, pero la URL se puede escribir a mano.
  // (Los datos los protege la RLS; esto evita una pantalla a medias.)
  if (m.soloAdmin && !esAdmin()) {
    el.innerHTML = '<p class="aviso">Esta pantalla es solo para administradores.</p>';
    return;
  }
  if (m.pintar) {
    try { await m.pintar(el, params); }
    catch (e: any) {
      console.error(`[${m.id}]`, e);
      el.innerHTML = `<p class="aviso mal">Esta pantalla ha fallado al cargar: ${esc(e?.message ?? e)}</p>`;
    }
  } else if (m.enlaceExterno) {
    el.innerHTML = `<p><a class="btn" href="${esc(m.enlaceExterno)}" target="_blank" rel="noopener">Abrir en la app actual ${ico('externo')}</a></p>`;
  }
}
