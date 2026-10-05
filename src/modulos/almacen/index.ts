// Almacén (fase 9): #/almacen (stock, espejo de la app), #/almacen/compras
// (MRP: qué pedir y a quién → pedido en borrador), #/almacen/pedidos[/<n>],
// #/almacen/proveedores[/<id>] y #/almacen/envios. El stock se sigue moviendo
// en la app (lo gastan los trabajos): aquí se LEE; proveedores, pedidos y
// envíos son del hub. #/almacen/facturas[/…]: facturas de compra (facturas.ts,
// propias del hub desde la paridad del bloque 7). Prefijo de ids: al-.
import type { Modulo, Contador } from '../../core/modulo';
import { API } from '../../core/api';
import { esAdmin } from '../../core/estado';
import { registrarAcciones } from '../../core/dispatcher';
import { ir, resolver } from '../../core/router';
import { APP_ACTUAL_URL } from '../../core/config';
import { esc, toast, hace, fecha } from '../../ui/dom';
import { ico } from '../../shell/linea';
import { eur, limpio } from '../ventas/datos';
import { vistaFacturas, vistaFactura } from './facturas';

interface Mrp { clave: string; catalogo_id: string | null; nombre: string; categoria: string | null; stock: number; minimo: number; consumo_90: number;
  consumo_dia: number; cobertura_dias: number | null; en_camino: number; proveedor_id: string | null; proveedor: string | null; plazo_dias: number | null;
  precio_compra: number | null; sugerido: number; urgente: boolean; ubicaciones: { ubicacion: string | null; cantidad: number; minimo: number }[] }
interface Proveedor { id: string; nombre: string; nif: string | null; direccion: string | null; telefono: string | null; email: string | null; web: string | null;
  condiciones_pago: string | null; plazo_dias: number; pedido_minimo: number | null; notas: string | null; activo: boolean }
interface Pedido { id: string; numero: number; created_at: string; proveedor_id: string | null; fecha: string; estado: string; esperado_para: string | null;
  enviado_at: string | null; recibido_at: string | null; entrada_app_at: string | null; notas: string | null; total: number }
interface Linea { id: string; pedido_compra_id: string; catalogo_id: string | null; nombre: string; cantidad: number; precio: number; subtotal: number; cantidad_recibida: number; orden: number }

const PESTANAS: [string, string][] = [['', 'Stock'], ['compras', 'Qué pedir'], ['pedidos', 'Pedidos'], ['proveedores', 'Proveedores'], ['facturas', 'Facturas de compra'], ['envios', 'Envíos']];
const TONO_PEDIDO: Record<string, string> = { Borrador: '', Enviado: 'aviso', Confirmado: 'aviso', Recibido: 'bien', Cancelado: '' };
const AGENCIAS: Record<string, (n: string) => string> = {
  'Correos': n => `https://www.correos.es/es/es/herramientas/localizador/envios/detalle?tracking-number=${encodeURIComponent(n)}`,
  'Correos Express': n => `https://s.correosexpress.com/SeguimientoSinCP/search?n=${encodeURIComponent(n)}`,
  'MRW': n => `https://www.mrw.es/seguimiento_envios/MRW_resultados_consultas.asp?modo=nacional&envio=${encodeURIComponent(n)}`,
  'SEUR': n => `https://www.seur.com/livetracking/?segOnlineIdentificador=${encodeURIComponent(n)}`,
  'GLS': n => `https://gls-group.com/ES/es/seguimiento-envios?match=${encodeURIComponent(n)}`,
  'Otra': () => '',
};
const ESTADOS_ENVIO: Record<string, string> = { preparado: 'Preparado', enviado: 'Enviado', en_transito: 'En tránsito', entregado: 'Entregado', incidencia: 'Incidencia', devuelto: 'Devuelto' };
const num = (n: unknown) => Number(n ?? 0).toLocaleString('es-ES', { maximumFractionDigits: 2 });
const leer = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const guardar = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };

let _mrp: Mrp[] = [];
let _pedido: Pedido | null = null;
let _proveedor: Proveedor | null = null;
let _timer = 0;

const pestanas = (activa: string) => `<nav class="segmentado al-pestanas" aria-label="Almacén">${PESTANAS.map(([k, t]) =>
  `<a class="${k === activa ? 'activo' : ''}" href="#/almacen${k ? '/' + k : ''}" ${k === activa ? 'aria-current="page"' : ''}>${t}</a>`).join('')}</nav>`;

async function proveedores(): Promise<Proveedor[]> {
  return (await API.get<Proveedor[]>('proveedores', { select: '*', order: 'activo.desc,nombre' })).data ?? [];
}

