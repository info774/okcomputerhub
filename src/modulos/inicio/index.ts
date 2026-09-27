// Inicio: una baldosa por módulo con número en vivo (su `contador()`).
// Cada baldosa se pinta al llegar su número; una que falla se queda con «—»
// y no tumba a las demás.
import type { Modulo } from '../../core/modulo';
import { modulos } from '../../core/router';
import { esAdmin, usuario } from '../../core/estado';
import { esc } from '../../ui/dom';

export function visibles(): Modulo[] {
  return modulos().filter(m => m.id !== 'inicio' && (!m.soloAdmin || esAdmin()));
}

export function hrefDe(m: Modulo): string {
  return m.enlaceExterno ?? `#/${m.id}`;
}

function baldosa(m: Modulo): string {
  const externo = m.enlaceExterno ? ' target="_blank" rel="noopener"' : '';
  return `<a class="baldosa" id="bal-${esc(m.id)}" href="${esc(hrefDe(m))}"${externo}>
    <span class="baldosa-icono" aria-hidden="true">${esc(m.icono)}</span>
    <span class="baldosa-titulo">${esc(m.titulo)}${m.enlaceExterno ? ' <small>↗</small>' : ''}</span>
    <span class="baldosa-valor">${m.contador ? '…' : ''}</span>
    <span class="baldosa-sub"></span>
  </a>`;
}

async function pintar(el: HTMLElement) {
  const lista = visibles();
  const grupos = [...new Set(lista.map(m => m.grupo))];
  const nombre = usuario()?.nombre?.split(' ')[0] ?? '';
  el.innerHTML = `
    <h2 class="saludo">Hola${nombre ? `, ${esc(nombre)}` : ''}</h2>
    ${grupos.map(g => `<section class="grupo-baldosas">
      <h3>${esc(g)}</h3>
      <div class="baldosas">${lista.filter(m => m.grupo === g).map(baldosa).join('')}</div>
    </section>`).join('')}`;

  for (const m of lista) {
    if (!m.contador) continue;
    m.contador().then(c => {
      const b = document.getElementById(`bal-${m.id}`);
      if (!b) return;
      b.querySelector('.baldosa-valor')!.textContent = c ? String(c.valor) : '—';
      b.querySelector('.baldosa-sub')!.textContent = c?.subtitulo ?? '';
      b.dataset.tono = c?.tono ?? 'neutro';
    }).catch(() => {
      const v = document.querySelector(`#bal-${m.id} .baldosa-valor`);
      if (v) v.textContent = '—';
    });
  }
}

export const moduloInicio: Modulo = {
  id: 'inicio',
  titulo: 'Inicio',
  grupo: 'General',
  icono: '🏠',
  explicacion: 'Todo de un vistazo: cada baldosa es una pantalla con su número al día. Las marcadas con ↗ siguen en la app actual y se abren en otra pestaña.',
  pintar,
};
