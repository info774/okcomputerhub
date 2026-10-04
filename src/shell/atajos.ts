// Atajos globales (paridad bloque 6, ui/atajos.js de la app). F5 GUARDA en vez
// de recargar: el formulario donde se está escribiendo o, si no, el ÚNICO
// formulario visible de la pantalla de delante con su botón principal. Si no
// hay nada claro que guardar, F5 recarga como siempre (mejor que un F5 que no
// hace nada). Ctrl+Z (⌘Z) deshace lo último guardado (core/deshacer.ts),
// salvo escribiendo en un campo, donde es el deshacer del propio texto. ESC ya
// lo llevan el buscador, el dock y las ventanas.
import { hayDeshacer } from '../core/deshacer';
import { deshacerConAviso } from './pendientes';
const visible = (el: Element) => (el as HTMLElement).getClientRects().length > 0;

function principal(f: HTMLFormElement): HTMLButtonElement | null {
  return [...f.querySelectorAll<HTMLButtonElement>('button[type="submit"]')].find(b => visible(b) && !b.disabled && !b.classList.contains('secundario')) ?? null;
}

function formularioAGuardar(): HTMLFormElement | null {
  const activo = document.activeElement?.closest('form');
  if (activo && principal(activo)) return activo;
  // La pantalla de delante: la ventana del escritorio con foco o #pantalla.
  const zona = document.querySelector('.os-win.activa .os-win-cuerpo') ?? document.getElementById('pantalla');
  const candidatos = [...(zona?.querySelectorAll<HTMLFormElement>('form') ?? [])].filter(f => visible(f) && principal(f));
  return candidatos.length === 1 ? candidatos[0] : null;
}

const escribiendo = (el: Element | null) => !!el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || (el as HTMLElement).isContentEditable);

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') {
    if (escribiendo(document.activeElement) || !hayDeshacer()) return;
    e.preventDefault();
    void deshacerConAviso();
    return;
  }
  if (e.key !== 'F5' || e.ctrlKey || e.shiftKey || e.metaKey || e.altKey) return;
  const f = formularioAGuardar();
  if (!f) return;
  e.preventDefault();
  f.requestSubmit(principal(f)!);
});