// ── Stock ──────────────────────────────────────────────────────────────────
function tablaStock(): string {
  const q = leer('hub_al_q', '').toLowerCase(), bajo = leer('hub_al_bajo', '') === '1';
  const filas = _mrp.filter(m => (!bajo || m.urgente || m.stock < m.minimo) && (!q || `${m.nombre} ${m.categoria ?? ''}`.toLowerCase().includes(q)))
    .sort((a, b) => Number(b.urgente) - Number(a.urgente) || a.nombre.localeCompare(b.nombre));
  if (!filas.length) return '<p class="vacio">Nada con ese filtro.</p>';
  return `<div class="tarjeta mo-scroll"><table class="tabla al-tabla"><thead><tr><th>Material</th><th>Stock</th><th>Mínimo</th><th>Consumo 90 d</th><th>Cobertura</th><th>En camino</th><th>Proveedor</th></tr></thead><tbody>
    ${filas.map(m => `<tr class="${m.urgente ? 'al-urgente' : ''}"><td><strong>${esc(m.nombre)}</strong>${m.categoria ? `<br><small class="nota">${esc(m.categoria)}</small>` : ''}
      <details><summary class="nota">${m.ubicaciones.length} ubicación(es)</summary><ul>${m.ubicaciones.map(u => `<li>${esc(u.ubicacion ?? '—')}: ${num(u.cantidad)}${u.minimo ? ` (mín. ${num(u.minimo)})` : ''}</li>`).join('')}</ul></details></td>
      <td class="${m.stock < m.minimo ? 'mal' : ''}">${num(m.stock)}</td><td>${num(m.minimo)}</td><td>${num(m.consumo_90)}</td>
      <td>${m.cobertura_dias == null ? '—' : `${num(m.cobertura_dias)} días`}</td><td>${m.en_camino ? num(m.en_camino) : ''}</td>
      <td>${m.proveedor ? `<a href="#/almacen/proveedores/${esc(m.proveedor_id)}">${esc(m.proveedor)}</a>` : '<span class="nota">—</span>'}</td></tr>`).join('')}</tbody></table></div>`;
}

async function vistaStock(): Promise<string> {
  const r = await API.rpc<Mrp[]>('mrp');
  if (r.error) return `<p class="aviso mal">${esc(r.error.message)}</p>`;
  _mrp = r.data ?? [];
  const bajo = _mrp.filter(m => m.stock < m.minimo).length, urg = _mrp.filter(m => m.urgente).length;
  return `<p class="nota">El stock se mueve en la <a href="${esc(APP_ACTUAL_URL)}" target="_blank" rel="noopener">app ${ico('externo')}</a> (entradas, salidas, trasvases); por ubicación y con
      su libro de movimientos está en <a href="#/inventario">Inventario</a>. Aquí se ve junto, con lo que se gasta y lo que viene. Se refresca cada 15 minutos (los movimientos, cada noche).</p>
    <div class="di-cifras"><article class="tarjeta di-cifra"><h3>Materiales</h3><p class="di-valor">${_mrp.length}</p></article>
      <article class="tarjeta di-cifra"><h3>Bajo mínimo</h3><p class="di-valor ${bajo ? 'mal' : ''}">${bajo}</p></article>
      <article class="tarjeta di-cifra"><h3>Hay que pedir</h3><p class="di-valor ${urg ? 'mal' : ''}">${urg}</p><p class="nota"><a href="#/almacen/compras">Ver qué pedir</a></p></article></div>
    <div class="acciones pr-barra"><input id="al-q" type="search" placeholder="Buscar material…" value="${esc(leer('hub_al_q', ''))}" data-on-input="alBuscar:$value" aria-label="Buscar material">
      <label class="check"><input type="checkbox" ${leer('hub_al_bajo', '') === '1' ? 'checked' : ''} data-on-change="alBajo:$checked"> Solo lo que falta</label></div>
    <div id="al-stock">${tablaStock()}</div>`;
}

