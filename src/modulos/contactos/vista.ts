// Vista de Contactos (ver index.ts). Solo lectura: contactos, clientes,
// locales, trabajos y tickets son espejo de la app.
import { API } from '../../core/api';
import { registrarAcciones } from '../../core/dispatcher';
import { ir, resolver } from '../../core/router';
import { esDelHub, avisoSoloLectura } from '../../core/areas';
import { esAdmin } from '../../core/estado';
import { esc, hace, fechaHora, toast } from '../../ui/dom';
import { enApp, telWhatsApp } from '../ventas/datos';
import { esqueleto } from '../../ui/esqueleto';
import { ico, type IconoLinea } from '../../shell/linea';

interface Contacto {
  id: string; nombre: string; tipo: string | null; empresa: string | null; cargo: string | null;
  telefono: string | null; telefono2: string | null; email: string | null; direccion: string | null; notas: string | null;
  favorito: boolean | null; cliente_id: string | null; local_id: string | null; activo: boolean | null; etiquetas: string[] | null;
}

const TIPOS: [string, string, IconoLinea?][] = [['', 'Todos'], ['favorito', 'Favoritos', 'estrella'], ['cliente', 'Clientes', 'empresa'], ['proveedor', 'Proveedores', 'furgoneta'], ['empleado', 'Empleados', 'tecnico'], ['otro', 'Otros', 'persona']];
const NOMBRE_TIPO: Record<string, string> = { cliente: 'Cliente', proveedor: 'Proveedor', empleado: 'Empleado', otro: 'Otro' };
const PESTANAS = [['datos', 'Datos'], ['trabajos', 'Trabajos'], ['tickets', 'Tickets']] as const;
const COLS = 'id,nombre,tipo,empresa,cargo,telefono,telefono2,email,direccion,notas,favorito,cliente_id,local_id,activo,etiquetas';

let _lista: Contacto[] = [];
let _listaAt = 0;
let _listaBaja = false;
let _clientes = new Map<string, string>();
let _locales = new Map<string, string>();
let _q = '';
let _tipo = '';
let _etiqueta = '';
let _baja = false;
let _actual: Contacto | null = null;

/** Olvida la lista en caché (tras crear, editar o dar de baja). */
export function olvidarContactos() { _lista = []; _listaAt = 0; }

const botones = (c: Contacto) => {
  const wa = telWhatsApp(c.telefono);
  return `${c.telefono ? `<a class="btn secundario" href="tel:${esc(c.telefono)}" data-action="coNada">${ico('telefono')} ${esc(c.telefono)}</a>` : ''}
    ${wa ? `<a class="btn secundario" href="https://wa.me/${wa}" target="_blank" rel="noopener" data-action="coNada" aria-label="WhatsApp">${ico('mensaje')}</a>` : ''}
    ${c.email ? `<a class="btn secundario" href="mailto:${esc(c.email)}" data-action="coNada" aria-label="Correo">${ico('correo')}</a>` : ''}`;
};
const chipsEtiquetas = (c: Contacto) => (c.etiquetas ?? []).map(e => `<span class="chip">${esc(e)}</span>`).join(' ');

// ── Lista ───────────────────────────────────────────────────────────────────
async function cargar() {
  if (_lista.length && _listaBaja === _baja && Date.now() - _listaAt < 5 * 60_000) return null;
  const [cs, cl, lo] = await Promise.all([
    API.fetchAll<Contacto>('contactos', { select: COLS, activo: _baja ? 'eq.false' : 'neq.false', order: 'nombre' }),
    _clientes.size ? Promise.resolve(null) : API.fetchAll<{ id: string; nombre: string }>('clientes', { select: 'id,nombre' }),
    _locales.size ? Promise.resolve(null) : API.fetchAll<{ id: string; nombre: string }>('locales', { select: 'id,nombre' }),
  ]);
  if (cl && !cl.error) _clientes = new Map((cl.data ?? []).map(c => [c.id, c.nombre]));
  if (lo && !lo.error) _locales = new Map((lo.data ?? []).map(l => [l.id, l.nombre]));
  if (cs.error) return cs.error;
  _lista = cs.data ?? []; _listaAt = Date.now(); _listaBaja = _baja;
  return null;
}

