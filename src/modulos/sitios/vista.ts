// Vista de Sitios (ver index.ts). Locales, teléfonos, contactos, trabajos y
// tickets son espejo de la app; los equipos salen de las vistas hub.rmm_*.
// Con el área `clientes` cortada se crean, editan, dan de baja y reactivan
// sedes y sus teléfonos (formulario.ts); sin el corte, todo en solo lectura.
import { API } from '../../core/api';
import { esAdmin } from '../../core/estado';
import { registrarAcciones } from '../../core/dispatcher';
import { ir, resolver } from '../../core/router';
import { esDelHub, avisoSoloLectura } from '../../core/areas';
import { descargarCsv } from '../../ui/csv';
import { esc, hace, fechaHora, toast } from '../../ui/dom';
import { eur, enApp, telWhatsApp } from '../ventas/datos';

interface Sitio {
  id: string; nombre: string; cliente_id: string | null; direccion: string | null; tipo: string | null; activo: boolean | null;
  estado: string | null; plan: string | null; estado_pago: string | null; programa_tpv: string | null;
  importe_mantenimiento?: number | null; lat: number | null; lng: number | null; maps_url: string | null;
}
interface EstadoRmm { local_id: string; equipos: number; conectados: number; alertas: number; visto_ultimo: string | null; estado: 'ok' | 'alerta' | 'parcial' | 'caido' }

const PESTANAS = [['resumen', 'Resumen'], ['telefonos', 'Teléfonos'], ['contactos', 'Contactos'], ['trabajos', 'Trabajos'], ['tickets', 'Tickets'], ['equipos', 'Equipos']] as const;
const TONO_RMM: Record<string, string> = { ok: 'bien', alerta: 'mal', parcial: 'aviso', caido: 'mal' };
const TEXTO_RMM: Record<string, string> = { ok: 'Todo en línea', alerta: 'Con alertas', parcial: 'Alguno sin señal', caido: 'Sin señal' };
const PAGO_MAL = ['Último aviso', 'No paga'];
const SIN_MANT = (p: string | null) => !p || p === 'Sin mantenimiento';
// Roles de local_telefonos (ROLES de mant-ficha.js de la app). Dueño y
// administración son los únicos a los que el WhatsApp manda documentos.
export const ROLES_TEL: [string, string][] = [['dueno', 'Dueño'], ['administracion', 'Administración'], ['encargado', 'Encargado'], ['empleado', 'Empleado'], ['otro', 'Otro']];
const rolTexto = (r: string | null) => ROLES_TEL.find(([k]) => k === r)?.[1] ?? 'Otro';

let _lista: Sitio[] = [];
let _listaAt = 0;
let _listaBaja = false;
let _clientes = new Map<string, string>();
let _rmm = new Map<string, EstadoRmm>();
let _q = '';
let _baja = false;
let _mant = '';     // '' | 'con' | 'sin'
let _aviso = '';    // '' | 'cobro' | 'equipos'
let _sitio: (Sitio & Record<string, any>) | null = null;
let _visibles: Sitio[] = [];
let _escribe = false;

/** Olvida la lista en caché (tras crear, editar o dar de baja). */
export function olvidarSitios() { _lista = []; _listaAt = 0; }

const mapaDe = (l: Sitio) => l.maps_url || (l.lat != null && l.lng != null ? `https://www.google.com/maps?q=${l.lat},${l.lng}`
  : l.direccion ? `https://www.google.com/maps/search/${encodeURIComponent(l.direccion)}` : '');
const chipRmm = (l: { id: string }) => {
  const e = _rmm.get(l.id);
  return e ? `<a class="chip ${TONO_RMM[e.estado]}" href="#/monitorizacion/sede/${esc(l.id)}" title="${esc(TEXTO_RMM[e.estado])}" data-action="siNada">${e.conectados}/${e.equipos}</a>` : '<span class="nota">—</span>';
};
const chipPago = (p: string | null) => p && p !== 'Al corriente' ? `<span class="chip ${PAGO_MAL.includes(p) ? 'mal' : 'aviso'}">${esc(p)}</span>` : '';

