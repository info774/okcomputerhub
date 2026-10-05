// Vista de Inventario (ver index.ts). Solo lectura mientras el área sea de la app.
//
// Reglas que vienen de la app (`public/js/modules/furgonetas.js`):
//   · El «Total» junta un mismo producto de todas las ubicaciones por su ficha
//     de catálogo (`catalogo_id`) o, si no la tiene, por el nombre.
//   · Un movimiento es entrada (+), salida (−) o trasvase (sale de su
//     ubicación hacia `destino_id`); los de un trabajo llevan `trabajo_id`.
import { API } from '../../core/api';
import { esAdmin } from '../../core/estado';
import { registrarAcciones } from '../../core/dispatcher';
import { ir, resolver } from '../../core/router';
import { esDelHub, avisoSoloLectura } from '../../core/areas';
import { esc, hace, fechaHora } from '../../ui/dom';
import { ico } from '../../shell/linea';
import { barras } from '../../ui/barras';
import { eur, enApp } from '../ventas/datos';

interface Ubicacion { id: string; nombre: string; tecnico_responsable: string | null }
interface Producto {
  id: string; furgoneta_id: string | null; nombre: string; categoria: string | null; cantidad: number | null; stock_minimo: number | null;
  notas: string | null; codigo_principal: string | null; codigo_barra: string | null; precio: number | null; catalogo_id: string | null;
}
interface Movimiento {
  id: string; created_at: string; furgoneta_id: string | null; producto_id: string | null; tipo: string | null; cantidad: number | null;
  destino_id: string | null; tecnico_id: string | null; notas: string | null; trabajo_id: string | null;
}

const COLS = 'id,furgoneta_id,nombre,categoria,cantidad,stock_minimo,notas,codigo_principal,codigo_barra,precio,catalogo_id';
const COLS_MOV = 'id,created_at,furgoneta_id,producto_id,tipo,cantidad,destino_id,tecnico_id,notas,trabajo_id';
const TODAS = '';
const TIPO: Record<string, [string, string, string]> = { entrada: ['Entrada', 'bien', '+'], salida: ['Salida', 'mal', '−'], trasvase: ['Trasvase', 'aviso', '⇄'] };

let _ubic: Ubicacion[] = [];
let _prods: Producto[] = [];
let _at = 0;
let _ubicSel = TODAS;
let _q = '';
let _cat = '';
let _bajo = false;
let _tipoMov = '';
let _actual: string | null = null;

const n = (v: number | null | undefined) => Number(v ?? 0);
const num = (v: number) => v.toLocaleString('es-ES', { maximumFractionDigits: 2 });
const bajoMinimo = (p: { cantidad: number | null; stock_minimo: number | null }) => n(p.cantidad) < n(p.stock_minimo);
const nombreUbic = (id: string | null) => _ubic.find(u => u.id === id)?.nombre ?? '—';
const clave = (p: Producto) => p.catalogo_id || `nombre:${p.nombre.trim().toLowerCase()}`;

async function cargar() {
  if (_prods.length && Date.now() - _at < 5 * 60_000) return null;
  const [us, ps] = await Promise.all([
    API.fetchAll<Ubicacion>('furgonetas', { select: 'id,nombre,tecnico_responsable', order: 'nombre' }),
    API.fetchAll<Producto>('furgoneta_inventario', { select: COLS, order: 'categoria.nullslast,nombre' }),
  ]);
  if (us.error || ps.error) return us.error ?? ps.error;
  _ubic = us.data ?? []; _prods = ps.data ?? []; _at = Date.now();
  return null;
}

// Una fila de la tabla: un producto en su ubicación o, en «Todas», el grupo sumado.
interface Fila { id: string | null; nombre: string; categoria: string | null; cantidad: number; minimo: number; precio: number; codigo: string | null; ubicaciones: Producto[] }

