// Vista de Presupuestos (ver index.ts). Solo lectura mientras el área sea de la app.
import { API } from '../../core/api';
import { registrarAcciones } from '../../core/dispatcher';
import { ir, resolver } from '../../core/router';
import { esDelHub, avisoSoloLectura } from '../../core/areas';
import { esc, hace } from '../../ui/dom';
import { barras } from '../../ui/barras';
import { enApp, eur } from '../ventas/datos';
import { esMio } from '../direccion';

interface Presupuesto {
  id: string; created_at: string | null; cliente_id: string | null; local_id: string | null; contacto_id: string | null;
  oportunidad_id: string | null; titulo: string | null; exigencias: string | null; estado: string | null; total: number | null;
  tecnico_id: string | null; zoho_estimate_id: string | null; fecha: string | null; numero_presupuesto: string | null;
}
interface Linea { id: string; nombre: string | null; cantidad: number | null; precio: number | null; descuento: number | null; subtotal: number | null; orden: number | null; categoria: string | null }

const COLS = 'id,created_at,cliente_id,local_id,contacto_id,oportunidad_id,titulo,exigencias,estado,total,tecnico_id,zoho_estimate_id,fecha,numero_presupuesto';
// El orden es el del recorrido de un presupuesto; lo que no esté aquí se pinta tal cual al final.
const ESTADOS = ['Borrador', 'Enviado', 'Aceptado', 'Rechazado'];
const TONO: Record<string, string> = { Borrador: '', Enviado: 'aviso', Aceptado: 'bien', Rechazado: 'mal' };
// Enviado y sin respuesta pasada una semana: el mismo umbral que el aviso
// `presupuesto_sin_respuesta` de hub.panorama_direccion (fecha < hoy - 7).
const DIAS_SIN_RESPUESTA = 7;
const FILTROS: [string, string][] = [['abiertos', 'Abiertos'], ['Borrador', 'Borrador'], ['Enviado', 'Enviados'], ['sin_respuesta', 'Sin respuesta'],
  ['Aceptado', 'Aceptados'], ['Rechazado', 'Rechazados'], ['', 'Todos']];

let _lista: Presupuesto[] = [];
let _listaAt = 0;
let _clientes = new Map<string, string>();
let _q = '';
let _filtro = 'abiertos';
let _persona = '';      // '' todas · '__mios' · un nombre
let _actual: string | null = null;