// ── Lista ───────────────────────────────────────────────────────────────────
async function cargar() {
  if (_lista.length && _listaBaja === _baja && Date.now() - _listaAt < 5 * 60_000) return null;
  const cols = `id,nombre,cliente_id,direccion,tipo,activo,estado,plan,estado_pago,programa_tpv,lat,lng,maps_url${esAdmin() ? ',importe_mantenimiento' : ''}`;
  const [ls, cs, rmm] = await Promise.all([
    API.fetchAll<Sitio>('locales', { select: cols, activo: _baja ? 'eq.false' : 'neq.false', order: 'nombre' }),
    _clientes.size ? Promise.resolve(null) : API.fetchAll<{ id: string; nombre: string }>('clientes', { select: 'id,nombre' }),
    API.get<EstadoRmm[]>('rmm_estado_local', { select: '*' }),
  ]);
  if (cs && !cs.error) _clientes = new Map((cs.data ?? []).map(c => [c.id, c.nombre]));
  if (!rmm.error) _rmm = new Map((rmm.data ?? []).map(e => [e.local_id, e]));
  if (ls.error) return ls.error;
  _lista = ls.data ?? []; _listaAt = Date.now(); _listaBaja = _baja;
  return null;
}

async function pintarLista(el: HTMLElement) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const [error, escribe] = await Promise.all([cargar(), esDelHub('locales')]);
  _escribe = escribe;
  if (error && !_lista.length) { el.innerHTML = `<p class="aviso mal">No se pudieron leer los sitios: ${esc(error.message)}</p>`; return; }
  const q = _q.toLowerCase();
  const filtrados = _lista.filter(l =>
    (!_mant || (_mant === 'sin') === SIN_MANT(l.plan)) &&
    (_aviso !== 'cobro' || (!!l.estado_pago && l.estado_pago !== 'Al corriente' && !SIN_MANT(l.plan))) &&
    (_aviso !== 'equipos' || ['alerta', 'parcial', 'caido'].includes(_rmm.get(l.id)?.estado ?? '')) &&
    (!q || [l.nombre, l.direccion, l.programa_tpv, _clientes.get(l.cliente_id ?? '')].some(x => (x ?? '').toLowerCase().includes(q))));
  const seg = (accion: string, actual: string, opciones: [string, string][]) => `<div class="segmentado" role="tablist">${opciones.map(([k, n]) =>
    `<button role="tab" aria-selected="${actual === k}" class="${actual === k ? 'activo' : ''}" data-action="${accion}" data-p0="${k}">${n}</button>`).join('')}</div>`;
  _visibles = filtrados;
  el.innerHTML = `${escribe ? '' : avisoSoloLectura('Sitios')}
    <div class="acciones mo-barra">
      <input id="si-filtro" type="search" placeholder="Buscar por sitio, cliente, dirección o TPV…" value="${esc(_q)}" data-on-input="siFiltrar:$value" aria-label="Buscar sitio">
      ${seg('siMant', _mant, [['', 'Todos'], ['con', 'Con mantenimiento'], ['sin', 'Sin mantenimiento']])}
      ${seg('siAviso', _aviso, [['', 'Sin filtro'], ['cobro', 'Cobro torcido'], ['equipos', 'Equipos con aviso']])}
      <button class="chip-boton ${_baja ? 'activo' : ''}" data-action="siBaja" aria-pressed="${_baja}">De baja</button>
      <button class="btn secundario" data-action="siExcel">⬇ Excel</button>
      ${escribe ? '<a class="btn" href="#/sitios/nuevo">+ Nuevo sitio</a>' : `<a class="btn secundario" href="${esc(enApp())}" target="_blank" rel="noopener">+ Nuevo sitio en la app ↗</a>`}
    </div>
    <p class="nota">${_baja ? `Sitios DE BAJA (no salen en listados ni buscadores; ${escribe ? 'se reactivan desde aquí' : 'se reactivan en la app'}). ` : ''}Mostrando ${Math.min(filtrados.length, 200)} de ${filtrados.length}.</p>
    <div class="tarjeta mo-scroll"><table class="tabla" id="si-tabla"><thead><tr><th>Sitio</th><th>Cliente</th><th>Mantenimiento</th><th>TPV</th><th>Equipos</th>${_baja && escribe ? '<th></th>' : ''}</tr></thead>
    <tbody>${filtrados.slice(0, 200).map(l => {
      const mapa = mapaDe(l);
      return `<tr class="fila-clic" data-action="siAbrir" data-p0="${esc(l.id)}">
        <td><strong>${esc(l.nombre)}</strong>${l.estado && l.estado !== 'activo' ? ` <span class="chip">${esc(l.estado)}</span>` : ''}${l.direccion ? `<br><small class="nota">${esc(l.direccion)}</small>` : ''}
          ${mapa ? ` <a href="${esc(mapa)}" target="_blank" rel="noopener" data-action="siNada">mapa ↗</a>` : ''}</td>
        <td>${esc(_clientes.get(l.cliente_id ?? '') ?? '—')}</td>
        <td>${SIN_MANT(l.plan) ? '<span class="nota">Sin mantenimiento</span>' : `${esc(l.plan)}${esAdmin() && l.importe_mantenimiento ? ` · ${eur(l.importe_mantenimiento, 2)}/mes` : ''} ${chipPago(l.estado_pago)}`}</td>
        <td>${esc(l.programa_tpv ?? '—')}</td>
        <td>${chipRmm(l)}</td>${_baja && escribe ? `<td><button class="btn secundario" data-action="siReactivar" data-p0="${esc(l.id)}" data-stop="1">Reactivar</button></td>` : ''}</tr>`;
    }).join('') || '<tr><td colspan="6" class="vacio">Ningún sitio con ese filtro.</td></tr>'}</tbody></table></div>`;
}

