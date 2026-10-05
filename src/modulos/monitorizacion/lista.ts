// Monitorización: #/monitorizacion/<pestaña> (sedes · equipos · alertas ·
// emparejado · acciones) y #/monitorizacion/sede/<local_id> (lo que será la
// pestaña «Monitor.» de la ficha del sitio cuando el hub tenga Sitios).
// Prefijo de ids: mo-.
import { API } from '../../core/api';
import { ir, resolver } from '../../core/router';
import { registrarAcciones } from '../../core/dispatcher';
import { esc, toast, hace, fechaHora } from '../../ui/dom';
import { ico } from '../../shell/linea';
import {
  type Equipo, type Alerta, type Site, type EstadoLocal,
  ESTADOS_SEDE, SEVERIDAD, ESTADO_ALERTA, enBreeze,
  listarEquipos, estadosLocales, listarAlertas, listarSites, nombresLocales, emparejarSite, pedirABreeze, estadoBreeze,
} from './datos';

export const PESTANAS = [
  ['sedes', 'Sedes'], ['equipos', 'Equipos'], ['alertas', 'Alertas'], ['emparejado', 'Emparejado'], ['acciones', 'Acciones'],
] as const;

let _el: HTMLElement | null = null;
let _ruta: string[] = [];
let _filtro = '';
let _soloSinConexion = false;
let _alertasTodas = false;
let _sitesSoloSinSede = true;
let _siteEditando: string | null = null;

const repintar = () => { if (_el) void pintarMonitorizacion(_el, _ruta); };
const chip = (texto: string, tono = 'neutro') => `<span class="chip ${esc(tono)}">${esc(texto)}</span>`;

function conexion(e: Equipo): string {
  return e.conectado
    ? `<span class="mo-punto bien" aria-hidden="true"></span> Conectado`
    : `<span class="mo-punto mal" aria-hidden="true"></span> ${esc(hace(e.visto_ultimo))}`;
}

function discoPeor(e: Equipo): string {
  const d = [...(e.discos ?? [])].filter(x => x.total_gb > 2).sort((a, b) => b.uso - a.uso)[0];
  if (!d) return '—';
  const tono = d.uso >= 90 ? 'mal' : d.uso >= 80 ? 'aviso' : '';
  return `<span class="${tono}">${esc(d.unidad)} ${Math.round(d.uso)} %</span> <small class="nota">(${esc(d.libre_gb)} GB libres)</small>`;
}

