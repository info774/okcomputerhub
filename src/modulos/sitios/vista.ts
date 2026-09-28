// Vista de Sitios (ver index.ts). Solo lectura: locales, contactos, trabajos y
// tickets son espejo de la app; los equipos salen de las vistas hub.rmm_*.
import { API } from '../../core/api';
import { esAdmin } from '../../core/estado';
import { registrarAcciones } from '../../core/dispatcher';
import { ir, resolver } from '../../core/router';
import { avisoSoloLectura } from '../../core/areas';
import { esc, hace, fechaHora } from '../../ui/dom';
import { eur, enApp, telWhatsApp } from '../ventas/datos';

interface Sitio {
  id: string; nombre: string; cliente_id: string | null; direccion: string | null; tipo: string | null; activo: boolean | null;
  estado: string | null; plan: string | null; estado_pago: string | null; programa_tpv: string | null;
  importe_mantenimiento?: number | null; lat: number | null; lng: number | null; maps_url: string | null;
}
interface EstadoRmm { local_id: string; equipos: number; conectados: number; alertas: number; visto_ultimo: string | null; estado: 'ok' | 'alerta' | 'parcial' | 'caido' }

const PESTANAS = [['resumen', 'Resumen'], ['contactos', 'Contactos'], ['trabajos', 'Trabajos'], ['tickets', 'Tickets'], ['equipos', 'Equipos']] as const;
const TONO_RMM: Record<string, string> = { ok: 'bien', alerta: 'mal', parcial: 'aviso', caido: 'mal' };
const TEXTO_RMM: Record<string, string> = { ok: 'Todo en línea', alerta: 'Con alertas', parcial: 'Alguno sin señal', caido: 'Sin señal' };
const PAGO_MAL = ['Último aviso', 'No paga'];
const SIN_MANT = (p: string | null) => !p || p === 'Sin mantenimiento';

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
  const error = await cargar();
  if (error && !_lista.length) { el.innerHTML = `<p class="aviso mal">No se pudieron leer los sitios: ${esc(error.message)}</p>`; return; }
  const q = _q.toLowerCase();
  const filtrados = _lista.filter(l =>
    (!_mant || (_mant === 'sin') === SIN_MANT(l.plan)) &&
    (_aviso !== 'cobro' || (!!l.estado_pago && l.estado_pago !== 'Al corriente' && !SIN_MANT(l.plan))) &&
    (_aviso !== 'equipos' || ['alerta', 'parcial', 'caido'].includes(_rmm.get(l.id)?.estado ?? '')) &&
    (!q || [l.nombre, l.direccion, l.programa_tpv, _clientes.get(l.cliente_id ?? '')].some(x => (x ?? '').toLowerCase().includes(q))));
  const seg = (accion: string, actual: string, opciones: [string, string][]) => `<div class="segmentado" role="tablist">${opciones.map(([k, n]) =>
    `<button role="tab" aria-selected="${actual === k}" class="${actual === k ? 'activo' : ''}" data-action="${accion}" data-p0="${k}">${n}</button>`).join('')}</div>`;
  el.innerHTML = `${avisoSoloLectura('Sitios')}
    <div class="acciones mo-barra">
      <input id="si-filtro" type="search" placeholder="Buscar por sitio, cliente, dirección o TPV…" value="${esc(_q)}" data-on-input="siFiltrar:$value" aria-label="Buscar sitio">
      ${seg('siMant', _mant, [['', 'Todos'], ['con', 'Con mantenimiento'], ['sin', 'Sin mantenimiento']])}
      ${seg('siAviso', _aviso, [['', 'Sin filtro'], ['cobro', 'Cobro torcido'], ['equipos', 'Equipos con aviso']])}
      <button class="chip-boton ${_baja ? 'activo' : ''}" data-action="siBaja" aria-pressed="${_baja}">De baja</button>
    </div>
    <p class="nota">${_baja ? 'Sitios DE BAJA (no salen en listados ni buscadores; se reactivan en la app). ' : ''}Mostrando ${Math.min(filtrados.length, 200)} de ${filtrados.length}.</p>
    <div class="tarjeta mo-scroll"><table class="tabla" id="si-tabla"><thead><tr><th>Sitio</th><th>Cliente</th><th>Mantenimiento</th><th>TPV</th><th>Equipos</th></tr></thead>
    <tbody>${filtrados.slice(0, 200).map(l => {
      const mapa = mapaDe(l);
      return `<tr class="fila-clic" data-action="siAbrir" data-p0="${esc(l.id)}">
        <td><strong>${esc(l.nombre)}</strong>${l.estado && l.estado !== 'activo' ? ` <span class="chip">${esc(l.estado)}</span>` : ''}${l.direccion ? `<br><small class="nota">${esc(l.direccion)}</small>` : ''}
          ${mapa ? ` <a href="${esc(mapa)}" target="_blank" rel="noopener" data-action="siNada">mapa ↗</a>` : ''}</td>
        <td>${esc(_clientes.get(l.cliente_id ?? '') ?? '—')}</td>
        <td>${SIN_MANT(l.plan) ? '<span class="nota">Sin mantenimiento</span>' : `${esc(l.plan)}${esAdmin() && l.importe_mantenimiento ? ` · ${eur(l.importe_mantenimiento, 2)}/mes` : ''} ${chipPago(l.estado_pago)}`}</td>
        <td>${esc(l.programa_tpv ?? '—')}</td>
        <td>${chipRmm(l)}</td></tr>`;
    }).join('') || '<tr><td colspan="5" class="vacio">Ningún sitio con ese filtro.</td></tr>'}</tbody></table></div>`;
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
  el.innerHTML = `<p><a href="#/sitios">← Sitios</a></p>
    <div class="tarjeta-cab"><h2>${esc(l.nombre)}${l.activo === false ? ' <span class="chip mal">De baja</span>' : ''}</h2>
      <div class="acciones">${mapa ? `<a class="btn secundario" href="${esc(mapa)}" target="_blank" rel="noopener">🗺 Cómo llegar</a>` : ''}
        <a class="btn secundario" href="${esc(enApp())}" target="_blank" rel="noopener" title="Los datos del sitio se editan en la app actual">Editar en la app ↗</a></div></div>
    <p class="nota">${cliente ? `<a href="#/clientes/${esc(l.cliente_id)}">${esc(cliente)}</a>` : 'Sin cliente'}${l.direccion ? ` · ${esc(l.direccion)}` : ''} ${chipPago(SIN_MANT(l.plan) ? null : l.estado_pago)}</p>
    <nav class="pestanas" role="tablist">${PESTANAS.map(([k, n]) =>
      `<button role="tab" aria-selected="${k === p}" class="${k === p ? 'activo' : ''}" data-action="siPestana" data-p0="${esc(id)}" data-p1="${k}">${n}</button>`).join('')}</nav>
    <div id="si-cuerpo"><p class="cargando">Cargando…</p></div>`;
  const cuerpo = await ({ resumen: tabResumen, contactos: tabContactos, trabajos: tabTrabajos, tickets: tabTickets, equipos: tabEquipos }[p]!)(l);
  const caja = el.querySelector('#si-cuerpo');
  if (caja && _sitio?.id === id) caja.innerHTML = cuerpo;
}

export async function pintarSitios(el: HTMLElement, params: string[]) {
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
  siTrabajo(id: string) { ir('trabajos', id); },
  siTicket(id: string) { ir('tickets', id); },
  siEquipo(id: string) { ir('monitorizacion', 'equipo', id); },
});
