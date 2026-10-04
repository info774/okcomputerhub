// Tamaño del texto en el móvil (paridad bloque 6, ui/fontsize.js de la app):
// cada técnico lo ve distinto y se usa a pleno sol. `data-fs` en <html> y el
// CSS (estilo.css, solo móvil) agranda la letra raíz: todo lo que va en rem
// crece con ella. Por dispositivo (localStorage), como el tema.
const NIVELES: [string, string][] = [['', 'Normal'], ['grande', 'Grande'], ['xl', 'Muy grande']];
const leer = () => { try { return localStorage.getItem('hub_texto') ?? ''; } catch { return ''; } };

export function aplicarTexto(nivel = leer()) {
  const v = NIVELES.some(([k]) => k === nivel) ? nivel : '';
  if (v) document.documentElement.setAttribute('data-fs', v); else document.documentElement.removeAttribute('data-fs');
  try { localStorage.setItem('hub_texto', v); } catch { /* sin almacenamiento */ }
  document.querySelectorAll<HTMLButtonElement>('.texto-tam button').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.p0 ?? '') === v)));
}

/** Los tres botones «A» (cada uno a su tamaño, para elegir mirando). Van al pie del menú; solo se ven en el móvil. */
export const controlTexto = () => `<div class="texto-tam" role="group" aria-label="Tamaño del texto"><span>Tamaño del texto</span>
  ${NIVELES.map(([k, t], i) => `<button type="button" data-action="tamTexto" data-p0="${k}" aria-pressed="${k === leer()}" title="${t}" style="font-size:${1 + i * 0.15}rem">A</button>`).join('')}</div>`;
