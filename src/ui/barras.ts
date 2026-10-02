// Barras horizontales de UNA serie (--serie-1: verde en claro, lima en noche),
// sin leyenda (el título de la tarjeta la nombra), etiqueta directa a la derecha
// y el detalle en el title al pasar por encima. Si se da `accion`, cada fila es
// clicable (data-action con la clave de la fila en data-p0): suele filtrar.
// Es una tabla de verdad, así que también es su propia «vista en tabla».
import { esc } from './dom';

export interface Barra { clave: string; etiqueta: string; valor: number; texto: string; detalle?: string }

export function barras(id: string, titulo: string, filas: Barra[], accion?: string): string {
  const max = Math.max(1, ...filas.map(f => f.valor));
  return `<section class="tarjeta barras-tarjeta" aria-label="${esc(titulo)}">
    <h3>${esc(titulo)}</h3>
    <table class="barras" id="${esc(id)}"><caption class="sr">${esc(titulo)}</caption>
      <tbody>${filas.map(f => `<tr${accion ? ` class="fila-clic" data-action="${esc(accion)}" data-p0="${esc(f.clave)}"` : ''} title="${esc(f.detalle ?? `${f.etiqueta}: ${f.texto}`)}">
        <th scope="row">${esc(f.etiqueta)}</th>
        <td><span class="barras-pista"><span class="barras-barra" style="width:${Math.max(f.valor ? 1.5 : 0, 100 * f.valor / max).toFixed(1)}%"></span></span></td>
        <td class="num">${f.texto}</td></tr>`).join('') || '<tr><td class="vacio">Sin datos.</td></tr>'}</tbody></table>
  </section>`;
}
