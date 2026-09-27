// Buscador de pantallas (Ctrl+K): filtra los módulos por título, grupo y
// explicación, y abre el elegido con Enter.
import { esc } from '../ui/dom';
import { visibles, hrefDe } from '../modulos/inicio';

const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function abrirBuscador() {
  const dlg = document.getElementById('buscador') as HTMLDialogElement;
  const campo = document.getElementById('bus-campo') as HTMLInputElement;
  campo.value = '';
  filtrarBuscador('');
  dlg.showModal();
  campo.focus();
}

export function cerrarBuscador() {
  (document.getElementById('buscador') as HTMLDialogElement).close();
}

export function filtrarBuscador(q: string) {
  const t = normal(q.trim());
  const lista = visibles().filter(m => !t || normal(`${m.titulo} ${m.grupo} ${m.explicacion}`).includes(t));
  document.getElementById('bus-resultados')!.innerHTML = lista.map((m, i) => `
    <li><a href="${esc(hrefDe(m))}" class="${i === 0 ? 'activo' : ''}"${m.enlaceExterno ? ' target="_blank" rel="noopener"' : ''} data-action="cerrarBuscador">
      <span aria-hidden="true">${esc(m.icono)}</span> ${esc(m.titulo)} <small>${esc(m.grupo)}</small></a></li>`).join('')
    || '<li class="vacio">Nada con ese nombre.</li>';
}

// Enter abre el primero.
export function buscadorEnter() {
  (document.querySelector('#bus-resultados a') as HTMLAnchorElement | null)?.click();
}

export function instalarAtajoBuscador() {
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); abrirBuscador(); }
  });
}