// ── Qué pedir (MRP) ────────────────────────────────────────────────────────
async function vistaCompras(): Promise<string> {
  const r = await API.rpc<Mrp[]>('mrp');
  if (r.error) return `<p class="aviso mal">${esc(r.error.message)}</p>`;
  _mrp = r.data ?? [];
  const pedir = _mrp.filter(m => m.sugerido > 0);
  const grupos = new Map<string, Mrp[]>();
  for (const m of pedir) grupos.set(m.proveedor_id ?? '', [...(grupos.get(m.proveedor_id ?? '') ?? []), m]);
  const { data: cfg } = await API.single<{ valor: number }>('config', { select: 'valor', clave: 'eq.mrp_cobertura_dias' });
  return `<p class="nota">Cuánto pedir de cada material para cubrir el plazo del proveedor más ${esc(cfg?.valor ?? 30)} días de consumo (el de los últimos 90 días),
      por encima del mínimo y descontando lo que ya viene. Marca lo que quieras y se prepara el pedido en borrador.</p>
    ${pedir.length ? [...grupos.entries()].map(([pid, ms]) => `<section class="tarjeta"><div class="tarjeta-cab"><h3>${pid ? esc(ms[0].proveedor) : 'Sin proveedor asignado'}</h3>
      ${pid ? `<button class="btn" data-action="alPrepararPedido" data-p0="${esc(pid)}">Preparar pedido</button>` : '<span class="nota">Asígnales proveedor en Proveedores → materiales</span>'}</div>
      <div class="mo-scroll"><table class="tabla"><thead><tr><th></th><th>Material</th><th>Stock</th><th>Consumo/día</th><th>Pedir</th><th>Precio</th></tr></thead><tbody>
      ${ms.map(m => `<tr class="${m.urgente ? 'al-urgente' : ''}"><td>${pid && m.catalogo_id ? `<input type="checkbox" class="al-sel" data-prov="${esc(pid)}" data-cat="${esc(m.catalogo_id)}" checked aria-label="Pedir ${esc(m.nombre)}">` : ''}</td>
        <td>${esc(m.nombre)}${m.urgente ? ' <span class="chip mal">urgente</span>' : ''}</td><td>${num(m.stock)}${m.en_camino ? ` <small class="nota">(+${num(m.en_camino)} en camino)</small>` : ''}</td>
        <td>${num(m.consumo_dia)}</td><td>${pid && m.catalogo_id ? `<input type="number" min="1" step="1" class="al-cant" data-cat="${esc(m.catalogo_id)}" value="${m.sugerido}" aria-label="Cantidad de ${esc(m.nombre)}">` : num(m.sugerido)}</td>
        <td>${m.precio_compra != null ? eur(m.precio_compra, 2) : '—'}</td></tr>`).join('')}</tbody></table></div></section>`).join('')
      : `<p class="vacio">No hace falta pedir nada ahora mismo. ${ico('trofeo')}</p>`}`;
}

// ── Pedidos ────────────────────────────────────────────────────────────────
async function vistaPedidos(): Promise<string> {
  const [ps, provs] = await Promise.all([API.get<Pedido[]>('pedidos_compra', { select: '*', order: 'numero.desc', limit: '200' }), proveedores()]);
  const nom = new Map(provs.map(p => [p.id, p.nombre]));
  return `<div class="acciones pr-barra"><button class="btn" data-action="alNuevoPedido">${ico('mas')} Pedido</button></div>
    <div class="tarjeta mo-scroll">${(ps.data ?? []).length ? `<table class="tabla"><thead><tr><th>Nº</th><th>Proveedor</th><th>Fecha</th><th>Estado</th><th>Total</th><th>Llega</th></tr></thead><tbody>
    ${(ps.data ?? []).map(p => `<tr class="fila-clic" data-action="alAbrirPedido" data-p0="${p.numero}"><td>PC-${p.numero}</td><td>${esc(nom.get(p.proveedor_id ?? '') ?? '—')}</td>
      <td>${esc(fecha(p.fecha))}</td><td><span class="chip ${TONO_PEDIDO[p.estado] ?? ''}">${esc(p.estado)}</span>${p.estado === 'Recibido' && !p.entrada_app_at ? ' <span class="chip aviso">falta la entrada</span>' : ''}</td>
      <td>${eur(p.total, 2)}</td><td class="${p.esperado_para && p.esperado_para < new Date().toLocaleDateString('sv-SE') && ['Enviado', 'Confirmado'].includes(p.estado) ? 'mal' : ''}">${esc(fecha(p.esperado_para))}</td></tr>`).join('')}
    </tbody></table>` : '<p class="vacio">Sin pedidos. Mira «Qué pedir» o crea uno.</p>'}</div>`;
}

function textoPedido(p: Pedido, ls: Linea[], prov: Proveedor | undefined): string {
  return `Hola${prov ? ' ' + prov.nombre : ''},\n\nOs pedimos (pedido PC-${p.numero}):\n\n${ls.map(l => `- ${num(l.cantidad)} x ${l.nombre}${l.precio ? ` (${num(l.precio)} €)` : ''}`).join('\n')}\n\n${p.notas ? p.notas + '\n\n' : ''}Gracias,\nOk Computer Tenerife`;
}

