// Editor de líneas de presupuesto (renderLineas / addLineaFromCatalogo /
// addLineaManual de la app), compartido por el formulario del presupuesto y
// el de las plantillas: una tabla editable (concepto, cantidad, precio,
// descuento, subtotal) con «Añadir del catálogo» (buscador sobre el espejo de
// `catalogo`) y «Línea a mano». Lo tecleado vive en memoria hasta guardar;
// quien guarda pide lineasDe(prefijo). Ids: <prefijo>-lin-*.
import { API } from '../../core/api';
import { registrarAcciones } from '../../core/dispatcher';
import { esc } from '../../ui/dom';
import { eur } from '../ventas/datos';

export interface LineaEd { nombre: string; cantidad: number; precio: number; descuento: number }
interface Producto { id: string; nombre: string; precio: number | null; categoria: string | null; referencia: string | null; unidad: string | null }

const _eds = new Map<string, LineaEd[]>();
let _catalogo: Producto[] | null = null;
let _cargandoCat: Promise<Producto[]> | null = null;

export const subtotal = (l: LineaEd) => Math.round(l.precio * l.cantidad * (1 - l.descuento / 100) * 100) / 100;
export const totalDe = (ls: LineaEd[]) => ls.reduce((s, l) => s + subtotal(l), 0);
export const lineasDe = (pre: string): LineaEd[] => (_eds.get(pre) ?? []).filter(l => l.nombre.trim());

/** Normaliza lo que venga (filas de documento_lineas, jsonb de una plantilla). */
export const aLinea = (x: any): LineaEd => ({
  nombre: String(x?.nombre ?? ''), cantidad: Number(x?.cantidad ?? 1) || 1, precio: Number(x?.precio ?? 0) || 0, descuento: Number(x?.descuento ?? 0) || 0,
});

function catalogo(): Promise<Producto[]> {
  if (_catalogo) return Promise.resolve(_catalogo);
  _cargandoCat ??= API.fetchAll<Producto>('catalogo', { select: 'id,nombre,precio,categoria,referencia,unidad', activo: 'neq.false', order: 'nombre' })
    .then(r => { _catalogo = r.data ?? []; _cargandoCat = null; return _catalogo; });
  return _cargandoCat;
}

/** El HTML del editor; las líneas de partida se quedan en memoria con su prefijo. */
export function editorLineas(pre: string, lineas: LineaEd[], escribe = true): string {
  _eds.set(pre, lineas.map(aLinea));
  return `<div class="pl-editor" id="${pre}-lin">${cuerpo(pre, escribe)}</div>
    ${escribe ? `<div class="acciones pl-anadir">
      <input id="${pre}-lin-cat" type="search" autocomplete="off" placeholder="Añadir del catálogo: nombre, referencia o categoría…" aria-label="Buscar en el catálogo" data-on-input="lnCatBuscar:${pre},$value">
      <button type="button" class="btn secundario" data-action="lnAnadir" data-p0="${pre}">+ Línea a mano</button></div>
    <ul id="${pre}-lin-res" class="resultados"></ul>` : ''}`;
}

/** Añade líneas (p. ej. las de una plantilla) sumando cantidades si el concepto ya está. */
export function sumarLineas(pre: string, nuevas: LineaEd[]) {
  const ls = _eds.get(pre) ?? [];
  for (const n of nuevas.map(aLinea)) {
    const ya = ls.find(l => l.nombre.trim().toLowerCase() === n.nombre.trim().toLowerCase() && l.precio === n.precio);
    if (ya) ya.cantidad += n.cantidad; else ls.push(n);
  }
  _eds.set(pre, ls);
  repintar(pre);
}

