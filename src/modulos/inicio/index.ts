// Inicio: la portada de Oki (vista.ts, se carga bajo demanda) y, debajo, una
// baldosa por módulo con número en vivo (su `contador()`). Cada baldosa se
// pinta al llegar su número; una que falla se queda con «—» y no tumba a las demás.
import type { Modulo } from '../../core/modulo';
import { modulos } from '../../core/router';
import { esAdmin } from '../../core/estado';
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

// Las baldosas de siempre («Todas las pantallas»), debajo de la portada de Oki.
function baldosas(): string {
  const lista = visibles();
  const grupos = [...new Set(lista.map(m => m.grupo))];
  return grupos.map(g => `<section class="grupo-baldosas">
      <h3>${esc(g)}</h3>
      <div class="baldosas">${lista.filter(m => m.grupo === g).map(baldosa).join('')}</div>
    </section>`).join('');
}

async function pintar(el: HTMLElement) {
  await (await import('./vista')).pintar(el, baldosas());
  for (const m of visibles()) {
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
  titulo: 'Oki · centro de mando',
  grupo: 'General',
  icono: '🏠',
  explicacion: 'Oki en el centro y lo que está pasando ahora: cada área con su número al día, las estadísticas del soporte de la semana y lo que necesita a una persona. Debajo, todas las pantallas. Los WhatsApp de los clientes se contestan desde la ventana de abajo a la derecha, en cualquier pantalla.',
  pintar,
};