// ── Ficha ───────────────────────────────────────────────────────────────────
const dato = (t: string, v: unknown) => v == null || v === '' ? '' : `<div class="me-dato"><dt>${esc(t)}</dt><dd>${esc(v)}</dd></div>`;

async function tabResumen(l: Sitio & Record<string, any>): Promise<string> {
  const e = _rmm.get(l.id);
  const alarma = l.alarma_empresa || l.alarma_telefono || l.alarma_contrato || l.alarma_codigo;
  return `<div class="me-grid">
    <section class="tarjeta"><h3>📍 El sitio</h3><dl class="me-datos">
      ${dato('Tipo', l.tipo)}${dato('Estado', l.estado)}${dato('Dirección', l.direccion)}${dato('Horario', l.horario)}${dato('Programa TPV', l.programa_tpv)}</dl>
      ${l.notas ? `<p class="nota">${esc(l.notas)}</p>` : ''}</section>
    <section class="tarjeta"><h3>🔁 Mantenimiento</h3>${SIN_MANT(l.plan) ? '<p class="nota">Sin mantenimiento.</p>' : `<dl class="me-datos">
      ${dato('Plan', l.plan)}
      <div class="me-dato"><dt>Estado de pago</dt><dd>${esc(l.estado_pago ?? '—')} ${l.stripe_cobro_en_curso_at ? '<span class="chip aviso">Cobro en curso</span>' : ''}</dd></div>
      ${esAdmin() && l.importe_mantenimiento ? dato('Cuota', `${eur(l.importe_mantenimiento, 2)}${l.importe_incluye_impuesto ? ' (con impuesto)' : ''}`) : ''}
      ${dato('Frecuencia', l.frecuencia_pago)}${dato('Forma de pago', l.forma_pago)}${dato('Próxima cuota', l.proxima_cuota)}${dato('Activo desde', l.fecha_activacion)}
      ${dato('Cobra', l.stripe_subscription_id ? 'Stripe' : l.zoho_subscription_id ? 'Zoho (cartera vieja)' : null)}</dl>
      ${l.notas_mantenimiento ? `<p class="nota">${esc(l.notas_mantenimiento)}</p>` : ''}`}</section>
    <section class="tarjeta"><h3>🖥 Equipos</h3>${e ? `<p><span class="chip ${TONO_RMM[e.estado]}">${esc(TEXTO_RMM[e.estado])}</span>
      ${e.conectados} de ${e.equipos} en línea${e.alertas ? ` · <b>${e.alertas}</b> alerta${e.alertas === 1 ? '' : 's'}` : ''}</p>
      ${e.visto_ultimo ? `<p class="nota">Último contacto ${esc(hace(e.visto_ultimo))}</p>` : ''}
      <a href="#/monitorizacion/sede/${esc(l.id)}">Ver en Monitorización →</a>` : '<p class="nota">Sin agente de Breeze en este sitio.</p>'}</section>
    ${l.notas_tecnicas ? `<section class="tarjeta"><h3>🛠 Notas técnicas</h3><p class="si-pre">${esc(l.notas_tecnicas)}</p></section>` : ''}
    ${alarma ? `<section class="tarjeta"><h3>🚨 Alarma</h3><dl class="me-datos">
      ${dato('Empresa', l.alarma_empresa)}${dato('Teléfono', l.alarma_telefono)}${dato('Contrato', l.alarma_contrato)}
      ${l.alarma_codigo ? `<div class="me-dato"><dt>Código</dt><dd><span id="si-codigo">••••</span> <button class="btn secundario" data-action="siCodigo" data-p0="$this">Ver</button></dd></div>` : ''}</dl>
      ${l.alarma_notas ? `<p class="nota">${esc(l.alarma_notas)}</p>` : ''}</section>` : ''}
  </div>`;
}