export function tablaEquipos(equipos: Equipo[], sedes: Map<string, string>, conSede = true): string {
  if (!equipos.length) return '<p class="vacio">No hay equipos que enseñar.</p>';
  return `<div class="tarjeta mo-scroll"><table class="tabla">
    <thead><tr><th>Equipo</th><th>Conexión</th>${conSede ? '<th>Sede</th>' : ''}<th>Sistema</th><th>Disco</th><th>Parches</th><th>Alertas</th><th>TPV</th></tr></thead>
    <tbody>${equipos.map(e => `<tr class="fila-clic" data-action="moEquipo" data-p0="${esc(e.id)}">
      <td><strong>${esc(e.nombre)}</strong>${e.ultimo_usuario ? `<br><small class="nota">${ico('persona')} ${esc(e.ultimo_usuario)}</small>` : ''}</td>
      <td>${conexion(e)}</td>
      ${conSede ? `<td>${e.local_id ? esc(sedes.get(e.local_id) ?? '…') : `<span class="nota">${esc(e.sitio ?? 'Sin Site')} · sin sede</span>`}</td>` : ''}
      <td>${esc((e.so_version ?? e.so).replace(/^Microsoft /, ''))}</td>
      <td>${discoPeor(e)}</td>
      <td>${e.parches_pendientes ? chip(String(e.parches_pendientes), e.parches_pendientes > 10 ? 'aviso' : 'neutro') : '<span class="nota">0</span>'}</td>
      <td>${e.alertas_abiertas ? chip(String(e.alertas_abiertas), 'mal') : '<span class="nota">0</span>'}</td>
      <td>${e.programa_tpv ? `${esc(e.programa_tpv)}${e.tpv_version ? ` <small>${esc(e.tpv_version)}</small>` : ' <small class="nota">¿?</small>'}` : '<span class="nota">—</span>'}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

export function tablaAlertas(alertas: Alerta[], sedes: Map<string, string>): string {
  if (!alertas.length) return `<p class="vacio">Sin alertas. ${ico('trofeo')}</p>`;
  return `<div class="tarjeta mo-scroll"><table class="tabla">
    <thead><tr><th>Gravedad</th><th>Alerta</th><th>Equipo</th><th>Cuándo</th><th>Estado</th><th></th></tr></thead>
    <tbody>${alertas.map(a => {
      const sev = SEVERIDAD[a.severidad] ?? { texto: a.severidad, tono: 'neutro' };
      return `<tr>
        <td>${chip(sev.texto, sev.tono)}</td>
        <td><strong>${esc(a.titulo)}</strong>${a.mensaje ? `<br><small class="nota">${esc(a.mensaje.slice(0, 200))}</small>` : ''}</td>
        <td>${a.device_id ? `<a href="#/monitorizacion/equipo/${esc(a.device_id)}">${esc(a.hostname ?? '?')}</a>` : '—'}
          <br><small class="nota">${esc(a.local_id ? sedes.get(a.local_id) ?? '' : a.sitio ?? '')}</small></td>
        <td title="${esc(fechaHora(a.disparada))}">${esc(hace(a.disparada))}</td>
        <td>${esc(ESTADO_ALERTA[a.estado] ?? a.estado)}${a.acusada_por ? `<br><small class="nota">por ${esc(a.acusada_por)}</small>` : ''}</td>
        <td class="acciones">
          ${a.estado === 'active' ? `<button class="btn secundario" data-action="moAcusar" data-p0="${esc(a.id)}">Acusar</button>` : ''}
          <a class="btn secundario" href="${esc(enBreeze.alerta(a.id))}" target="_blank" rel="noopener">${a.estado === 'resolved' ? 'Ver' : 'Resolver'} en Breeze ${ico('externo')}</a>
        </td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
}

// ── Pestañas ────────────────────────────────────────────────────────────────
async function tabSedes(): Promise<string> {
  const [est, sinSede] = await Promise.all([estadosLocales(), API.contar('rmm_equipos', { local_id: 'is.null' })]);
  if (est.error) return `<p class="aviso mal">No se pudo leer el estado: ${esc(est.error.message)}</p>`;
  const orden = { caido: 0, alerta: 1, parcial: 2, ok: 3 };
  const filas = (est.data ?? []).sort((a, b) => orden[a.estado] - orden[b.estado]);
  const nombres = await nombresLocales(filas.map(f => f.local_id));
  const tarjeta = (s: EstadoLocal) => {
    const e = ESTADOS_SEDE[s.estado];
    return `<article class="tarjeta fila-clic mo-sede ${esc(e.tono)}" data-action="moSede" data-p0="${esc(s.local_id)}">
      <h3>${esc(nombres.get(s.local_id) ?? 'Sede')}</h3>
      <p>${chip(e.texto, e.tono)}</p>
      <p class="nota">${s.conectados} de ${s.equipos} conectado(s)${s.alertas ? ` · ${s.alertas} alerta(s)` : ''}<br>Último contacto ${esc(hace(s.visto_ultimo))}</p>
    </article>`;
  };
  return `${sinSede ? `<p class="aviso">Hay ${sinSede} equipo(s) en Sites de Breeze sin sede del hub.
      <button class="btn secundario" data-action="moPestana" data-p0="emparejado">Emparejar</button></p>` : ''}
    ${filas.length ? `<div class="mo-sedes">${filas.map(tarjeta).join('')}</div>` : '<p class="vacio">Ninguna sede tiene todavía equipos con el agente de Breeze.</p>'}`;
}

async function tabEquipos(): Promise<string> {
  const { data, error } = await listarEquipos();
  if (error) return `<p class="aviso mal">No se pudieron leer los equipos: ${esc(error.message)}</p>`;
  const q = _filtro.toLowerCase();
  const sedes = await nombresLocales((data ?? []).map(e => e.local_id ?? ''));
  const lista = (data ?? []).filter(e => (!_soloSinConexion || !e.conectado) && (!q ||
    [e.nombre, e.hostname, e.sitio, e.ultimo_usuario, e.local_id ? sedes.get(e.local_id) : ''].some(x => (x ?? '').toLowerCase().includes(q))));
  return `<div class="acciones mo-barra">
      <input id="mo-filtro" type="search" placeholder="Buscar equipo, sede o usuario…" value="${esc(_filtro)}" data-on-input="moFiltrar:$value" aria-label="Buscar">
      <label class="check"><input type="checkbox" ${_soloSinConexion ? 'checked' : ''} data-on-change="moSinConexion:$checked"> Solo sin conexión</label>
      <span class="nota">${lista.length} de ${data?.length ?? 0}</span>
    </div>${tablaEquipos(lista, sedes)}`;
}

async function tabAlertas(): Promise<string> {
  const { data, error } = await listarAlertas(_alertasTodas ? {} : { estado: 'in.(active,acknowledged)' });
  if (error) return `<p class="aviso mal">No se pudieron leer las alertas: ${esc(error.message)}</p>`;
  const sedes = await nombresLocales((data ?? []).map(a => a.local_id ?? ''));
  return `<div class="acciones mo-barra"><div class="segmentado" role="tablist">
      <button role="tab" aria-selected="${!_alertasTodas}" class="${_alertasTodas ? '' : 'activo'}" data-action="moAlertasTodas" data-p0="0">Abiertas</button>
      <button role="tab" aria-selected="${_alertasTodas}" class="${_alertasTodas ? 'activo' : ''}" data-action="moAlertasTodas" data-p0="1">Últimos 90 días</button>
    </div></div>${tablaAlertas(data ?? [], sedes)}`;
}

async function tabEmparejado(): Promise<string> {
  const { data, error } = await listarSites();
  if (error) return `<p class="aviso mal">No se pudieron leer los Sites: ${esc(error.message)}</p>`;
  const todos = data ?? [];
  const lista = _sitesSoloSinSede ? todos.filter(s => !s.local_id || s.equipos > 0) : todos;
  const fila = (s: Site) => `<tr>
    <td><strong>${esc(s.sitio)}</strong><br><small class="nota">${esc(s.organizacion ?? '')}</small></td>
    <td>${s.equipos ? `${s.conectados}/${s.equipos}` : '<span class="nota">0</span>'}</td>
    <td>${_siteEditando === s.site_id ? `
        <input id="mo-local-q" placeholder="Buscar sede…" autocomplete="off" data-on-input="moBuscarLocal:$value" aria-label="Buscar sede">
        <ul id="mo-local-res" class="resultados"></ul>
        <div class="acciones"><button class="btn secundario" data-action="moSinSede" data-p0="${esc(s.site_id)}">Dejar sin sede</button>
          <button class="btn secundario" data-action="moEditarSite" data-p0="">Cancelar</button></div>`
      : `${s.local_id ? esc(s.local_nombre ?? '¿sede borrada?') : '<span class="chip aviso">Sin sede</span>'}
         ${s.manual ? ' <small class="nota">(a mano)</small>' : ''}`}</td>
    <td>${_siteEditando === s.site_id ? '' : `<button class="btn secundario" data-action="moEditarSite" data-p0="${esc(s.site_id)}">Cambiar</button>`}</td>
  </tr>`;
  return `<p class="nota">Cada Site de Breeze es una sede del hub. Se emparejan solos por nombre (cada hora) cuando casan con una sola sede;
      lo que se pone aquí a mano no lo vuelve a tocar el emparejado automático.</p>
    <div class="acciones mo-barra"><label class="check"><input type="checkbox" ${_sitesSoloSinSede ? 'checked' : ''} data-on-change="moSitesSinSede:$checked">
      Solo sin sede o con equipos</label><span class="nota">${lista.length} de ${todos.length} Sites · ${todos.filter(s => s.local_id).length} emparejados</span></div>
    <div class="tarjeta mo-scroll"><table class="tabla"><thead><tr><th>Site de Breeze</th><th>Equipos</th><th>Sede del hub</th><th></th></tr></thead>
    <tbody>${lista.map(fila).join('') || '<tr><td colspan="4" class="vacio">Todos los Sites tienen sede.</td></tr>'}</tbody></table></div>`;
}

async function tabAcciones(): Promise<string> {
  const { data, error } = await API.get('rmm_acciones', { select: '*', order: 'created_at.desc', limit: '100' });
  if (error) return `<p class="aviso mal">No se pudo leer el registro: ${esc(error.message)}</p>`;
  if (!data?.length) return '<p class="vacio">Todavía nadie le ha pedido nada a Breeze desde el hub.</p>';
  const que = (a: any) => a.accion === 'acusar_alerta' ? `Acusar «${a.detalle?.titulo ?? 'alerta'}»`
    : a.accion === 'comando' ? `${a.detalle?.tipo ?? 'Comando'} en ${a.detalle?.hostname ?? '?'}`
      : `Script «${a.detalle?.script ?? '?'}» en ${(a.detalle?.equipos ?? []).join(', ')}`;
  return `<p class="nota">Todo lo que el hub le ha pedido a Breeze, con quién y qué contestó.</p>
    <div class="tarjeta mo-scroll"><table class="tabla"><thead><tr><th>Cuándo</th><th>Quién</th><th>Qué</th><th>Resultado</th></tr></thead>
    <tbody>${data.map(a => `<tr><td>${esc(fechaHora(a.created_at))}</td><td>${esc(a.usuario_email ?? '')}</td><td>${esc(que(a))}</td>
      <td>${a.estado === 'ok' ? chip('Hecho', 'bien') : `${chip('Error', 'mal')} <small>${esc(a.error ?? '')}</small>`}</td></tr>`).join('')}</tbody></table></div>`;
}

async function vistaSede(localId: string): Promise<string> {
  const [eq, al, nombres, est] = await Promise.all([
    listarEquipos({ local_id: `eq.${localId}` }),
    listarAlertas({ local_id: `eq.${localId}`, estado: 'in.(active,acknowledged)' }),
    nombresLocales([localId]),
    API.single<EstadoLocal>('rmm_estado_local', { select: '*', local_id: `eq.${localId}` }),
  ]);
  const e = est.data ? ESTADOS_SEDE[est.data.estado] : null;
  return `<p><a href="#/monitorizacion/sedes">← Todas las sedes</a></p>
    <div class="tarjeta-cab"><h2>${esc(nombres.get(localId) ?? 'Sede')}</h2>${e ? chip(e.texto, e.tono) : ''}</div>
    ${eq.error ? `<p class="aviso mal">${esc(eq.error.message)}</p>` : tablaEquipos(eq.data ?? [], nombres, false)}
    <h3>Alertas abiertas</h3>${tablaAlertas(al.data ?? [], nombres)}`;
}

// ── Pintar ─────────────────────────────────────────────────────────────────
export async function pintarMonitorizacion(el: HTMLElement, params: string[]) {
  _el = el;
  _ruta = params;
  if (params[0] === 'sede' && params[1]) {
    el.innerHTML = '<p class="cargando">Cargando…</p>';
    el.innerHTML = await vistaSede(params[1]);
    return;
  }
  const pestana = PESTANAS.some(([k]) => k === params[0]) ? params[0] : 'sedes';
  el.innerHTML = `<nav class="pestanas" role="tablist">${PESTANAS.map(([k, n]) =>
      `<button role="tab" aria-selected="${k === pestana}" class="${k === pestana ? 'activo' : ''}" data-action="moPestana" data-p0="${k}">${n}</button>`).join('')}</nav>
    <div id="mo-aviso-breeze"></div>
    <div id="mo-cuerpo"><p class="cargando">Cargando…</p></div>`;
  void estadoBreeze().then(s => {
    const a = document.getElementById('mo-aviso-breeze');
    if (a && s && !s.configurado) a.innerHTML = '<p class="aviso">Las acciones sobre Breeze (acusar alertas, comandos, scripts) están apagadas: falta el usuario de servicio del hub en Breeze. Todo lo demás se ve igual.</p>';
  });
  const cuerpo = await ({ sedes: tabSedes, equipos: tabEquipos, alertas: tabAlertas, emparejado: tabEmparejado, acciones: tabAcciones }[pestana]!)();
  const c = document.getElementById('mo-cuerpo');
  if (c && _el === el) c.innerHTML = cuerpo;
}

let _timerFiltro: number | undefined;
registrarAcciones({
  moPestana(p: string) { _siteEditando = null; ir('monitorizacion', p); },
  moEquipo(id: string) { if (id) ir('monitorizacion', 'equipo', id); },
  moSede(id: string) { if (id) ir('monitorizacion', 'sede', id); },
  moFiltrar(v: string) {
    _filtro = v;
    clearTimeout(_timerFiltro);
    _timerFiltro = window.setTimeout(async () => {
      const c = document.getElementById('mo-cuerpo');
      if (!c) return;
      c.innerHTML = await tabEquipos();
      const f = document.getElementById('mo-filtro') as HTMLInputElement | null;
      f?.focus(); f?.setSelectionRange(v.length, v.length);
    }, 250);
  },
  moSinConexion(v: boolean) { _soloSinConexion = v; repintar(); },
  moAlertasTodas(v: string) { _alertasTodas = v === '1'; repintar(); },
  moSitesSinSede(v: boolean) { _sitesSoloSinSede = v; repintar(); },
  moEditarSite(id: string) { _siteEditando = id || null; repintar(); },
  async moBuscarLocal(q: string) {
    const ul = document.getElementById('mo-local-res');
    if (!ul) return;
    const t = q.replace(/[*,()%\\]/g, ' ').trim();
    if (t.length < 2) { ul.innerHTML = ''; return; }
    const { data } = await API.get<{ id: string; nombre: string; direccion: string | null }[]>('locales',
      { select: 'id,nombre,direccion', activo: 'eq.true', nombre: `ilike.*${t}*`, order: 'nombre', limit: '8' });
    ul.innerHTML = (data ?? []).map(l => `<li><button class="btn secundario" data-action="moPonerSede" data-p0="${esc(l.id)}">
      ${esc(l.nombre)} <small class="nota">${esc(l.direccion ?? '')}</small></button></li>`).join('') || '<li class="nota">Ninguna sede con ese nombre.</li>';
  },
  async moPonerSede(localId: string) {
    if (!_siteEditando) return;
    const r = await emparejarSite(_siteEditando, localId);
    if (r.error) { toast(`No se pudo emparejar: ${r.error.message}`, 'error'); return; }
    toast('Site emparejado');
    _siteEditando = null;
    repintar();
  },
  async moSinSede(siteId: string) {
    const r = await emparejarSite(siteId, null);
    if (r.error) { toast(`No se pudo cambiar: ${r.error.message}`, 'error'); return; }
    _siteEditando = null;
    repintar();
  },
  async moAcusar(alertaId: string) {
    const r = await pedirABreeze({ accion: 'acusar_alerta', alerta_id: alertaId });
    if (r.error) { toast(`Breeze no la acusó: ${r.error}`, 'error'); return; }
    toast('Alerta acusada en Breeze');
    resolver(); // repinta la pantalla en la que esté (lista, sede o equipo)
  },
});