async function vistaPedido(numero: string): Promise<string> {
  const { data: p } = await API.single<Pedido>('pedidos_compra', { select: '*', numero: `eq.${Number(numero) || 0}` });
  if (!p) return '<p class="aviso mal">No existe ese pedido.</p>';
  _pedido = p;
  const [ls, provs] = await Promise.all([API.get<Linea[]>('pedido_compra_lineas', { select: '*', pedido_compra_id: `eq.${p.id}`, order: 'orden' }), proveedores()]);
  const prov = provs.find(x => x.id === p.proveedor_id);
  const lineas = ls.data ?? [];
  const editable = p.estado === 'Borrador';
  const texto = textoPedido(p, lineas, prov);
  const siguiente: Record<string, [string, string][]> = { Borrador: [['Enviado', 'Marcar enviado']], Enviado: [['Confirmado', 'Confirmado por el proveedor'], ['Recibido', 'Recibido']],
    Confirmado: [['Recibido', 'Recibido']], Recibido: [], Cancelado: [['Borrador', 'Recuperar']] };
  return `<p><a href="#/almacen/pedidos">← Pedidos</a></p>
    <div class="tarjeta-cab"><h2>PC-${p.numero} · ${esc(prov?.nombre ?? 'sin proveedor')}</h2><span class="chip ${TONO_PEDIDO[p.estado] ?? ''}">${esc(p.estado)}</span></div>
    <p class="acciones"><a class="btn secundario" href="#/almacen/facturas/nueva/p/${esc(p.id)}">${ico('recibo')} Registrar su factura</a></p>
    <p class="nota">Creado ${esc(hace(p.created_at))}${p.enviado_at ? ` · enviado ${esc(hace(p.enviado_at))}` : ''}${p.esperado_para ? ` · se espera el ${esc(p.esperado_para)}` : ''}${p.recibido_at ? ` · recibido ${esc(hace(p.recibido_at))}` : ''}</p>
    ${p.estado === 'Recibido' ? `<p class="aviso ${p.entrada_app_at ? '' : 'mal'}">${p.entrada_app_at ? `Entrada dada en el inventario de la app ${esc(hace(p.entrada_app_at))}.`
      : `Da la entrada del material en el <a href="${esc(APP_ACTUAL_URL)}" target="_blank" rel="noopener">Inventario de la app ${ico('externo')}</a> y márcalo:
        <button class="btn secundario" data-action="alEntradaDada">Entrada dada</button>`}</p>` : ''}
    <div class="op-ficha"><div>
      <section class="tarjeta mo-scroll"><h3>Líneas</h3><table class="tabla"><thead><tr><th>Material</th><th>Cantidad</th><th>Precio</th><th>Subtotal</th>${editable ? '<th></th>' : ''}</tr></thead><tbody>
        ${lineas.map(l => `<tr><td>${esc(l.nombre)}</td><td>${editable ? `<input type="number" min="0.01" step="any" value="${l.cantidad}" data-on-change="alLinea:${l.id},cantidad,$value" aria-label="Cantidad">` : num(l.cantidad)}</td>
          <td>${editable ? `<input type="number" min="0" step="0.01" value="${l.precio}" data-on-change="alLinea:${l.id},precio,$value" aria-label="Precio">` : eur(l.precio, 2)}</td><td>${eur(l.subtotal, 2)}</td>
          ${editable ? `<td><button class="btn secundario" data-action="alQuitarLinea" data-p0="${l.id}" aria-label="Quitar">${ico('cerrar')}</button></td>` : ''}</tr>`).join('') || `<tr><td colspan="5" class="vacio">Sin líneas.</td></tr>`}
        </tbody><tfoot><tr><th colspan="3">Total (sin impuestos)</th><th>${eur(p.total, 2)}</th></tr></tfoot></table>
        ${editable ? `<form class="acciones" data-on-submit="alAnadirLinea" data-prevent="1"><input id="al-linea-q" placeholder="Material del catálogo o texto libre" autocomplete="off" data-on-input="alBuscarCat:$value" aria-label="Material">
          <input id="al-linea-cant" type="number" min="0.01" step="any" value="1" aria-label="Cantidad"><input id="al-linea-precio" type="number" min="0" step="0.01" placeholder="Precio" aria-label="Precio">
          <input type="hidden" id="al-linea-cat"><button class="btn secundario" type="submit">Añadir</button></form><ul id="al-cat-res" class="resultados"></ul>` : ''}
      </section>
      <section class="tarjeta"><h3>Para el proveedor</h3><textarea id="al-texto" rows="8" readonly>${esc(texto)}</textarea>
        <div class="acciones"><button class="btn secundario" data-action="alCopiar">Copiar</button>
          ${prov?.email ? `<a class="btn secundario" href="mailto:${esc(prov.email)}?subject=${encodeURIComponent(`Pedido PC-${p.numero} · Ok Computer Tenerife`)}&body=${encodeURIComponent(texto)}">Abrir en el correo</a>` : ''}</div></section>
    </div><div>
      <section class="tarjeta"><h3>Estado</h3><div class="acciones">${(siguiente[p.estado] ?? []).map(([e, t]) => `<button class="btn" data-action="alEstadoPedido" data-p0="${e}">${t}</button>`).join('')}
        ${!['Recibido', 'Cancelado'].includes(p.estado) ? '<button class="btn secundario" data-action="alEstadoPedido" data-p0="Cancelado">Cancelar</button>' : ''}</div>
        <label>Proveedor <select id="al-ped-prov" data-on-change="alPedidoCampo:proveedor_id,$value" ${editable ? '' : 'disabled'}><option value="">—</option>${provs.filter(x => x.activo || x.id === p.proveedor_id).map(x => `<option value="${x.id}" ${x.id === p.proveedor_id ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('')}</select></label>
        <label>Se espera el <input type="date" value="${esc(p.esperado_para ?? '')}" data-on-change="alPedidoCampo:esperado_para,$value"></label>
        <label>Notas <textarea rows="3" data-on-change="alPedidoCampo:notas,$value">${esc(p.notas ?? '')}</textarea></label></section>
      ${esAdmin() ? '<div class="acciones"><button class="btn peligro" data-action="alBorrarPedido">Borrar pedido</button></div>' : ''}
    </div></div>`;
}

// ── Proveedores ────────────────────────────────────────────────────────────
function formProveedor(p: Partial<Proveedor>): string {
  const c = (k: keyof Proveedor, t: string, tipo = 'text') => `<label>${t} <input name="${k}" type="${tipo}" value="${esc(p[k] ?? '')}" ${k === 'nombre' ? 'required' : ''}></label>`;
  return `<form class="tarjeta" data-on-submit="alGuardarProveedor:$this" data-prevent="1" data-id="${esc(p.id ?? '')}"><div class="in-campos">
    ${c('nombre', 'Nombre')}${c('nif', 'NIF')}${c('telefono', 'Teléfono', 'tel')}${c('email', 'Correo', 'email')}${c('web', 'Web', 'url')}${c('direccion', 'Dirección')}
    ${c('condiciones_pago', 'Condiciones de pago')}${c('plazo_dias', 'Plazo de entrega (días)', 'number')}${c('pedido_minimo', 'Pedido mínimo (€)', 'number')}</div>
    <label>Notas <textarea name="notas" rows="2">${esc(p.notas ?? '')}</textarea></label>
    <div class="acciones">${p.id ? `<label class="check"><input type="checkbox" name="activo" ${p.activo !== false ? 'checked' : ''}> Activo</label>` : ''}<button class="btn" type="submit">${p.id ? 'Guardar' : 'Añadir proveedor'}</button></div></form>`;
}

async function vistaProveedores(): Promise<string> {
  const provs = await proveedores();
  return `<div class="tarjeta mo-scroll">${provs.length ? `<table class="tabla"><thead><tr><th>Proveedor</th><th>Contacto</th><th>Plazo</th></tr></thead><tbody>
    ${provs.map(p => `<tr class="fila-clic ${p.activo ? '' : 'in-pausado'}" data-action="alAbrirProveedor" data-p0="${p.id}"><td><strong>${esc(p.nombre)}</strong></td>
      <td>${esc([p.telefono, p.email].filter(Boolean).join(' · '))}</td><td>${p.plazo_dias} días</td></tr>`).join('')}</tbody></table>` : '<p class="vacio">Sin proveedores todavía.</p>'}</div>
    <h3>Nuevo proveedor</h3>${formProveedor({ plazo_dias: 3 })}`;
}

async function vistaProveedor(id: string): Promise<string> {
  const [{ data: p }, mps] = await Promise.all([API.single<Proveedor>('proveedores', { select: '*', id: `eq.${id}` }),
    API.get<any[]>('material_proveedor', { select: '*', proveedor_id: `eq.${id}` })]);
  if (!p) return '<p class="aviso mal">No existe ese proveedor.</p>';
  _proveedor = p;
  const cats = (mps.data ?? []).length ? (await API.get<any[]>('catalogo', { select: 'id,nombre,referencia', id: `in.(${(mps.data ?? []).map(m => m.catalogo_id).join(',')})` })).data ?? [] : [];
  return `<p><a href="#/almacen/proveedores">← Proveedores</a></p><h2>${esc(p.nombre)}</h2>${formProveedor(p)}
    <section class="tarjeta"><h3>Materiales que nos sirve</h3><p class="nota">El «preferido» es a quien el MRP propone pedir ese material.</p>
      <div class="mo-scroll"><table class="tabla"><thead><tr><th>Material</th><th>Su referencia</th><th>Precio</th><th>Plazo</th><th>Preferido</th><th></th></tr></thead><tbody>
      ${(mps.data ?? []).map(m => `<tr><td>${esc(cats.find(c => c.id === m.catalogo_id)?.nombre ?? '¿?')}</td><td>${esc(m.ref_proveedor ?? '')}</td><td>${m.precio_compra != null ? eur(m.precio_compra, 2) : '—'}</td>
        <td>${m.plazo_dias ?? `(${p.plazo_dias})`}</td><td><input type="checkbox" ${m.preferido ? 'checked' : ''} data-on-change="alPreferido:${m.id},${m.catalogo_id},$checked" aria-label="Preferido"></td>
        <td><button class="btn secundario" data-action="alQuitarMaterial" data-p0="${m.id}" aria-label="Quitar">${ico('cerrar')}</button></td></tr>`).join('') || '<tr><td colspan="6" class="vacio">Ninguno todavía.</td></tr>'}
      </tbody></table></div>
      <form class="acciones" data-on-submit="alAnadirMaterial" data-prevent="1"><input id="al-linea-q" placeholder="Material del catálogo…" autocomplete="off" data-on-input="alBuscarCat:$value" aria-label="Material">
        <input id="al-mat-ref" placeholder="Su referencia" aria-label="Referencia del proveedor"><input id="al-linea-precio" type="number" min="0" step="0.01" placeholder="Precio" aria-label="Precio de compra">
        <label class="check"><input type="checkbox" id="al-mat-pref" checked> Preferido</label>
        <input type="hidden" id="al-linea-cat"><button class="btn secundario" type="submit">Añadir</button></form><ul id="al-cat-res" class="resultados"></ul></section>
    ${esAdmin() ? '<div class="acciones"><button class="btn peligro" data-action="alBorrarProveedor">Borrar proveedor</button></div>' : ''}`;
}

// ── Envíos ─────────────────────────────────────────────────────────────────
async function vistaEnvios(): Promise<string> {
  const todos = leer('hub_al_envios', '') === 'todos';
  const { data } = await API.get<any[]>('envios', { select: '*', ...(todos ? {} : { estado: 'not.in.(entregado,devuelto)' }), order: 'created_at.desc', limit: '100' });
  return `<form class="tarjeta" data-on-submit="alNuevoEnvio" data-prevent="1"><h3>Apuntar un envío</h3><div class="in-campos">
      <label>Sentido <select id="al-env-sentido"><option value="salida">Sale (a un cliente)</option><option value="entrada">Entra (de un proveedor)</option></select></label>
      <label>Agencia <select id="al-env-agencia">${Object.keys(AGENCIAS).map(a => `<option>${a}</option>`).join('')}</select></label>
      <label>Nº de seguimiento <input id="al-env-seg"></label>
      <label>Destinatario / remitente <input id="al-env-dest"></label>
      <label>Bultos <input id="al-env-bultos" type="number" min="1" value="1"></label>
      <label>Coste (€) <input id="al-env-coste" type="number" min="0" step="0.01"></label></div>
      <label>Qué va <input id="al-env-cont"></label>
      <div class="acciones"><button class="btn" type="submit">Apuntar</button></div></form>
    <div class="acciones pr-barra"><label class="check"><input type="checkbox" ${todos ? 'checked' : ''} data-on-change="alEnviosTodos:$checked"> Ver también los entregados</label></div>
    <div class="tarjeta mo-scroll">${(data ?? []).length ? `<table class="tabla"><thead><tr><th></th><th>Agencia</th><th>Seguimiento</th><th>Quién / qué</th><th>Estado</th></tr></thead><tbody>
      ${(data ?? []).map(e => { const url = e.seguimiento ? AGENCIAS[e.agencia]?.(e.seguimiento) : ''; return `<tr><td title="${e.sentido === 'entrada' ? 'Entrada' : 'Salida'}">${e.sentido === 'entrada' ? ico('recibir') : ico('enviar')}</td><td>${esc(e.agencia)}</td>
        <td>${e.seguimiento ? (url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(e.seguimiento)}</a>` : esc(e.seguimiento)) : '—'}</td>
        <td>${esc(e.destinatario ?? '')}${e.contenido ? `<br><small class="nota">${esc(e.contenido)}</small>` : ''}</td>
        <td><select aria-label="Estado del envío" data-on-change="alEstadoEnvio:${e.id},$value">${Object.entries(ESTADOS_ENVIO).map(([k, t]) => `<option value="${k}" ${k === e.estado ? 'selected' : ''}>${t}</option>`).join('')}</select>
          ${e.enviado_at ? `<br><small class="nota">salió ${esc(hace(e.enviado_at))}</small>` : ''}</td></tr>`; }).join('')}</tbody></table>` : '<p class="vacio">No hay envíos en marcha.</p>'}</div>`;
}