function cuerpo(pre: string, escribe: boolean): string {
  const ls = _eds.get(pre) ?? [];
  const num = (i: number, k: keyof LineaEd, v: number, extra: string) => escribe
    ? `<input type="number" ${extra} value="${v}" aria-label="${k}" data-on-change="lnCampo:${pre},${i},${k},$value">` : String(v);
  return `<table class="tabla pl-tabla"><thead><tr><th>Concepto</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Dto. %</th><th class="num">Subtotal</th>${escribe ? '<th></th>' : ''}</tr></thead>
    <tbody>${ls.map((l, i) => `<tr data-linea="${i}">
      <td>${escribe ? `<input value="${esc(l.nombre)}" aria-label="Concepto" placeholder="Concepto" data-on-change="lnCampo:${pre},${i},nombre,$value">` : esc(l.nombre)}</td>
      <td class="num">${num(i, 'cantidad', l.cantidad, 'min="0" step="0.5"')}</td>
      <td class="num">${num(i, 'precio', l.precio, 'min="0" step="0.01"')}</td>
      <td class="num">${num(i, 'descuento', l.descuento, 'min="0" max="100" step="1"')}</td>
      <td class="num">${eur(subtotal(l), 2)}</td>
      ${escribe ? `<td><button type="button" class="btn secundario" data-action="lnQuitar" data-p0="${pre}" data-p1="${i}" aria-label="Quitar la línea">🗑</button></td>` : ''}</tr>`).join('')
      || `<tr><td colspan="${escribe ? 6 : 5}" class="vacio">Sin líneas: añade del catálogo o a mano.</td></tr>`}</tbody>
    <tfoot><tr><th colspan="4">Total (sin impuestos)</th><th class="num" id="${pre}-lin-total">${eur(totalDe(ls), 2)}</th>${escribe ? '<th></th>' : ''}</tr></tfoot></table>`;
}

function repintar(pre: string) {
  const caja = document.getElementById(`${pre}-lin`);
  if (caja) caja.innerHTML = cuerpo(pre, true);
}

let _timer: number | undefined;
registrarAcciones({
  // Sin repintar la tabla: `change` salta al perder el foco (p. ej. al pulsar
  // otro botón) y cambiar el innerHTML en ese momento rompe el clic que viene.
  lnCampo(pre: string, i: string, k: keyof LineaEd, v: string) {
    const ls = _eds.get(pre) ?? [];
    const l = ls[Number(i)];
    if (!l) return;
    if (k === 'nombre') { l.nombre = v; return; }
    l[k] = Math.max(0, Number(String(v).replace(',', '.')) || 0);
    if (k === 'cantidad' && !l.cantidad) l.cantidad = 1;
    const fila = document.querySelector(`#${pre}-lin tr[data-linea="${i}"]`);
    const celda = fila?.querySelectorAll('td')[4];
    if (celda) celda.textContent = eur(subtotal(l), 2);
    const total = document.getElementById(`${pre}-lin-total`);
    if (total) total.textContent = eur(totalDe(ls), 2);
  },
  lnQuitar(pre: string, i: string) { _eds.get(pre)?.splice(Number(i), 1); repintar(pre); },
  lnAnadir(pre: string) {
    _eds.get(pre)?.push({ nombre: '', cantidad: 1, precio: 0, descuento: 0 });
    repintar(pre);
    const filas = document.querySelectorAll<HTMLInputElement>(`#${pre}-lin tbody tr:last-child input`);
    filas[0]?.focus();
  },
  lnCatBuscar(pre: string, q: string) {
    clearTimeout(_timer);
    _timer = window.setTimeout(async () => {
      const ul = document.getElementById(`${pre}-lin-res`);
      if (!ul) return;
      const t = q.trim().toLowerCase();
      if (t.length < 2) { ul.innerHTML = ''; return; }
      const ps = (await catalogo()).filter(p => [p.nombre, p.referencia, p.categoria].some(x => (x ?? '').toLowerCase().includes(t))).slice(0, 8);
      ul.innerHTML = ps.map(p => `<li><button type="button" data-action="lnCatElegir" data-p0="${esc(pre)}" data-p1="${esc(p.id)}">
          <strong>${esc(p.nombre)}</strong> <small class="nota">${esc([p.categoria, p.referencia].filter(Boolean).join(' · '))}</small></button>
          <span class="nota">${eur(p.precio, 2)}${p.unidad ? `/${esc(p.unidad)}` : ''}</span></li>`).join('') || '<li class="nota">Nada en el catálogo con eso.</li>';
    }, 200);
  },
  async lnCatElegir(pre: string, id: string) {
    const p = (await catalogo()).find(x => x.id === id);
    if (!p) return;
    // documento_lineas no lleva catalogo_id: la línea se enlaza con Zoho por el nombre (zoho-lineas.ts).
    sumarLineas(pre, [{ nombre: p.nombre, cantidad: 1, precio: Number(p.precio ?? 0), descuento: 0 }]);
    const ul = document.getElementById(`${pre}-lin-res`); if (ul) ul.innerHTML = '';
    const q = document.getElementById(`${pre}-lin-cat`) as HTMLInputElement | null; if (q) q.value = '';
  },
});
