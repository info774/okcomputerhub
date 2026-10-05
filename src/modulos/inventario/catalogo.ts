// Inventario → Catálogo (paridad bloque 8, tanda 4: catalogo.js de la app).
// Los productos y servicios con su precio, agrupados por categoría, con
// filtro por categoría y buscador. Espejo `hub.catalogo` (área `inventario`):
// se ve ya; editar (alta, edición, ocultar, cambiar la categoría de varios a
// la vez) y eliminar se encienden con el corte del área, y como en la app solo
// los hace un admin. Lo oculto (activo = false) solo lo ve un admin.
// Lo que trae los artículos de Zoho Books (sync-zoho-items) sigue en la app.
//   #/inventario/catalogo, #/inventario/catalogo/nuevo, #/inventario/catalogo/<id>
// Prefijo de ids: cat-.
import { API } from '../../core/api';
import { esAdmin } from '../../core/estado';
import { esDelHub, avisoSoloLectura } from '../../core/areas';
import { registrarAcciones } from '../../core/dispatcher';
import { ir, resolver } from '../../core/router';
import { esc, toast } from '../../ui/dom';
import { ico } from '../../shell/linea';
import { pestanas } from './vista';

interface Producto { id: string; nombre: string; categoria: string | null; precio: number | null; unidad: string | null; referencia: string | null; descripcion: string | null; activo: boolean | null; zoho_item_id: string | null }
export const CATEGORIAS = ['Hardware', 'Software', 'Servicio', 'Alarmas', 'CCTV', 'Redes'];
const UNIDADES = ['ud', 'h', 'mes', 'año', 'lote'];
const eur = (n: number | null) => `${(Number(n) || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

let _todos: Producto[] = [];
let _cat = '';
let _q = '';
let _sel = new Set<string>();
let _seleccionando = false;

function lista(): string {
  const q = _q.toLowerCase();
  const vis = _todos.filter(p => (p.activo !== false || esAdmin()) && (!_cat || p.categoria === _cat)
    && (!q || p.nombre.toLowerCase().includes(q) || (p.referencia ?? '').toLowerCase().includes(q)));
  if (!vis.length) return '<p class="vacio">Sin productos.</p>';
  const grupos = new Map<string, Producto[]>();
  for (const p of vis) { const k = p.categoria || 'Sin categoría'; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k)!.push(p); }
  return [...grupos].map(([cat, ps]) => `<section class="tarjeta mo-scroll"><h3>${esc(cat)} <span class="chip">${ps.length}</span></h3>
    <table class="tabla cat-tabla"><thead><tr>${_seleccionando ? '<th></th>' : ''}<th>Producto</th><th>Referencia</th><th class="num">Precio</th><th></th></tr></thead><tbody>
    ${ps.map(p => `<tr class="${p.activo === false ? 'apagado' : ''}">
      ${_seleccionando ? `<td><input type="checkbox" class="cat-sel" ${_sel.has(p.id) ? 'checked' : ''} data-on-change="catMarcar:${esc(p.id)},$checked" aria-label="Seleccionar ${esc(p.nombre)}"></td>` : ''}
      <td><strong>${esc(p.nombre)}</strong>${p.descripcion ? `<br><small class="nota">${esc(p.descripcion.slice(0, 120))}</small>` : ''}</td>
      <td>${esc(p.referencia ?? '')}${p.zoho_item_id ? ' <small class="nota">· Zoho</small>' : ''}</td>
      <td class="num"><strong>${eur(p.precio)}</strong><small class="nota"> /${esc(p.unidad ?? 'ud')}</small></td>
      <td>${p.activo === false ? '<span class="chip">Oculto</span>' : ''}</td></tr>`).join('')}</tbody></table></section>`).join('');
}

async function pintarLista(el: HTMLElement) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const [r, escribe] = await Promise.all([API.fetchAll<Producto>('catalogo', { select: 'id,nombre,categoria,precio,unidad,referencia,descripcion,activo,zoho_item_id', order: 'categoria,nombre' }), esDelHub('catalogo')]);
  if (r.error) { el.innerHTML = `${pestanas('catalogo')}<p class="aviso mal">No se pudo leer el catálogo: ${esc(r.error.message)}</p>`; return; }
  _todos = r.data ?? [];
  const edita = escribe && esAdmin();
  const activos = _todos.filter(p => p.activo !== false).length;
  el.innerHTML = `${escribe ? '' : avisoSoloLectura('El catálogo')}${pestanas('catalogo')}
    <div class="acciones pr-barra"><div class="segmentado" role="tablist">${['', ...CATEGORIAS].map(c => `<button type="button" class="${c === _cat ? 'activo' : ''}" data-action="catFiltro" data-p0="${esc(c)}">${c || 'Todos'}</button>`).join('')}</div>
      <input id="cat-q" type="search" placeholder="Buscar nombre o referencia…" value="${esc(_q)}" data-on-input="catBuscar:$value" aria-label="Buscar en el catálogo">
      <span class="nota">${activos} productos activos</span>
      ${edita ? `<a class="btn" href="#/inventario/catalogo/nuevo">${ico('mas')} Nuevo producto</a>
        <button class="btn secundario" data-action="catSeleccionar">${_seleccionando ? 'Cancelar' : 'Seleccionar'}</button>` : ''}</div>
    ${_seleccionando && edita ? `<div class="acciones pr-barra" id="cat-bloque"><span class="nota" id="cat-cuenta">${_sel.size} seleccionados</span>
      <select id="cat-bloque-cat" aria-label="Nueva categoría"><option value="">Cambiar categoría…</option>${CATEGORIAS.map(c => `<option>${c}</option>`).join('')}</select>
      <button class="btn secundario" data-action="catCambiarCategoria">Cambiar</button><button class="btn peligro" data-action="catEliminarSel">Eliminar</button></div>` : ''}
    <div id="cat-lista">${lista()}</div>
    ${edita ? '<p class="nota">Toca un producto en «Seleccionar» para cambiar varios a la vez; para editar uno, ábrelo desde su nombre.</p>' : ''}`;
  if (edita && !_seleccionando) {
    el.querySelectorAll<HTMLTableRowElement>('.cat-tabla tbody tr').forEach((tr, i) => {
      const p = filtrados()[i];
      if (p) { tr.classList.add('fila-clic'); tr.dataset.action = 'catAbrir'; tr.dataset.p0 = p.id; }
    });
  }
}
// El mismo orden que pinta `lista()` (para enganchar la fila a su producto).
function filtrados() {
  const q = _q.toLowerCase();
  const vis = _todos.filter(p => (p.activo !== false || esAdmin()) && (!_cat || p.categoria === _cat) && (!q || p.nombre.toLowerCase().includes(q) || (p.referencia ?? '').toLowerCase().includes(q)));
  const grupos = new Map<string, Producto[]>();
  for (const p of vis) { const k = p.categoria || 'Sin categoría'; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k)!.push(p); }
  return [...grupos.values()].flat();
}

async function pintarFormulario(el: HTMLElement, id: string | null) {
  const [escribe, r] = await Promise.all([esDelHub('catalogo'), id ? API.single<Producto>('catalogo', { select: '*', id: `eq.${id}` }) : Promise.resolve({ data: null })]);
  const p = r.data as Producto | null;
  if (id && !p) { el.innerHTML = '<p class="aviso mal">No existe ese producto.</p><p><a href="#/inventario/catalogo">← Catálogo</a></p>'; return; }
  const edita = escribe && esAdmin();
  el.innerHTML = `<p><a href="#/inventario/catalogo">← Catálogo</a></p><h2>${p ? esc(p.nombre) : 'Nuevo producto'}</h2>
    ${escribe ? (esAdmin() ? '' : '<p class="aviso">El catálogo lo edita un administrador.</p>') : avisoSoloLectura('El catálogo')}
    <form class="tarjeta" id="cat-form" data-on-submit="catGuardar" data-prevent="1" data-id="${esc(p?.id ?? '')}">
      <fieldset ${edita ? '' : 'disabled'} class="in-campos">
        <label>Nombre <input id="cat-nombre" required maxlength="200" value="${esc(p?.nombre ?? '')}"></label>
        <label>Categoría <select id="cat-categoria">${CATEGORIAS.map(c => `<option ${c === (p?.categoria ?? 'Hardware') ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
        <label>Precio (€, sin impuestos) <input id="cat-precio" type="number" step="0.01" min="0" required value="${p?.precio ?? ''}"></label>
        <label>Unidad <select id="cat-unidad">${UNIDADES.map(u => `<option ${u === (p?.unidad ?? 'ud') ? 'selected' : ''}>${u}</option>`).join('')}</select></label>
        <label>Referencia <input id="cat-referencia" maxlength="80" value="${esc(p?.referencia ?? '')}"></label>
        <label class="ancho">Descripción <textarea id="cat-descripcion" rows="3">${esc(p?.descripcion ?? '')}</textarea></label>
        ${p ? `<label class="check"><input type="checkbox" id="cat-activo" ${p.activo !== false ? 'checked' : ''}> Activo (si no, queda oculto)</label>` : ''}
      </fieldset>
      ${edita ? `<div class="acciones"><button class="btn" type="submit">${p ? 'Guardar' : 'Crear producto'}</button>${p ? '<button type="button" class="btn peligro" data-action="catEliminar">Eliminar</button>' : ''}</div>` : ''}
    </form>`;
}

export async function pintarCatalogo(el: HTMLElement, params: string[]) {
  const [a] = params;
  if (a === 'nuevo') return pintarFormulario(el, null);
  if (a) return pintarFormulario(el, a);
  return pintarLista(el);
}

const val = (id: string) => ((document.getElementById(id) as HTMLInputElement | null)?.value ?? '').trim();
registrarAcciones({
  catFiltro(c: string) { _cat = c; resolver(); },
  catBuscar(q: string) {
    _q = q;
    const c = document.getElementById('cat-lista');
    if (c) c.innerHTML = lista();
  },
  catAbrir(id: string) { ir('inventario', 'catalogo', id); },
  catSeleccionar() { _seleccionando = !_seleccionando; _sel = new Set(); resolver(); },
  catMarcar(id: string, v: boolean) {
    if (v) _sel.add(id); else _sel.delete(id);
    const c = document.getElementById('cat-cuenta'); if (c) c.textContent = `${_sel.size} seleccionados`;
  },
  async catCambiarCategoria() {
    const cat = val('cat-bloque-cat');
    if (!cat) { toast('Elige la categoría', 'error'); return; }
    if (!_sel.size || !confirm(`¿Cambiar la categoría de ${_sel.size} producto(s) a «${cat}»?`)) return;
    const r = await API.patch('catalogo', { id: `in.(${[..._sel].join(',')})` }, { categoria: cat });
    if (r.error) { toast(`No se pudo: ${r.error.message}`, 'error'); return; }
    toast(`Categoría cambiada a ${cat}`);
    _seleccionando = false; _sel = new Set(); resolver();
  },
  async catEliminarSel() {
    if (!_sel.size || !confirm(`¿Eliminar ${_sel.size} producto(s) del catálogo?`)) return;
    const r = await API.delete('catalogo', { id: `in.(${[..._sel].join(',')})` });
    if (r.error) { toast(`No se pudo: ${r.error.message}`, 'error'); return; }
    toast('Productos eliminados');
    _seleccionando = false; _sel = new Set(); resolver();
  },
  async catGuardar() {
    const f = document.getElementById('cat-form') as HTMLFormElement | null;
    const id = f?.dataset.id ?? '';
    const nombre = val('cat-nombre'), precio = Number(val('cat-precio'));
    if (!nombre || !Number.isFinite(precio)) { toast('Nombre y precio son obligatorios', 'error'); return; }
    const cuerpo: Record<string, unknown> = { nombre, precio, categoria: val('cat-categoria'), unidad: val('cat-unidad'),
      referencia: val('cat-referencia') || null, descripcion: val('cat-descripcion') || null,
      activo: id ? (document.getElementById('cat-activo') as HTMLInputElement | null)?.checked ?? true : true };
    const r = id ? await API.patch('catalogo', { id: `eq.${id}` }, cuerpo) : await API.post('catalogo', { id: crypto.randomUUID(), ...cuerpo });
    if (r.error) { toast(`No se pudo guardar: ${r.error.message}`, 'error'); return; }
    toast(id ? 'Producto actualizado' : 'Producto creado');
    ir('inventario', 'catalogo');
  },
  async catEliminar() {
    const id = (document.getElementById('cat-form') as HTMLFormElement | null)?.dataset.id;
    if (!id || !confirm('¿Eliminar este producto del catálogo?')) return;
    const r = await API.delete('catalogo', { id: `eq.${id}` });
    if (r.error) { toast(`No se pudo: ${r.error.message}`, 'error'); return; }
    toast('Producto eliminado');
    ir('inventario', 'catalogo');
  },
});