async function pintar(el: HTMLElement, params: string[]) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const [a, b, c, d] = params;
  const cuerpo = a === 'facturas' && b ? await vistaFactura(b, c === 'p' ? d ?? '' : '') : a === 'facturas' ? await vistaFacturas() : a === 'compras' ? await vistaCompras() : a === 'pedidos' && b ? await vistaPedido(b) : a === 'pedidos' ? await vistaPedidos()
    : a === 'proveedores' && b ? await vistaProveedor(b) : a === 'proveedores' ? await vistaProveedores() : a === 'envios' ? await vistaEnvios() : await vistaStock();
  el.innerHTML = pestanas(a && PESTANAS.some(([k]) => k === a) ? a : '') + cuerpo;
}

// ── Acciones ───────────────────────────────────────────────────────────────
const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? '';
const nulo = (v: string) => v === '' ? null : v;

registrarAcciones({
  alBuscar(q: string) { guardar('hub_al_q', q); const c = document.getElementById('al-stock'); if (c) c.innerHTML = tablaStock(); },
  alBajo(v: boolean) { guardar('hub_al_bajo', v ? '1' : ''); const c = document.getElementById('al-stock'); if (c) c.innerHTML = tablaStock(); },
  async alPrepararPedido(proveedorId: string) {
    const sel = [...document.querySelectorAll<HTMLInputElement>(`.al-sel[data-prov="${CSS.escape(proveedorId)}"]:checked`)];
    if (!sel.length) { toast('Marca algún material', 'error'); return; }
    const r = await API.post<Pedido[]>('pedidos_compra', { proveedor_id: proveedorId, estado: 'Borrador' });
    if (r.error || !r.data?.[0]) { toast(`No se pudo: ${r.error?.message}`, 'error'); return; }
    const lineas = sel.map((c, i) => {
      const m = _mrp.find(x => x.catalogo_id === c.dataset.cat)!;
      const cant = Number(document.querySelector<HTMLInputElement>(`.al-cant[data-cat="${CSS.escape(c.dataset.cat!)}"]`)?.value) || m.sugerido;
      return { pedido_compra_id: r.data![0].id, catalogo_id: m.catalogo_id, nombre: m.nombre, cantidad: cant, precio: m.precio_compra ?? 0, orden: i + 1 };
    });
    const rl = await API.post('pedido_compra_lineas', lineas);
    if (rl.error) { toast(`Pedido creado, pero sin líneas: ${rl.error.message}`, 'error'); }
    toast(`Pedido PC-${r.data[0].numero} preparado en borrador`);
    ir('almacen', 'pedidos', String(r.data[0].numero));
  },
  async alNuevoPedido() {
    const r = await API.post<Pedido[]>('pedidos_compra', { estado: 'Borrador' });
    if (r.error || !r.data?.[0]) { toast(`No se pudo: ${r.error?.message}`, 'error'); return; }
    ir('almacen', 'pedidos', String(r.data[0].numero));
  },
  alAbrirPedido(n: string) { ir('almacen', 'pedidos', n); },
  async alEstadoPedido(estado: string) {
    if (!_pedido) return;
    if (estado === 'Enviado' && !_pedido.proveedor_id) { toast('Elige el proveedor antes', 'error'); return; }
    const r = await API.patch('pedidos_compra', { id: `eq.${_pedido.id}` }, { estado });
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else { toast(`Pedido: ${estado}`); resolver(); }
  },
  async alPedidoCampo(campo: string, v: string) {
    if (!_pedido || !['proveedor_id', 'esperado_para', 'notas'].includes(campo)) return;
    const r = await API.patch('pedidos_compra', { id: `eq.${_pedido.id}` }, { [campo]: nulo(v) });
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else { toast('Guardado'); if (campo !== 'notas') resolver(); }
  },
  async alEntradaDada() {
    if (!_pedido) return;
    const r = await API.patch('pedidos_compra', { id: `eq.${_pedido.id}` }, { entrada_app_at: new Date().toISOString() });
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else resolver();
  },
  async alLinea(id: string, campo: string, v: string) {
    if (!['cantidad', 'precio'].includes(campo)) return;
    const r = await API.patch('pedido_compra_lineas', { id: `eq.${id}` }, { [campo]: Number(v) || 0 });
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else resolver();
  },
  async alQuitarLinea(id: string) {
    const r = await API.delete('pedido_compra_lineas', { id: `eq.${id}` });
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else resolver();
  },
  alBuscarCat(q: string) {
    clearTimeout(_timer);
    (document.getElementById('al-linea-cat') as HTMLInputElement).value = '';
    _timer = window.setTimeout(async () => {
      const ul = document.getElementById('al-cat-res'), t = limpio(q);
      if (!ul) return;
      if (t.length < 2) { ul.innerHTML = ''; return; }
      const { data } = await API.get<any[]>('catalogo', { select: 'id,nombre,referencia,precio', activo: 'eq.true', or: `(nombre.ilike.*${t}*,referencia.ilike.*${t}*)`, order: 'nombre', limit: '8' });
      ul.innerHTML = (data ?? []).map(c => `<li><button type="button" class="btn secundario" data-action="alElegirCat" data-p0="${c.id}" data-p1="${esc(c.nombre)}">${esc(c.nombre)}
        <small class="nota">${esc(c.referencia ?? '')}</small></button></li>`).join('');
    }, 250);
  },
  alElegirCat(id: string, nombre: string) {
    (document.getElementById('al-linea-cat') as HTMLInputElement).value = id;
    (document.getElementById('al-linea-q') as HTMLInputElement).value = nombre;
    const ul = document.getElementById('al-cat-res'); if (ul) ul.innerHTML = '';
  },
  async alAnadirLinea() {
    if (!_pedido || !val('al-linea-q')) return;
    const r = await API.post('pedido_compra_lineas', { pedido_compra_id: _pedido.id, catalogo_id: nulo(val('al-linea-cat')), nombre: val('al-linea-q'),
      cantidad: Number(val('al-linea-cant')) || 1, precio: Number(val('al-linea-precio')) || 0, orden: 99 });
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else resolver();
  },
  async alCopiar() {
    const t = (document.getElementById('al-texto') as HTMLTextAreaElement).value;
    try { await navigator.clipboard.writeText(t); toast('Copiado'); } catch { (document.getElementById('al-texto') as HTMLTextAreaElement).select(); }
  },
  async alBorrarPedido() {
    if (!_pedido || !confirm(`¿Borrar el pedido PC-${_pedido.numero}?`)) return;
    const r = await API.delete('pedidos_compra', { id: `eq.${_pedido.id}` });
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else ir('almacen', 'pedidos');
  },
  // Proveedores
  alAbrirProveedor(id: string) { ir('almacen', 'proveedores', id); },
  async alGuardarProveedor(f: HTMLFormElement) {
    const fd = new FormData(f), id = f.dataset.id ?? '';
    const s = (k: string) => nulo(String(fd.get(k) ?? '').trim());
    const d: Record<string, unknown> = { nombre: s('nombre'), nif: s('nif'), telefono: s('telefono'), email: s('email')?.toLowerCase() ?? null, web: s('web'), direccion: s('direccion'),
      condiciones_pago: s('condiciones_pago'), plazo_dias: Number(fd.get('plazo_dias')) || 0, pedido_minimo: s('pedido_minimo') ? Number(fd.get('pedido_minimo')) : null, notas: s('notas') };
    if (id) d.activo = fd.get('activo') === 'on';
    const r = id ? await API.patch('proveedores', { id: `eq.${id}` }, d) : await API.post<Proveedor[]>('proveedores', d);
    if (r.error) { toast(`No se pudo: ${r.error.message}`, 'error'); return; }
    toast('Proveedor guardado');
    if (!id && Array.isArray(r.data) && r.data[0]) ir('almacen', 'proveedores', (r.data[0] as Proveedor).id); else resolver();
  },
  async alAnadirMaterial() {
    if (!_proveedor) return;
    const cat = val('al-linea-cat');
    if (!cat) { toast('Elige el material de la lista del catálogo', 'error'); return; }
    const pref = (document.getElementById('al-mat-pref') as HTMLInputElement).checked;
    if (pref) await API.patch('material_proveedor', { catalogo_id: `eq.${cat}`, preferido: 'eq.true' }, { preferido: false });
    const r = await API.post('material_proveedor', { catalogo_id: cat, proveedor_id: _proveedor.id, ref_proveedor: nulo(val('al-mat-ref')),
      precio_compra: val('al-linea-precio') ? Number(val('al-linea-precio')) : null, preferido: pref });
    if (r.error) toast(r.error.message.includes('duplicate') ? 'Ese material ya está con este proveedor' : `No se pudo: ${r.error.message}`, 'error'); else resolver();
  },
  async alPreferido(id: string, catalogo: string, v: boolean) {
    if (v) await API.patch('material_proveedor', { catalogo_id: `eq.${catalogo}`, preferido: 'eq.true' }, { preferido: false });
    const r = await API.patch('material_proveedor', { id: `eq.${id}` }, { preferido: v });
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else toast(v ? 'Preferido para ese material' : 'Guardado');
  },
  async alQuitarMaterial(id: string) {
    const r = await API.delete('material_proveedor', { id: `eq.${id}` });
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else resolver();
  },
  async alBorrarProveedor() {
    if (!_proveedor || !confirm(`¿Borrar ${_proveedor.nombre}? Si tiene pedidos, mejor desactívalo.`)) return;
    const r = await API.delete('proveedores', { id: `eq.${_proveedor.id}` });
    if (r.error) toast(`No se pudo (¿tiene pedidos? desactívalo): ${r.error.message}`, 'error'); else ir('almacen', 'proveedores');
  },
  // Envíos
  alEnviosTodos(v: boolean) { guardar('hub_al_envios', v ? 'todos' : ''); resolver(); },
  async alNuevoEnvio() {
    const seg = val('al-env-seg');
    const r = await API.post('envios', { sentido: val('al-env-sentido') || 'salida', agencia: val('al-env-agencia') || 'Correos', seguimiento: nulo(seg),
      destinatario: nulo(val('al-env-dest')), contenido: nulo(val('al-env-cont')), bultos: Number(val('al-env-bultos')) || 1,
      coste: val('al-env-coste') ? Number(val('al-env-coste')) : null, estado: seg ? 'enviado' : 'preparado' });
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else { toast('Envío apuntado'); resolver(); }
  },
  async alEstadoEnvio(id: string, estado: string) {
    const r = await API.patch('envios', { id: `eq.${id}` }, { estado });
    if (r.error) toast(`No se pudo: ${r.error.message}`, 'error'); else toast(`Envío: ${ESTADOS_ENVIO[estado] ?? estado}`);
  },
});

async function contador(): Promise<Contador | null> {
  const r = await API.rpc<Mrp[]>('mrp');
  if (r.error) return null;
  const urg = (r.data ?? []).filter(m => m.urgente).length;
  return { valor: urg, subtitulo: urg === 1 ? 'material por pedir' : 'materiales por pedir', tono: urg ? 'aviso' : 'bien' };
}

export const moduloAlmacen: Modulo = {
  id: 'almacen',
  titulo: 'Almacén y compras',
  grupo: 'Operaciones',
  icono: '📦',
  explicacion: 'Qué material hay (en el almacén y en cada furgoneta), cuánto se gasta y qué hay que pedir antes de quedarnos sin él. Desde aquí se preparan los pedidos a proveedores y se siguen los envíos. El stock se sigue moviendo en el Inventario de la app.',
  pintar,
  contador,
};
