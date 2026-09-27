// Tour de bienvenida: resalta las piezas del shell una a una. Sale solo la
// primera vez (localStorage) y a mano desde el botón «?».
import { esc } from '../ui/dom';

const CLAVE = 'hub_tour_visto';
const PASOS: { sel: string; texto: string }[] = [
  { sel: '#menu', texto: 'El menú, por grupos. Lo marcado con ↗ sigue en la app actual y se abre en otra pestaña.' },
  { sel: '#buscador-btn', texto: 'Buscador de pantallas: también con Ctrl+K.' },
  { sel: '#pantalla-explicacion', texto: 'Cada pantalla empieza con un párrafo que explica qué es y de dónde salen sus datos.' },
  { sel: '#tema-btn', texto: 'Tema claro u oscuro.' },
];

let paso = 0;

function pintar() {
  document.getElementById('tour')?.remove();
  document.querySelectorAll('.tour-foco').forEach(e => e.classList.remove('tour-foco'));
  const p = PASOS[paso];
  if (!p) { try { localStorage.setItem(CLAVE, '1'); } catch { /* idem */ } return; }
  const obj = document.querySelector(p.sel);
  if (!obj || !(obj as HTMLElement).offsetParent) { paso++; pintar(); return; }
  obj.classList.add('tour-foco');
  const r = obj.getBoundingClientRect();
  const caja = document.createElement('div');
  caja.id = 'tour';
  caja.setAttribute('role', 'dialog');
  caja.innerHTML = `<p>${esc(p.texto)}</p>
    <div class="acciones"><span>${paso + 1} / ${PASOS.length}</span>
      <button class="btn secundario" data-action="tourCerrar">Cerrar</button>
      <button class="btn" data-action="tourSiguiente">${paso + 1 < PASOS.length ? 'Siguiente' : 'Listo'}</button></div>`;
  document.body.appendChild(caja);
  const top = Math.min(r.bottom + 8, innerHeight - caja.offsetHeight - 8);
  const left = Math.max(8, Math.min(r.left, innerWidth - caja.offsetWidth - 8));
  caja.style.top = `${Math.max(8, top)}px`;
  caja.style.left = `${left}px`;
}

export function empezarTour() { paso = 0; pintar(); }
export function tourSiguiente() { paso++; pintar(); }
export function tourCerrar() { paso = PASOS.length; pintar(); }
export function tourSiEsNuevo() {
  let visto = false;
  try { visto = localStorage.getItem(CLAVE) === '1'; } catch { /* idem */ }
  if (!visto) setTimeout(empezarTour, 400);
}