async function pintarLista(el: HTMLElement) {
  el.innerHTML = esqueleto('tabla');
  const [error, escribe] = await Promise.all([cargar(), esDelHub('contactos')]);
  if (error && !_lista.length) { el.innerHTML = `<p class="aviso mal">No se pudieron leer los contactos: ${esc(error.message)}</p>`; return; }
  const q = _q.toLowerCase();
  const etiquetas = [...new Set(_lista.flatMap(c => c.etiquetas ?? []))].sort((a, b) => a.localeCompare(b));
  const filtrados = _lista.filter(c =>
    (!_tipo || (_tipo === 'favorito' ? !!c.favorito : (c.tipo ?? 'otro') === _tipo)) &&
    (!_etiqueta || (c.etiquetas ?? []).includes(_etiqueta)) &&
    (!q || [c.nombre, c.empresa, c.cargo, c.email, _clientes.get(c.cliente_id ?? ''), _locales.get(c.local_id ?? '')].some(x => (x ?? '').toLowerCase().includes(q))
      || (q.replace(/\D/g, '').length >= 3 && [c.telefono, c.telefono2].some(t => (t ?? '').replace(/\D/g, '').includes(q.replace(/\D/g, ''))))));
  el.innerHTML = `${escribe ? '' : avisoSoloLectura('Contactos')}
    <div class="acciones mo-barra">
      <input id="co-filtro" type="search" placeholder="Buscar por nombre, empresa, teléfono, email, cliente o sitio…" value="${esc(_q)}" data-on-input="coFiltrar:$value" aria-label="Buscar contacto">
      ${etiquetas.length ? `<select id="co-etiqueta" data-on-change="coEtiqueta:$value" aria-label="Etiqueta"><option value="">Todas las etiquetas</option>${etiquetas.map(e => `<option ${e === _etiqueta ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select>` : ''}
      <button class="chip-boton ${_baja ? 'activo' : ''}" data-action="coBaja" aria-pressed="${_baja}">De baja</button>
      ${escribe ? '<a class="btn" href="#/contactos/nuevo">+ Nuevo contacto</a>' : ''}
    </div>
    <div class="acciones mo-barra">${TIPOS.map(([k, n, i]) => `<button class="chip-boton ${_tipo === k ? 'activo' : ''}" data-action="coTipo" data-p0="${k}">${i ? `${ico(i)} ` : ''}${n}</button>`).join('')}</div>
    <p class="nota">${_baja ? 'Contactos DE BAJA. ' : ''}Mostrando ${Math.min(filtrados.length, 200)} de ${filtrados.length}.</p>
    <div class="tarjeta mo-scroll"><table class="tabla" id="co-tabla"><thead><tr><th>Contacto</th><th>Cliente · sitio</th><th>Llamar / escribir</th></tr></thead>
    <tbody>${filtrados.slice(0, 200).map(c => `<tr class="fila-clic" data-action="coAbrir" data-p0="${esc(c.id)}">
      <td><strong>${c.favorito ? `${ico('estrella')} ` : ''}${esc(c.nombre)}</strong> <small class="nota">${esc(NOMBRE_TIPO[c.tipo ?? 'otro'] ?? c.tipo ?? '')}</small>
        ${c.empresa || c.cargo ? `<br><small class="nota">${esc([c.empresa, c.cargo].filter(Boolean).join(' · '))}</small>` : ''} ${chipsEtiquetas(c)}</td>
      <td>${esc(_clientes.get(c.cliente_id ?? '') ?? '')}${c.local_id && _locales.get(c.local_id) ? `<br><small class="nota">${ico('ubicacion')} ${esc(_locales.get(c.local_id))}</small>` : ''}</td>
      <td><div class="acciones">${botones(c)}</div></td></tr>`).join('') || '<tr><td colspan="3" class="vacio">Ningún contacto con ese filtro.</td></tr>'}</tbody></table></div>`;
}

// ── Ficha ───────────────────────────────────────────────────────────────────
const dato = (t: string, v: unknown) => v == null || v === '' ? '' : `<div class="me-dato"><dt>${esc(t)}</dt><dd>${esc(v)}</dd></div>`;

function tabDatos(c: Contacto): string {
  const cliente = c.cliente_id ? _clientes.get(c.cliente_id) : null;
  const sitio = c.local_id ? _locales.get(c.local_id) : null;
  return `<div class="me-grid">
    <section class="tarjeta"><h3>${ico('ficha')} Datos</h3><dl class="me-datos">
      ${dato('Tipo', NOMBRE_TIPO[c.tipo ?? 'otro'] ?? c.tipo)}${dato('Empresa', c.empresa)}${dato('Cargo', c.cargo)}
      ${dato('Teléfono', c.telefono)}${dato('Otro teléfono', c.telefono2)}${dato('Email', c.email)}${dato('Dirección', c.direccion)}
      ${cliente ? `<div class="me-dato"><dt>Cliente</dt><dd><a href="#/clientes/${esc(c.cliente_id)}">${esc(cliente)}</a></dd></div>` : ''}
      ${sitio ? `<div class="me-dato"><dt>Sitio</dt><dd><a href="#/sitios/${esc(c.local_id)}">${esc(sitio)}</a></dd></div>` : ''}</dl>
      ${(c.etiquetas ?? []).length ? `<p>${chipsEtiquetas(c)}</p>` : ''}</section>
    ${c.notas ? `<section class="tarjeta"><h3>${ico('nota')} Notas</h3><p class="si-pre">${esc(c.notas)}</p></section>` : ''}
  </div>`;
}

async function tabTrabajos(c: Contacto): Promise<string> {
  const { data, error } = await API.get<any[]>('trabajos', { select: 'id,numero,titulo,descripcion,estado,fecha_programada', contacto_id: `eq.${c.id}`, order: 'created_at.desc', limit: '50' });
  if (error) return `<p class="aviso mal">${esc(error.message)}</p>`;
  if (!(data ?? []).length) return '<p class="vacio">No figura en ningún trabajo.</p>';
  return `<div class="tarjeta mo-scroll"><table class="tabla"><thead><tr><th>Nº</th><th>Trabajo</th><th>Estado</th><th>Fecha</th></tr></thead>
    <tbody>${(data ?? []).map(t => `<tr class="fila-clic" data-action="coTrabajo" data-p0="${esc(t.id)}"><td>#${esc(t.numero ?? '?')}</td>
      <td>${esc(t.titulo || (t.descripcion ?? '').slice(0, 80))}</td><td>${esc(t.estado ?? '')}</td><td>${esc(t.fecha_programada ?? '')}</td></tr>`).join('')}</tbody></table></div>`;
}

async function tabTickets(c: Contacto): Promise<string> {
  const { data, error } = await API.get<any[]>('tickets', { select: 'id,numero,titulo,estado,created_at', contacto_id: `eq.${c.id}`, order: 'created_at.desc', limit: '50' });
  if (error) return `<p class="aviso mal">${esc(error.message)}</p>`;
  if (!(data ?? []).length) return '<p class="vacio">No figura en ningún ticket.</p>';
  return `<div class="tarjeta mo-scroll"><table class="tabla"><thead><tr><th>Nº</th><th>Ticket</th><th>Estado</th><th>Abierto</th></tr></thead>
    <tbody>${(data ?? []).map(t => `<tr class="fila-clic" data-action="coTicket" data-p0="${esc(t.id)}"><td>#${esc(t.numero ?? '?')}</td>
      <td>${esc(t.titulo)}</td><td>${esc(t.estado ?? '')}</td><td title="${esc(fechaHora(t.created_at))}">${esc(hace(t.created_at))}</td></tr>`).join('')}</tbody></table></div>`;
}

async function pintarFicha(el: HTMLElement, id: string, pestana = 'datos') {
  el.innerHTML = esqueleto('lineas');
  const [{ data: c, error }] = await Promise.all([API.single<Contacto>('contactos', { select: COLS, id: `eq.${id}` }), _clientes.size ? null : cargar()]);
  if (error || !c) { el.innerHTML = '<p class="aviso mal">No se encontró el contacto.</p><p><a href="#/contactos">← Contactos</a></p>'; return; }
  _actual = c;
  const p = PESTANAS.some(([k]) => k === pestana) ? pestana : 'datos';
  const escribe = await esDelHub('contactos');
  const puede = escribe && (c.tipo !== 'empleado' || esAdmin());
  el.innerHTML = `<p><a href="#/contactos">← Contactos</a></p>
    <div class="tarjeta-cab"><h2>${c.favorito ? `${ico('estrella')} ` : ''}${esc(c.nombre)}${c.activo === false ? ' <span class="chip mal">De baja</span>' : ''}</h2>
      <div class="acciones">${botones(c)}
        ${puede ? `<a class="btn secundario" href="#/contactos/${esc(c.id)}/editar">${ico('editar')} Editar</a>
          ${c.activo === false ? `<button class="btn secundario" data-action="coReactivar" data-p0="${esc(c.id)}">Reactivar</button>` : '<button class="btn secundario" data-action="coDarBaja">Dar de baja</button>'}`
        : escribe ? '' : `<a class="btn secundario" href="${esc(enApp())}" target="_blank" rel="noopener" title="Los contactos se editan en la app actual">Editar en la app ${ico('externo')}</a>`}</div></div>
    <p class="nota">${esc([NOMBRE_TIPO[c.tipo ?? 'otro'] ?? c.tipo, c.empresa, c.cargo].filter(Boolean).join(' · '))}</p>
    <nav class="pestanas" role="tablist">${PESTANAS.map(([k, n]) =>
      `<button role="tab" aria-selected="${k === p}" class="${k === p ? 'activo' : ''}" data-action="coPestana" data-p0="${esc(id)}" data-p1="${k}">${n}</button>`).join('')}</nav>
    <div id="co-cuerpo">${esqueleto('lineas')}</div>`;
  const cuerpo = p === 'trabajos' ? await tabTrabajos(c) : p === 'tickets' ? await tabTickets(c) : tabDatos(c);
  const caja = el.querySelector('#co-cuerpo');
  if (caja && _actual?.id === id) caja.innerHTML = cuerpo;
}

export async function pintarContactos(el: HTMLElement, params: string[]) {
  if (params[0] === 'nuevo') {
    const desde = params[1] === 'c' ? { cliente: params[2] } : params[1] === 'l' ? { sede: params[2] } : undefined;
    await (await import('./formulario')).pintarFormulario(el, undefined, desde);
    return;
  }
  if (params[0] && params[1] === 'editar') { await (await import('./formulario')).pintarFormulario(el, params[0]); return; }
  if (params[0]) await pintarFicha(el, params[0], params[1]);
  else await pintarLista(el);
}

let _timer: number | undefined;
registrarAcciones({
  coNada() { /* un enlace dentro de una fila clicable: que la fila no se dispare */ },
  coAbrir(id: string) { ir('contactos', id); },
  // «Eliminar» de la app: baja (activo = false), no se borra nada.
  async coDarBaja() {
    if (!_actual || !confirm('¿Dar de baja este contacto? Deja de salir en la agenda y en los buscadores; no se borra y se puede reactivar.')) return;
    const r = await API.patch('contactos', { id: `eq.${_actual.id}` }, { activo: false });
    if (r.error) { toast(`No se pudo dar de baja: ${r.error.message}`, 'error'); return; }
    olvidarContactos(); toast('Contacto dado de baja'); resolver();
  },
  async coReactivar(id: string) {
    const r = await API.patch('contactos', { id: `eq.${id}` }, { activo: true });
    if (r.error) { toast(`No se pudo reactivar: ${r.error.message}`, 'error'); return; }
    olvidarContactos(); toast('Contacto reactivado'); resolver();
  },
  coPestana(id: string, p: string) { ir('contactos', id, p); },
  coTipo(k: string) { _tipo = k; resolver(); },
  coEtiqueta(v: string) { _etiqueta = v; resolver(); },
  coBaja() { _baja = !_baja; resolver(); },
  coFiltrar(v: string) {
    _q = v;
    clearTimeout(_timer);
    _timer = window.setTimeout(() => {
      resolver();
      window.setTimeout(() => { const f = document.getElementById('co-filtro') as HTMLInputElement | null; f?.focus(); f?.setSelectionRange(v.length, v.length); }, 60);
    }, 250);
  },
  coTrabajo(id: string) { ir('trabajos', id); },
  coTicket(id: string) { ir('tickets', id); },
});