function filas(): Fila[] {
  const base = _prods.filter(p => !_ubicSel || p.furgoneta_id === _ubicSel);
  let fs: Fila[];
  if (_ubicSel) {
    fs = base.map(p => ({ id: p.id, nombre: p.nombre, categoria: p.categoria, cantidad: n(p.cantidad), minimo: n(p.stock_minimo), precio: n(p.precio), codigo: p.codigo_principal, ubicaciones: [p] }));
  } else {
    const g = new Map<string, Fila>();
    for (const p of base) {
      const f = g.get(clave(p)) ?? { id: null, nombre: p.nombre, categoria: p.categoria, cantidad: 0, minimo: 0, precio: 0, codigo: null, ubicaciones: [] };
      f.cantidad += n(p.cantidad); f.minimo += n(p.stock_minimo); f.precio = Math.max(f.precio, n(p.precio));
      f.codigo ||= p.codigo_principal; f.categoria ||= p.categoria; f.ubicaciones.push(p);
      g.set(clave(p), f);
    }
    // Un grupo de una sola ubicación abre esa ficha directamente.
    fs = [...g.values()].map(f => ({ ...f, id: f.ubicaciones[0].id }));
  }
  const q = _q.toLowerCase();
  return fs.filter(f => (!_cat || f.categoria === _cat) && (!_bajo || f.cantidad < f.minimo)
    && (!q || [f.nombre, f.categoria, f.codigo, ...f.ubicaciones.map(u => u.codigo_barra)].some(x => (x ?? '').toLowerCase().includes(q))))
    .sort((a, b) => Number(b.cantidad < b.minimo) - Number(a.cantidad < a.minimo) || (a.categoria ?? '').localeCompare(b.categoria ?? '') || a.nombre.localeCompare(b.nombre));
}

// Medidor de stock frente al mínimo: la barra llena es el doble del mínimo.
function medidor(cant: number, min: number): string {
  const tope = Math.max(min * 2, cant, 1);
  const bajo = cant < min;
  return `<span class="in-medidor ${bajo ? 'bajo' : ''}" title="${esc(`${num(cant)} de un mínimo de ${num(min)}`)}">
    <span class="in-medidor-barra" style="width:${(100 * Math.max(0, cant) / tope).toFixed(1)}%"></span>${min ? `<span class="in-medidor-min" style="left:${(100 * min / tope).toFixed(1)}%"></span>` : ''}</span>`;
}

function cifra(titulo: string, valor: string, sub: string, tono = '') {
  return `<article class="tarjeta di-cifra ${tono}"><h3>${esc(titulo)}</h3><p class="di-valor">${valor}</p><p class="nota">${sub}</p></article>`;
}

const pestanas = (activa: string) => `<nav class="segmentado in-pestanas" aria-label="Inventario">${[['', 'Stock'], ['movimientos', 'Movimientos']].map(([k, t]) =>
  `<a class="${k === activa ? 'activo' : ''}" href="#/inventario${k ? '/' + k : ''}" ${k === activa ? 'aria-current="page"' : ''}>${t}</a>`).join('')}</nav>`;