const dia = (p: Presupuesto) => (p.fecha ?? p.created_at ?? '').slice(0, 10);
const diasDesde = (p: Presupuesto) => { const d = dia(p); return d ? Math.floor((Date.now() - new Date(`${d}T12:00`).getTime()) / 86_400_000) : 0; };
const sinRespuesta = (p: Presupuesto) => p.estado === 'Enviado' && diasDesde(p) > DIAS_SIN_RESPUESTA;
const nombre = (p: Presupuesto) => `${p.numero_presupuesto ? `${p.numero_presupuesto} · ` : ''}${p.titulo || 'Sin título'}`;
const chipEstado = (e: string | null) => `<span class="chip ${TONO[e ?? ''] ?? ''}">${esc(e ?? '—')}</span>`;
const fechaCorta = (p: Presupuesto) => dia(p) ? esc(new Date(`${dia(p)}T12:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: '2-digit' })) : '';

// ── Datos ───────────────────────────────────────────────────────────────────
async function cargar() {
  if (_lista.length && Date.now() - _listaAt < 5 * 60_000) return null;
  const [ps, cs] = await Promise.all([
    API.fetchAll<Presupuesto>('presupuestos', { select: COLS, order: 'created_at.desc' }),
    _clientes.size ? Promise.resolve(null) : API.fetchAll<{ id: string; nombre: string }>('clientes', { select: 'id,nombre' }),
  ]);
  if (cs && !cs.error) _clientes = new Map((cs.data ?? []).map(c => [c.id, c.nombre]));
  if (ps.error) return ps.error;
  _lista = ps.data ?? []; _listaAt = Date.now();
  return null;
}

function filtrados(): Presupuesto[] {
  const q = _q.toLowerCase();
  return _lista.filter(p => {
    if (_filtro === 'abiertos' && p.estado !== 'Borrador' && p.estado !== 'Enviado') return false;
    if (_filtro === 'sin_respuesta' && !sinRespuesta(p)) return false;
    if (_filtro && _filtro !== 'abiertos' && _filtro !== 'sin_respuesta' && (p.estado ?? '—') !== _filtro) return false;
    if (_persona === '__mios' && !esMio(p.tecnico_id)) return false;
    if (_persona && !_persona.startsWith('__') && p.tecnico_id !== _persona) return false;
    return !q || [p.titulo, p.numero_presupuesto, p.tecnico_id, p.exigencias, _clientes.get(p.cliente_id ?? '')].some(x => (x ?? '').toLowerCase().includes(q));
  });
}

// ── Cifras y reparto ────────────────────────────────────────────────────────
const suma = (ps: Presupuesto[]) => ps.reduce((s, p) => s + Number(p.total ?? 0), 0);

function cifra(titulo: string, valor: string, sub: string, tono = '') {
  return `<article class="tarjeta di-cifra ${tono}"><h3>${esc(titulo)}</h3><p class="di-valor">${valor}</p><p class="nota">${sub}</p></article>`;
}

function cifras(): string {
  const abiertos = _lista.filter(p => p.estado === 'Borrador' || p.estado === 'Enviado');
  const sinResp = _lista.filter(sinRespuesta);
  // Tasa de aceptación de lo que ya tiene respuesta en los últimos 12 meses.
  const desde = new Date(); desde.setFullYear(desde.getFullYear() - 1);
  const anio = _lista.filter(p => dia(p) >= desde.toLocaleDateString('sv-SE'));
  const ac = anio.filter(p => p.estado === 'Aceptado'), re = anio.filter(p => p.estado === 'Rechazado');
  const tasa = ac.length + re.length ? Math.round(100 * ac.length / (ac.length + re.length)) : null;
  return `<div class="di-cifras pp-cifras">
    ${cifra('Abiertos', eur(suma(abiertos)), `${abiertos.length} entre borrador y enviados`)}
    ${cifra('Sin respuesta', String(sinResp.length), sinResp.length ? `enviados hace más de una semana · ${eur(suma(sinResp))}` : 'ninguno esperando', sinResp.length ? 'mal' : '')}
    ${cifra('Aceptado (12 meses)', eur(suma(ac)), ac.length === 1 ? '1 presupuesto' : `${ac.length} presupuestos`)}
    ${cifra('Tasa de aceptación', tasa == null ? '—' : `${tasa} %`, tasa == null ? 'aún sin respuestas este año' : `${ac.length} ${ac.length === 1 ? 'aceptado' : 'aceptados'} de ${ac.length + re.length} con respuesta`)}
  </div>`;
}

function reparto(): string {
  const otros = [...new Set(_lista.map(p => p.estado ?? '—'))].filter(e => !ESTADOS.includes(e));
  return barras('pp-barras', 'Importe por estado', [...ESTADOS, ...otros].map(e => {
    const ps = _lista.filter(p => (p.estado ?? '—') === e);
    return { clave: e, etiqueta: e, valor: suma(ps), texto: `${eur(suma(ps))} <small class="nota">· ${ps.length}</small>`, detalle: `${e}: ${ps.length} presupuestos · ${eur(suma(ps))}` };
  }), 'ppFiltro', _filtro);
}

// ── Lista ───────────────────────────────────────────────────────────────────
async function pintarLista(el: HTMLElement) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const [error, delHub] = await Promise.all([cargar(), esDelHub('presupuestos')]);
  if (error && !_lista.length) { el.innerHTML = `<p class="aviso mal">No se pudieron leer los presupuestos: ${esc(error.message)}</p>`; return; }
  const personas = [...new Set(_lista.map(p => p.tecnico_id).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b));
  const lista = filtrados();
  el.innerHTML = `${delHub ? '' : avisoSoloLectura('Presupuestos')}
    <div class="pp-cabeza">${cifras()}${reparto()}</div>
    <div class="acciones mo-barra">
      <input id="pp-filtro" type="search" placeholder="Buscar por número, título, cliente o persona…" value="${esc(_q)}" data-on-input="ppFiltrar:$value" aria-label="Buscar presupuesto">
      <select id="pp-persona" data-on-change="ppPersona:$value" aria-label="Persona">
        <option value="">Todo el equipo</option><option value="__mios" ${_persona === '__mios' ? 'selected' : ''}>Los míos</option>
        ${personas.map(p => `<option ${p === _persona ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>
    </div>
    <div class="acciones mo-barra">${FILTROS.map(([k, n]) => `<button class="chip-boton ${_filtro === k ? 'activo' : ''}" data-action="ppFiltro" data-p0="${k}">${n}</button>`).join('')}</div>
    <p class="nota">Mostrando ${Math.min(lista.length, 200)} de ${lista.length} · ${eur(suma(lista))} en total.</p>
    <div class="tarjeta mo-scroll"><table class="tabla" id="pp-tabla"><thead><tr><th>Presupuesto</th><th>Estado</th><th>Fecha</th><th>Cliente</th><th>Quién</th><th class="num">Total</th></tr></thead>
      <tbody>${lista.slice(0, 200).map(p => `<tr class="fila-clic" data-action="ppAbrir" data-p0="${esc(p.id)}">
        <td><strong>${esc(nombre(p))}</strong>${p.zoho_estimate_id ? ' <span class="chip" title="Ya está en Zoho Books">Zoho</span>' : ''}</td>
        <td>${chipEstado(p.estado)}${sinRespuesta(p) ? ` <span class="chip mal" title="Enviado y sin respuesta">${diasDesde(p)} d</span>` : ''}</td>
        <td>${fechaCorta(p)}</td>
        <td>${esc(_clientes.get(p.cliente_id ?? '') ?? '')}</td>
        <td>${esc(p.tecnico_id ?? '')}</td>
        <td class="num">${eur(p.total, 2)}</td></tr>`).join('') || '<tr><td colspan="6" class="vacio">Ningún presupuesto con ese filtro.</td></tr>'}</tbody></table></div>`;
}

// ── Ficha ───────────────────────────────────────────────────────────────────
const dato = (t: string, v: string) => v ? `<div class="me-dato"><dt>${esc(t)}</dt><dd>${v}</dd></div>` : '';

async function pintarFicha(el: HTMLElement, id: string) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  _actual = id;
  const { data: p, error } = await API.single<Presupuesto>('presupuestos', { select: COLS, id: `eq.${id}` });
  if (error || !p) { el.innerHTML = '<p class="aviso mal">No se encontró el presupuesto.</p><p><a href="#/presupuestos">← Presupuestos</a></p>'; return; }
  const uno = async (tabla: string, idv: string | null, cols: string) => idv ? (await API.single<any>(tabla, { select: cols, id: `eq.${idv}` })).data : null;
  const [cli, loc, con, opo, lin, tra, delHub] = await Promise.all([
    uno('clientes', p.cliente_id, 'id,nombre'), uno('locales', p.local_id, 'id,nombre'), uno('contactos', p.contacto_id, 'id,nombre,telefono'),
    uno('oportunidades', p.oportunidad_id, 'id,titulo'),
    API.fetchAll<Linea>('documento_lineas', { select: 'id,nombre,cantidad,precio,descuento,subtotal,orden,categoria', presupuesto_id: `eq.${id}`, order: 'orden.nullslast,id' }),
    API.fetchAll<{ id: string; numero: number | null; titulo: string | null; estado: string | null }>('trabajos', { select: 'id,numero,titulo,estado', presupuesto_id: `eq.${id}` }),
    esDelHub('presupuestos'),
  ]);
  if (_actual !== id) return;
  const lineas = lin.data ?? [];
  const enl = (href: string, txt: string) => `<a href="${esc(href)}">${esc(txt)}</a>`;
  const sumaLineas = lineas.reduce((s, l) => s + Number(l.subtotal ?? Number(l.cantidad ?? 0) * Number(l.precio ?? 0)), 0);
  el.innerHTML = `<p><a href="#/presupuestos">← Presupuestos</a></p>
    ${delHub ? '' : avisoSoloLectura('Presupuestos')}
    <div class="tarjeta-cab"><h2>${esc(nombre(p))}</h2>
      <div class="acciones"><a class="btn secundario" href="${esc(enApp())}" target="_blank" rel="noopener" title="Los presupuestos se cambian y se mandan a Zoho en la app actual">Abrir en la app ↗</a></div></div>
    <p>${chipEstado(p.estado)} ${sinRespuesta(p) ? `<span class="chip mal">Enviado hace ${diasDesde(p)} días, sin respuesta</span>` : ''} ${p.zoho_estimate_id ? '<span class="chip">En Zoho Books</span>' : ''}</p>
    <div class="me-grid">
      <section class="tarjeta pp-total"><h3>💶 Total</h3><p class="di-valor">${eur(p.total, 2)}</p>
        <p class="nota">${lineas.length} ${lineas.length === 1 ? 'línea' : 'líneas'}${lineas.length && Math.abs(sumaLineas - Number(p.total ?? 0)) > 0.01 ? ` · suman ${eur(sumaLineas, 2)} sin impuestos` : ''}</p>
        <dl class="me-datos">${dato('Fecha', fechaCorta(p))}${dato('Quién', esc(p.tecnico_id ?? ''))}${dato('Creado', p.created_at ? esc(hace(p.created_at)) : '')}</dl></section>
      <section class="tarjeta"><h3>🔗 Para quién</h3><dl class="me-datos">
        ${dato('Cliente', cli ? enl(`#/clientes/${cli.id}`, cli.nombre) : '')}${dato('Sitio', loc ? enl(`#/sitios/${loc.id}`, loc.nombre) : '')}
        ${dato('Contacto', con ? `${enl(`#/contactos/${con.id}`, con.nombre)}${con.telefono ? ` · <a href="tel:${esc(con.telefono)}">${esc(con.telefono)}</a>` : ''}` : '')}
        ${dato('Oportunidad', opo ? enl(`#/oportunidades/${opo.id}`, opo.titulo) : '')}
        ${dato('Trabajos', (tra.data ?? []).map(t => enl(`#/trabajos/${t.id}`, `#${t.numero ?? '?'} ${t.titulo ?? ''}`) + (t.estado ? ` <small class="nota">${esc(t.estado)}</small>` : '')).join('<br>'))}</dl>
        ${cli || loc ? '' : '<p class="nota">Sin cliente ni sede.</p>'}</section>
      ${p.exigencias ? `<section class="tarjeta"><h3>📝 Lo que pide el cliente</h3><p class="si-pre">${esc(p.exigencias)}</p></section>` : ''}
    </div>
    <section class="tarjeta mo-scroll"><h3>📦 Líneas</h3>
      ${lin.error ? `<p class="aviso mal">No se pudieron leer las líneas: ${esc(lin.error.message)}</p>` : ''}
      <table class="tabla" id="pp-lineas"><thead><tr><th>Concepto</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Dto.</th><th class="num">Subtotal</th></tr></thead>
      <tbody>${lineas.map(l => `<tr><td>${esc(l.nombre ?? '')}${l.categoria ? ` <small class="nota">${esc(l.categoria)}</small>` : ''}</td>
        <td class="num">${Number(l.cantidad ?? 0).toLocaleString('es-ES')}</td><td class="num">${eur(l.precio, 2)}</td>
        <td class="num">${l.descuento ? `${Number(l.descuento).toLocaleString('es-ES')} %` : ''}</td>
        <td class="num">${eur(l.subtotal ?? Number(l.cantidad ?? 0) * Number(l.precio ?? 0), 2)}</td></tr>`).join('') || '<tr><td colspan="5" class="vacio">Sin líneas.</td></tr>'}</tbody></table>
    </section>`;
}

export async function pintarPresupuestos(el: HTMLElement, params: string[]) {
  if (params[0]) await pintarFicha(el, params[0]);
  else await pintarLista(el);
}

let _timer: number | undefined;
registrarAcciones({
  ppAbrir(id: string) { ir('presupuestos', id); },
  ppFiltro(k: string) { _filtro = k; resolver(); },
  ppPersona(v: string) { _persona = v; resolver(); },
  ppFiltrar(v: string) {
    _q = v;
    clearTimeout(_timer);
    _timer = window.setTimeout(() => {
      resolver();
      window.setTimeout(() => { const f = document.getElementById('pp-filtro') as HTMLInputElement | null; f?.focus(); f?.setSelectionRange(v.length, v.length); }, 60);
    }, 250);
  },
});