async function tabTelefonos(l: Sitio): Promise<string> {
  const { data, error } = await API.get<any[]>('local_telefonos', { select: 'id,nombre,numero,rol', local_id: `eq.${l.id}`, order: 'created_at' });
  if (error) return `<p class="aviso mal">${esc(error.message)}</p>`;
  const ts = data ?? [];
  const opt = (sel: string) => ROLES_TEL.map(([k, n]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${n}</option>`).join('');
  const tabla = ts.length ? `<div class="tarjeta mo-scroll"><table class="tabla" id="si-tels"><thead><tr><th>Nombre</th><th>Número</th><th>Rol</th>${_escribe ? '<th></th>' : ''}</tr></thead>
    <tbody>${ts.map(t => {
      const wa = telWhatsApp(t.numero);
      return `<tr data-tel="${esc(t.id)}"><td>${esc(t.nombre ?? '—')}</td>
        <td><a href="tel:${esc(t.numero)}">${esc(t.numero)}</a>${wa ? ` · <a href="https://wa.me/${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</td>
        <td>${_escribe ? `<select aria-label="Rol" data-on-change="siTelRol:${esc(t.id)},$value">${opt(t.rol ?? 'otro')}</select>` : esc(rolTexto(t.rol))}</td>
        ${_escribe ? `<td class="acciones"><button class="btn secundario" data-action="siTelEditar" data-p0="${esc(t.id)}" data-p1="${esc(t.nombre ?? '')}" data-p2="${esc(t.numero)}" data-p3="${esc(t.rol ?? 'otro')}">✎</button>
          <button class="btn secundario" data-action="siTelBorrar" data-p0="${esc(t.id)}" aria-label="Quitar">🗑</button></td>` : ''}</tr>`;
    }).join('')}</tbody></table></div>` : '<p class="vacio">Sin teléfonos apuntados en este sitio.</p>';
  const form = _escribe ? `<form class="tarjeta" id="si-tel-form" data-on-submit="siTelGuardar" data-prevent="1"><h3 id="si-tel-titulo">Añadir teléfono</h3>
    <input type="hidden" id="si-tel-id">
    <div class="in-campos"><label>Nombre <input id="si-tel-nombre" placeholder="Pepe (dueño)"></label>
      <label>Número <input id="si-tel-numero" type="tel" required></label>
      <label>Rol <select id="si-tel-rol">${opt('otro')}</select></label></div>
    <p class="nota">Dueño y Administración son los únicos a los que el WhatsApp manda facturas y documentos.</p>
    <div class="acciones"><button class="btn" type="submit">Guardar teléfono</button>
      <button class="btn secundario" type="button" data-action="siTelLimpiar">Limpiar</button></div></form>` : '';
  return tabla + form;
}

async function tabContactos(l: Sitio): Promise<string> {
  const { data, error } = await API.get<any[]>('contactos', { select: 'id,nombre,cargo,telefono,email,favorito', local_id: `eq.${l.id}`, activo: 'neq.false', order: 'favorito.desc.nullslast,nombre' });
  if (error) return `<p class="aviso mal">${esc(error.message)}</p>`;
  if (!(data ?? []).length) return '<p class="vacio">Sin contactos de este sitio en la app.</p>';
  return `<div class="cl-contactos">${(data ?? []).map(p => {
    const wa = telWhatsApp(p.telefono);
    return `<article class="tarjeta"><h3><a href="#/contactos/${esc(p.id)}">${p.favorito ? '⭐ ' : ''}${esc(p.nombre)}</a></h3>${p.cargo ? `<p class="nota">${esc(p.cargo)}</p>` : ''}
      <div class="acciones">${p.telefono ? `<a class="btn secundario" href="tel:${esc(p.telefono)}">📞 ${esc(p.telefono)}</a>` : ''}
        ${wa ? `<a class="btn secundario" href="https://wa.me/${wa}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}
        ${p.email ? `<a class="btn secundario" href="mailto:${esc(p.email)}">✉️ ${esc(p.email)}</a>` : ''}</div></article>`;
  }).join('')}</div>`;
}

async function tabTrabajos(l: Sitio): Promise<string> {
  const { data, error } = await API.get<any[]>('trabajos', { select: 'id,numero,titulo,descripcion,estado,fecha_programada,tecnicos', local_id: `eq.${l.id}`, order: 'created_at.desc', limit: '50' });
  if (error) return `<p class="aviso mal">${esc(error.message)}</p>`;
  if (!(data ?? []).length) return '<p class="vacio">Ningún trabajo en este sitio.</p>';
  return `<div class="tarjeta mo-scroll"><table class="tabla"><thead><tr><th>Nº</th><th>Trabajo</th><th>Estado</th><th>Fecha</th><th>Técnicos</th></tr></thead>
    <tbody>${(data ?? []).map(t => `<tr class="fila-clic" data-action="siTrabajo" data-p0="${esc(t.id)}"><td>#${esc(t.numero ?? '?')}</td>
      <td>${esc(t.titulo || (t.descripcion ?? '').slice(0, 80))}</td><td>${esc(t.estado ?? '')}</td><td>${esc(t.fecha_programada ?? '')}</td>
      <td>${esc((t.tecnicos ?? []).join(', '))}</td></tr>`).join('')}</tbody></table></div>`;
}

async function tabTickets(l: Sitio): Promise<string> {
  const { data, error } = await API.get<any[]>('tickets', { select: 'id,numero,titulo,estado,prioridad,created_at', local_id: `eq.${l.id}`, order: 'created_at.desc', limit: '50' });
  if (error) return `<p class="aviso mal">${esc(error.message)}</p>`;
  if (!(data ?? []).length) return '<p class="vacio">Ningún ticket de este sitio.</p>';
  return `<div class="tarjeta mo-scroll"><table class="tabla"><thead><tr><th>Nº</th><th>Ticket</th><th>Estado</th><th>Prioridad</th><th>Abierto</th></tr></thead>
    <tbody>${(data ?? []).map(t => `<tr class="fila-clic" data-action="siTicket" data-p0="${esc(t.id)}"><td>#${esc(t.numero ?? '?')}</td>
      <td>${esc(t.titulo)}</td><td>${esc(t.estado ?? '')}</td><td>${esc(t.prioridad ?? '')}</td>
      <td title="${esc(fechaHora(t.created_at))}">${esc(hace(t.created_at))}</td></tr>`).join('')}</tbody></table></div>`;
}

async function tabEquipos(l: Sitio): Promise<string> {
  const { data, error } = await API.get<any[]>('rmm_equipos', { select: 'id,hostname,nombre,so,conectado,visto_ultimo,ultimo_usuario', local_id: `eq.${l.id}`, order: 'hostname' });
  if (error) return `<p class="aviso mal">${esc(error.message)}</p>`;
  if (!(data ?? []).length) return '<p class="vacio">Sin equipos de Breeze en este sitio.</p>';
  return `<div class="tarjeta mo-scroll"><table class="tabla"><thead><tr><th>Equipo</th><th>Sistema</th><th>Estado</th><th>Último contacto</th></tr></thead>
    <tbody>${(data ?? []).map(q => `<tr class="fila-clic" data-action="siEquipo" data-p0="${esc(q.id)}"><td><strong>${esc(q.hostname)}</strong>${q.ultimo_usuario ? `<br><small class="nota">${esc(q.ultimo_usuario)}</small>` : ''}</td>
      <td>${esc(q.so ?? '')}</td><td><span class="chip ${q.conectado ? 'bien' : 'mal'}">${q.conectado ? 'En línea' : 'Sin señal'}</span></td>
      <td>${esc(hace(q.visto_ultimo))}</td></tr>`).join('')}</tbody></table></div>`;
}

async function pintarFicha(el: HTMLElement, id: string, pestana = 'resumen') {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  const [{ data: l, error }] = await Promise.all([API.single<Sitio & Record<string, any>>('locales', { select: '*', id: `eq.${id}` }), _rmm.size ? null : cargar()]);
  if (error || !l) { el.innerHTML = '<p class="aviso mal">No se encontró el sitio.</p><p><a href="#/sitios">← Sitios</a></p>'; return; }
  if (!esAdmin()) delete l.importe_mantenimiento;
  _sitio = l;
  const p = PESTANAS.some(([k]) => k === pestana) ? pestana : 'resumen';
  const cliente = l.cliente_id ? _clientes.get(l.cliente_id) ?? (await API.single<{ nombre: string }>('clientes', { select: 'nombre', id: `eq.${l.cliente_id}` })).data?.nombre : null;
  const mapa = mapaDe(l);
  _escribe = await esDelHub('locales');
  const botones = _escribe
    ? `<a class="btn secundario" href="#/sitios/${esc(l.id)}/editar">✎ Editar</a>
       ${l.activo === false ? `<button class="btn secundario" data-action="siReactivar" data-p0="${esc(l.id)}">Reactivar</button>` : '<button class="btn secundario" data-action="siDarBaja">Dar de baja</button>'}
       ${esAdmin() ? '<button class="btn peligro" data-action="siEliminar">Eliminar</button>' : ''}`
    : `<a class="btn secundario" href="${esc(enApp())}" target="_blank" rel="noopener" title="Los datos del sitio se editan en la app actual">Editar en la app ↗</a>`;
  el.innerHTML = `<p><a href="#/sitios">← Sitios</a></p>
    <div class="tarjeta-cab"><h2>${esc(l.nombre)}${l.activo === false ? ' <span class="chip mal">De baja</span>' : ''}</h2>
      <div class="acciones">${mapa ? `<a class="btn secundario" href="${esc(mapa)}" target="_blank" rel="noopener">🗺 Cómo llegar</a>` : ''}
        ${botones}</div></div>
    ${l.activo === false ? `<p class="aviso">Este sitio está DE BAJA: no sale en listados ni buscadores. No se ha borrado nada.</p>` : ''}
    <p class="nota">${cliente ? `<a href="#/clientes/${esc(l.cliente_id)}">${esc(cliente)}</a>` : 'Sin cliente'}${l.direccion ? ` · ${esc(l.direccion)}` : ''} ${chipPago(SIN_MANT(l.plan) ? null : l.estado_pago)}</p>
    <nav class="pestanas" role="tablist">${PESTANAS.map(([k, n]) =>
      `<button role="tab" aria-selected="${k === p}" class="${k === p ? 'activo' : ''}" data-action="siPestana" data-p0="${esc(id)}" data-p1="${k}">${n}</button>`).join('')}</nav>
    <div id="si-cuerpo"><p class="cargando">Cargando…</p></div>`;
  const cuerpo = await ({ resumen: tabResumen, telefonos: tabTelefonos, contactos: tabContactos, trabajos: tabTrabajos, tickets: tabTickets, equipos: tabEquipos }[p]!)(l);
  const caja = el.querySelector('#si-cuerpo');
  if (caja && _sitio?.id === id) caja.innerHTML = cuerpo;
}

export async function pintarSitios(el: HTMLElement, params: string[]) {
  if (params[0] === 'nuevo') { await (await import('./formulario')).pintarFormulario(el, undefined, params[1]); return; }
  if (params[0] && params[1] === 'editar') { await (await import('./formulario')).pintarFormulario(el, params[0]); return; }
  if (params[0]) await pintarFicha(el, params[0], params[1]);
  else await pintarLista(el);
}

let _timer: number | undefined;
registrarAcciones({
  siNada() { /* un enlace dentro de una fila clicable: que la fila no se dispare */ },
  siAbrir(id: string) { ir('sitios', id); },
  siPestana(id: string, p: string) { ir('sitios', id, p); },
  siMant(k: string) { _mant = k; resolver(); },
  siAviso(k: string) { _aviso = k; resolver(); },
  siBaja() { _baja = !_baja; resolver(); },
  siFiltrar(v: string) {
    _q = v;
    clearTimeout(_timer);
    _timer = window.setTimeout(() => {
      resolver();
      window.setTimeout(() => { const f = document.getElementById('si-filtro') as HTMLInputElement | null; f?.focus(); f?.setSelectionRange(v.length, v.length); }, 60);
    }, 250);
  },
  siCodigo(btn: HTMLElement) {
    const s = document.getElementById('si-codigo');
    if (!s || !_sitio?.alarma_codigo) return;
    const ver = s.textContent === '••••';
    s.textContent = ver ? String(_sitio.alarma_codigo) : '••••';
    btn.textContent = ver ? 'Ocultar' : 'Ver';
  },
  siExcel() {
    descargarCsv(_baja ? 'sitios-de-baja' : 'sitios', ['ID', 'Cliente', 'Sitio', 'Dirección', 'Tipo', 'Estado', 'Mantenimiento', 'Plan', 'Software TPV', 'Estado de pago'],
      _visibles.map(l => [l.id, _clientes.get(l.cliente_id ?? '') ?? '', l.nombre, l.direccion, l.tipo, l.estado,
        SIN_MANT(l.plan) ? 'No' : 'Sí', l.plan, l.programa_tpv, SIN_MANT(l.plan) ? '' : l.estado_pago]));
  },
  // Baja lógica (darDeBajaLocal de la app): solo `activo`, no se borra nada.
  async siDarBaja() {
    if (!_sitio || !confirm('¿Dar de baja este sitio? Deja de salir en listados y buscadores, pero no se borra nada: sus trabajos, tickets y equipos siguen ahí y se puede reactivar.')) return;
    const r = await API.patch('locales', { id: `eq.${_sitio.id}` }, { activo: false });
    if (r.error) { toast(`No se pudo dar de baja: ${r.error.message}`, 'error'); return; }
    olvidarSitios(); toast('Sitio dado de baja'); resolver();
  },
  async siReactivar(id: string) {
    const r = await API.patch('locales', { id: `eq.${id}` }, { activo: true });
    if (r.error) { toast(`No se pudo reactivar: ${r.error.message}`, 'error'); return; }
    olvidarSitios(); toast('Sitio reactivado'); resolver();
  },
  // Eliminar (deleteLocal de la app, solo admin): borra la fila de verdad. En
  // el hub no hay cascada (espejo sin claves foráneas): sus teléfonos se quitan antes.
  async siEliminar() {
    if (!_sitio || !esAdmin() || !confirm(`¿ELIMINAR «${_sitio.nombre}»? Se borra el sitio y sus teléfonos, y no se puede deshacer. Si solo deja de ser cliente, mejor «Dar de baja».`)) return;
    const id = _sitio.id;
    const t = await API.delete('local_telefonos', { local_id: `eq.${id}` });
    if (t.error) { toast(`No se pudo eliminar: ${t.error.message}`, 'error'); return; }
    const r = await API.delete('locales', { id: `eq.${id}` });
    if (r.error) { toast(`No se pudo eliminar: ${r.error.message}`, 'error'); return; }
    olvidarSitios(); toast('Sitio eliminado'); ir('sitios');
  },
  siTelEditar(id: string, nombre: string, numero: string, rol: string) {
    const v = (i: string, x: string) => { const e = document.getElementById(i) as HTMLInputElement | null; if (e) e.value = x; };
    v('si-tel-id', id); v('si-tel-nombre', nombre); v('si-tel-numero', numero); v('si-tel-rol', rol);
    const t = document.getElementById('si-tel-titulo'); if (t) t.textContent = 'Editar teléfono';
    (document.getElementById('si-tel-numero') as HTMLInputElement | null)?.focus();
  },
  siTelLimpiar() {
    (document.getElementById('si-tel-form') as HTMLFormElement | null)?.reset();
    (document.getElementById('si-tel-id') as HTMLInputElement).value = '';
    const t = document.getElementById('si-tel-titulo'); if (t) t.textContent = 'Añadir teléfono';
  },
  async siTelGuardar() {
    if (!_sitio) return;
    const v = (i: string) => (document.getElementById(i) as HTMLInputElement | null)?.value.trim() ?? '';
    const numero = v('si-tel-numero');
    if (!numero) { toast('Falta el número', 'error'); return; }
    const cuerpo = { nombre: v('si-tel-nombre') || null, numero, rol: v('si-tel-rol') || 'otro' };
    const id = v('si-tel-id');
    const r = id ? await API.patch('local_telefonos', { id: `eq.${id}` }, cuerpo) : await API.post('local_telefonos', { ...cuerpo, local_id: _sitio.id });
    if (r.error) { toast(`No se pudo guardar el teléfono: ${r.error.message}`, 'error'); return; }
    toast(id ? 'Teléfono guardado' : 'Teléfono añadido');
    resolver();
  },
  async siTelRol(id: string, rol: string) {
    const r = await API.patch('local_telefonos', { id: `eq.${id}` }, { rol });
    toast(r.error ? `No se pudo cambiar el rol: ${r.error.message}` : 'Rol cambiado', r.error ? 'error' : 'info');
  },
  async siTelBorrar(id: string) {
    if (!confirm('¿Quitar este teléfono del sitio?')) return;
    const r = await API.delete('local_telefonos', { id: `eq.${id}` });
    if (r.error) { toast(`No se pudo quitar: ${r.error.message}`, 'error'); return; }
    toast('Teléfono quitado'); resolver();
  },
  siTrabajo(id: string) { ir('trabajos', id); },
  siTicket(id: string) { ir('tickets', id); },
  siEquipo(id: string) { ir('monitorizacion', 'equipo', id); },
});