// ── Stock ───────────────────────────────────────────────────────────────────
async function pintarStock(el: HTMLElement) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const [error, delHub] = await Promise.all([cargar(), esDelHub('furgoneta_inventario')]);
  if (error && !_prods.length) { el.innerHTML = `<p class="aviso mal">No se pudo leer el inventario: ${esc(error.message)}</p>`; return; }
  const admin = esAdmin();
  const enUbic = _prods.filter(p => !_ubicSel || p.furgoneta_id === _ubicSel);
  const bajos = enUbic.filter(bajoMinimo).length, agotados = enUbic.filter(p => n(p.cantidad) <= 0).length;
  const valor = (ps: Producto[]) => ps.reduce((t, p) => t + Math.max(0, n(p.cantidad)) * n(p.precio), 0);
  const porUbic = _ubic.map(u => ({ u, ps: _prods.filter(p => p.furgoneta_id === u.id) })).filter(x => x.ps.length);
  const graf = barras('in-barras', admin ? 'Valor del stock por ubicación' : 'Productos por ubicación', porUbic.map(({ u, ps }) => admin
    ? { clave: u.id, etiqueta: u.nombre, valor: valor(ps), texto: `${eur(valor(ps))} <small class="nota">· ${ps.length}</small>`, detalle: `${u.nombre}: ${ps.length} productos · ${eur(valor(ps), 2)} a precio de venta` }
    : { clave: u.id, etiqueta: u.nombre, valor: ps.length, texto: String(ps.length), detalle: `${u.nombre}: ${ps.length} productos` }), 'inUbicBarra', _ubicSel);
  const cats = [...new Set(_prods.map(p => p.categoria).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b));
  const fs = filas();
  const sel = _ubic.find(u => u.id === _ubicSel);
  el.innerHTML = `${delHub ? '' : avisoSoloLectura('El inventario')}${pestanas('')}
    <div class="pp-cabeza">
      <div class="di-cifras pp-cifras">
        ${cifra(sel ? `En ${sel.nombre}` : 'Productos', String(_ubicSel ? enUbic.length : new Set(_prods.map(clave)).size), sel ? (sel.tecnico_responsable ? `a cargo de ${esc(sel.tecnico_responsable)}` : 'productos') : `en ${porUbic.length} ${porUbic.length === 1 ? 'ubicación' : 'ubicaciones'}`)}
        ${cifra('Bajo mínimo', String(bajos), bajos ? 'productos por debajo de su mínimo' : 'todo por encima del mínimo', bajos ? 'atento' : '')}
        ${cifra('Agotados', String(agotados), agotados ? 'con cantidad a cero' : 'ninguno a cero', agotados ? 'mal' : '')}
        ${admin ? cifra('Valor del stock', eur(valor(enUbic)), 'a precio de venta, sin impuestos') : cifra('Unidades', num(enUbic.reduce((t, p) => t + Math.max(0, n(p.cantidad)), 0)), 'sumando todas las ubicaciones')}
      </div>
      ${graf}
    </div>
    <div class="acciones mo-barra in-ubicaciones">${[{ id: TODAS, nombre: 'Todas (total)' }, ..._ubic].map(u =>
      `<button class="chip-boton ${_ubicSel === u.id ? 'activo' : ''}" data-action="inUbic" data-p0="${esc(u.id)}">${esc(u.nombre)}</button>`).join('')}</div>
    <div class="acciones mo-barra">
      <input id="in-filtro" type="search" placeholder="Buscar por nombre, código o categoría…" value="${esc(_q)}" data-on-input="inFiltrar:$value" aria-label="Buscar producto">
      <select id="in-cat" data-on-change="inCat:$value" aria-label="Categoría"><option value="">Todas las categorías</option>
        ${cats.map(c => `<option ${c === _cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <label class="check"><input id="in-bajo" type="checkbox" ${_bajo ? 'checked' : ''} data-on-change="inBajo:$checked"> Solo bajo mínimo</label>
      <a class="btn secundario" href="#/almacen/compras">Qué pedir →</a>
    </div>
    <p class="nota">Mostrando ${Math.min(fs.length, 300)} de ${fs.length}.</p>
    <div class="tarjeta mo-scroll"><table class="tabla" id="in-tabla"><thead><tr><th>Producto</th><th>${_ubicSel ? 'Categoría' : 'Dónde'}</th><th class="num">Cantidad</th><th>Frente al mínimo</th>${admin ? '<th class="num">Precio</th><th class="num">Valor</th>' : ''}</tr></thead>
      <tbody>${fs.slice(0, 300).map(f => `<tr class="fila-clic" data-action="inAbrir" data-p0="${esc(f.id ?? '')}">
        <td><strong>${esc(f.nombre)}</strong>${f.codigo ? `<br><small class="nota">${esc(f.codigo)}</small>` : ''}</td>
        <td>${_ubicSel ? esc(f.categoria ?? '') : f.ubicaciones.map(u => `<span class="chip">${esc(nombreUbic(u.furgoneta_id))} ${num(n(u.cantidad))}</span>`).join(' ')}</td>
        <td class="num"><strong>${num(f.cantidad)}</strong>${f.cantidad < f.minimo ? ` <span class="chip ${f.cantidad <= 0 ? 'mal' : 'aviso'}">${f.cantidad <= 0 ? 'Agotado' : 'Bajo mínimo'}</span>` : ''}</td>
        <td>${medidor(f.cantidad, f.minimo)} <small class="nota">mín. ${num(f.minimo)}</small></td>
        ${admin ? `<td class="num">${f.precio ? eur(f.precio, 2) : '—'}</td><td class="num">${f.precio ? eur(Math.max(0, f.cantidad) * f.precio, 2) : '—'}</td>` : ''}</tr>`).join('')
        || `<tr><td colspan="${admin ? 6 : 4}" class="vacio">Nada con ese filtro.</td></tr>`}</tbody></table></div>`;
}

// ── Movimientos ─────────────────────────────────────────────────────────────
function filaMov(m: Movimiento, prods: Map<string, Producto>, trabajos: Map<string, { numero: number | null; titulo: string | null }>, conProducto = true): string {
  const [txt, tono, signo] = TIPO[m.tipo ?? ''] ?? [m.tipo ?? '—', '', ''];
  const p = prods.get(m.producto_id ?? '');
  const t = trabajos.get(m.trabajo_id ?? '');
  return `<tr><td>${esc(fechaHora(m.created_at))}</td>
    <td><span class="chip ${tono}">${esc(txt)}</span></td>
    ${conProducto ? `<td>${p ? `<a href="#/inventario/${esc(p.id)}">${esc(p.nombre)}</a>` : '<span class="nota">(ya no está)</span>'}</td>` : ''}
    <td class="num"><strong>${signo}${num(n(m.cantidad))}</strong></td>
    <td>${esc(nombreUbic(m.furgoneta_id))}${m.tipo === 'trasvase' && m.destino_id ? ` → ${esc(nombreUbic(m.destino_id))}` : ''}</td>
    <td>${esc(m.tecnico_id ?? '')}</td>
    <td>${m.trabajo_id ? `<a href="#/trabajos/${esc(m.trabajo_id)}">#${t?.numero ?? '?'} ${esc(t?.titulo ?? '')}</a>` : ''}${m.notas ? `${m.trabajo_id ? '<br>' : ''}<small class="nota">${esc(m.notas)}</small>` : ''}</td></tr>`;
}

async function trabajosDe(movs: Movimiento[]) {
  const ids = [...new Set(movs.map(m => m.trabajo_id).filter(Boolean) as string[])];
  if (!ids.length) return new Map();
  const r = await API.get<{ id: string; numero: number | null; titulo: string | null }[]>('trabajos', { select: 'id,numero,titulo', id: `in.(${ids.slice(0, 150).join(',')})` });
  return new Map((r.data ?? []).map(t => [t.id, t]));
}

async function pintarMovimientos(el: HTMLElement) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const filtro: Record<string, string> = { select: COLS_MOV, order: 'created_at.desc', limit: '300' };
  if (_tipoMov) filtro.tipo = `eq.${_tipoMov}`;
  if (_ubicSel) filtro.furgoneta_id = `eq.${_ubicSel}`;
  const desde = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const [error, r, salidas, delHub] = await Promise.all([cargar(), API.get<Movimiento[]>('furgoneta_movimientos', filtro),
    API.fetchAll<Movimiento>('furgoneta_movimientos', { select: 'producto_id,cantidad', tipo: 'eq.salida', created_at: `gte.${desde}`, ...(_ubicSel ? { furgoneta_id: `eq.${_ubicSel}` } : {}) }),
    esDelHub('furgoneta_inventario')]);
  if (r.error || (error && !_prods.length)) { el.innerHTML = `<p class="aviso mal">No se pudieron leer los movimientos: ${esc((r.error ?? error)!.message)}</p>`; return; }
  const movs = r.data ?? [];
  const prods = new Map(_prods.map(p => [p.id, p]));
  const trabajos = await trabajosDe(movs);
  // Lo más gastado en 90 días, sumando el mismo producto de todas las ubicaciones.
  const gasto = new Map<string, { nombre: string; total: number }>();
  for (const s of salidas.data ?? []) {
    const p = prods.get(s.producto_id ?? ''); if (!p) continue;
    const g = gasto.get(clave(p)) ?? { nombre: p.nombre, total: 0 };
    g.total += n(s.cantidad); gasto.set(clave(p), g);
  }
  const top = [...gasto.values()].sort((a, b) => b.total - a.total).slice(0, 8);
  el.innerHTML = `${delHub ? '' : avisoSoloLectura('El inventario')}${pestanas('movimientos')}
    <div class="pp-cabeza in-mov-cabeza">
      <section class="tarjeta"><h3 class="in-h3">El libro de movimientos</h3>
        <p class="nota">Cada cambio de stock deja su apunte: quién, cuánto y por qué. Los movimientos llegan de la app cada noche; los de hoy aún no están.</p>
        <div class="acciones mo-barra">${[['', 'Todos'], ['entrada', 'Entradas'], ['salida', 'Salidas'], ['trasvase', 'Trasvases']].map(([k, t]) =>
          `<button class="chip-boton ${_tipoMov === k ? 'activo' : ''}" data-action="inTipo" data-p0="${k}">${t}</button>`).join('')}</div>
        <select id="in-mov-ubic" data-on-change="inUbic:$value" aria-label="Ubicación"><option value="">Todas las ubicaciones</option>
          ${_ubic.map(u => `<option value="${esc(u.id)}" ${u.id === _ubicSel ? 'selected' : ''}>${esc(u.nombre)}</option>`).join('')}</select></section>
      ${barras('in-gasto', 'Lo más gastado (90 días)', top.map(g => ({ clave: g.nombre, etiqueta: g.nombre, valor: g.total, texto: num(g.total), detalle: `${g.nombre}: ${num(g.total)} unidades en salidas` })))}
    </div>
    <div class="tarjeta mo-scroll"><table class="tabla" id="in-movs"><thead><tr><th>Cuándo</th><th>Tipo</th><th>Producto</th><th class="num">Cant.</th><th>Dónde</th><th>Quién</th><th>Trabajo / motivo</th></tr></thead>
      <tbody>${movs.map(m => filaMov(m, prods, trabajos)).join('') || '<tr><td colspan="7" class="vacio">Sin movimientos con ese filtro.</td></tr>'}</tbody></table></div>
    ${movs.length === 300 ? '<p class="nota">Solo los 300 últimos.</p>' : ''}`;
}

// ── Ficha ───────────────────────────────────────────────────────────────────
const dato = (t: string, v: string) => v ? `<div class="me-dato"><dt>${esc(t)}</dt><dd>${v}</dd></div>` : '';

async function pintarFicha(el: HTMLElement, id: string) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  _actual = id;
  const [error, r, movs, delHub] = await Promise.all([cargar(), API.single<Producto>('furgoneta_inventario', { select: COLS, id: `eq.${id}` }),
    API.get<Movimiento[]>('furgoneta_movimientos', { select: COLS_MOV, producto_id: `eq.${id}`, order: 'created_at.desc', limit: '100' }),
    esDelHub('furgoneta_inventario')]);
  if (_actual !== id) return;
  const p = r.data;
  if (!p || (error && !_prods.length)) { el.innerHTML = '<p class="aviso mal">No se encontró el producto.</p><p><a href="#/inventario">← Inventario</a></p>'; return; }
  const ms = movs.data ?? [];
  const trabajos = await trabajosDe(ms);
  if (_actual !== id) return;
  const otros = _prods.filter(o => o.id !== p.id && clave(o) === clave(p));
  const admin = esAdmin();
  el.innerHTML = `<p><a href="#/inventario">← Inventario</a></p>
    ${delHub ? '' : avisoSoloLectura('El inventario')}
    <div class="tarjeta-cab"><h2>${esc(p.nombre)}</h2>
      <div class="acciones"><a class="btn secundario" href="${esc(enApp())}" target="_blank" rel="noopener" title="Las entradas, salidas y trasvases se apuntan en la app">Mover en la app ${ico('externo')}</a></div></div>
    <p><span class="chip">${esc(nombreUbic(p.furgoneta_id))}</span> ${p.categoria ? `<span class="chip">${esc(p.categoria)}</span>` : ''}
      ${bajoMinimo(p) ? `<span class="chip ${n(p.cantidad) <= 0 ? 'mal' : 'aviso'}">${n(p.cantidad) <= 0 ? 'Agotado' : 'Bajo mínimo'}</span>` : ''}</p>
    <div class="me-grid">
      <section class="tarjeta pp-total"><h3>${ico('caja')} Aquí hay</h3><p class="di-valor">${num(n(p.cantidad))}</p>
        <p>${medidor(n(p.cantidad), n(p.stock_minimo))} <small class="nota">mínimo ${num(n(p.stock_minimo))}</small></p>
        <dl class="me-datos">${dato('Código', esc(p.codigo_principal ?? ''))}${dato('Código de barras', esc(p.codigo_barra ?? ''))}
          ${admin ? dato('Precio', p.precio ? eur(p.precio, 2) : '') : ''}${dato('Notas', esc(p.notas ?? ''))}</dl></section>
      <section class="tarjeta"><h3>${ico('ubicacion')} En otras ubicaciones</h3>
        ${otros.length ? `<ul class="in-otros">${otros.map(o => `<li><a href="#/inventario/${esc(o.id)}">${esc(nombreUbic(o.furgoneta_id))}</a> <strong>${num(n(o.cantidad))}</strong>
          ${bajoMinimo(o) ? `<span class="chip ${n(o.cantidad) <= 0 ? 'mal' : 'aviso'}">${n(o.cantidad) <= 0 ? 'Agotado' : 'Bajo mínimo'}</span>` : ''}</li>`).join('')}</ul>
          <p class="nota">En total: <strong>${num(n(p.cantidad) + otros.reduce((t, o) => t + n(o.cantidad), 0))}</strong></p>` : '<p class="nota">Solo está aquí.</p>'}
        ${p.catalogo_id ? '<p><a href="#/almacen">Ver en Almacén (consumo y qué pedir) →</a></p>' : ''}</section>
    </div>
    <section class="tarjeta mo-scroll"><h3>${ico('recibo')} Movimientos</h3>
      ${movs.error ? `<p class="aviso mal">No se pudieron leer los movimientos: ${esc(movs.error.message)}</p>` : ''}
      <table class="tabla" id="in-ficha-movs"><thead><tr><th>Cuándo</th><th>Tipo</th><th class="num">Cant.</th><th>Dónde</th><th>Quién</th><th>Trabajo / motivo</th></tr></thead>
      <tbody>${ms.map(m => filaMov(m, new Map(), trabajos, false)).join('') || '<tr><td colspan="6" class="vacio">Sin movimientos apuntados.</td></tr>'}</tbody></table>
      ${ms.length ? `<p class="nota">El último, ${esc(hace(ms[0].created_at))}. Los de hoy llegan esta noche.</p>` : ''}</section>`;
}

export async function pintarInventario(el: HTMLElement, params: string[]) {
  if (params[0] === 'movimientos') await pintarMovimientos(el);
  else if (params[0]) await pintarFicha(el, params[0]);
  else await pintarStock(el);
}

let _timer: number | undefined;
registrarAcciones({
  inAbrir(id: string) { if (id) ir('inventario', id); },
  inUbic(id: string) { _ubicSel = id; resolver(); },
  // La barra de una ubicación la elige; pulsarla otra vez vuelve al total.
  inUbicBarra(id: string) { _ubicSel = _ubicSel === id ? TODAS : id; resolver(); },
  inCat(v: string) { _cat = v; resolver(); },
  inBajo(v: boolean) { _bajo = v; resolver(); },
  inTipo(t: string) { _tipoMov = t; resolver(); },
  inFiltrar(v: string) {
    _q = v;
    clearTimeout(_timer);
    _timer = window.setTimeout(() => {
      resolver();
      window.setTimeout(() => { const f = document.getElementById('in-filtro') as HTMLInputElement | null; f?.focus(); f?.setSelectionRange(v.length, v.length); }, 60);
    }, 250);
  },
});
