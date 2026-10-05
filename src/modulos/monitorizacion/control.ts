// Control de equipos (paridad bloque 7, tanda 4: control-equipos.js de la
// app): ¿lleva cada PC de cliente Action1, Breeze, RustDesk y AnyDesk? Se LEE
// `hub.equipos_control`, el espejo de la comprobación diaria de la app (área
// `equipos`; decisión de Fran: verlo ya, la pasada propia preparada sin
// encender). Dos sitios:
//   · la pestaña «Software obligatorio» de Monitorización (todos, con filtros:
//     incompletos, sin sede, todos, ignorados);
//   · la sección de cada sede en #/monitorizacion/sede/<id>.
// Ignorar un PC, asignarle sede a mano y «Comprobar ahora» (función
// `control-equipos` del hub) se encienden con el corte del área.
// Prefijo de ids: mce-.
import { API } from '../../core/api';
import { esAdmin } from '../../core/estado';
import { registrarAcciones } from '../../core/dispatcher';
import { resolver } from '../../core/router';
import { esDelHub, avisoSoloLectura } from '../../core/areas';
import { llamarFuncion } from '../../core/funciones';
import { esc, toast, hace } from '../../ui/dom';
import { ico } from '../../shell/linea';

export interface EquipoControl { id: string; clave: string; hostname: string | null; local_id: string | null; local_manual: boolean; ignorar: boolean; faltan: string[] | null;
  tiene_action1: boolean | null; tiene_breeze: boolean | null; tiene_rustdesk: boolean | null; tiene_anydesk: boolean | null;
  rustdesk_id: string | null; anydesk_id: string | null; comprobado_at: string | null; breeze_visto: string | null; action1_visto: string | null }

export const PROGRAMAS: [string, string][] = [['action1', 'Action1'], ['breeze', 'Breeze'], ['rustdesk', 'RustDesk'], ['anydesk', 'AnyDesk']];
const COLS = 'id,clave,hostname,local_id,local_manual,ignorar,faltan,tiene_action1,tiene_breeze,tiene_rustdesk,tiene_anydesk,rustdesk_id,anydesk_id,comprobado_at,breeze_visto,action1_visto';
const FILTROS: [string, string][] = [['incompletos', 'Incompletos'], ['sinsede', 'Sin sede'], ['todos', 'Todos'], ['ignorados', 'Ignorados']];
let _filtro = 'incompletos';

const faltanTxt = (e: EquipoControl) => (e.faltan ?? []).map(f => PROGRAMAS.find(p => p[0] === f)?.[1] ?? f).join(', ');
const marca = (v: boolean | null) => v === true ? `<span class="g-bien" title="Lo tiene">${ico('hecho')}</span>`
  : v === false ? `<span class="g-mal" title="Le falta">${ico('cerrar')}</span>` : '<span class="nota" title="Sin datos">?</span>';
const ultima = (fs: EquipoControl[]) => fs.reduce((m, e) => (e.comprobado_at && e.comprobado_at > m ? e.comprobado_at : m), '');

function fila(e: EquipoControl, sedes: Map<string, string>, opciones: string, escribe: boolean, conSede: boolean) {
  const dis = escribe ? '' : 'disabled';
  return `<tr class="${e.ignorar ? 'apagado' : ''}"><td><strong>${esc(e.hostname || e.clave)}</strong>${(e.faltan ?? []).length && !e.ignorar ? `<br><small class="g-mal">falta ${esc(faltanTxt(e))}</small>` : ''}</td>
    ${conSede ? `<td>${e.local_id ? `<a href="#/monitorizacion/sede/${esc(e.local_id)}">${esc(sedes.get(e.local_id) ?? 'Sede')}</a>${e.local_manual ? ' <small class="nota">(a mano)</small>' : ''}`
      : `<select data-on-change="mceAsignar:${esc(e.id)},$value" aria-label="Sede de ${esc(e.hostname ?? e.clave)}" ${dis}><option value="">— Sin sede —</option>${opciones}</select>`}</td>` : ''}
    ${PROGRAMAS.map(([k]) => `<td class="num">${marca(e[`tiene_${k}` as keyof EquipoControl] as boolean | null)}${k === 'breeze' && e.tiene_breeze === false && e.breeze_visto ? `<br><small class="nota">sin conectar desde ${esc(e.breeze_visto.slice(0, 10))}</small>` : ''}</td>`).join('')}
    <td><small>${e.rustdesk_id ? `RD ${esc(e.rustdesk_id)}` : ''}${e.rustdesk_id && e.anydesk_id ? '<br>' : ''}${e.anydesk_id ? `AD ${esc(e.anydesk_id)}` : ''}</small></td>
    <td><button class="btn secundario" data-action="mceIgnorar" data-p0="${esc(e.id)}" data-p1="${e.ignorar ? '0' : '1'}" ${dis}
      title="${e.ignorar ? 'Volver a controlar' : 'No controlar este PC (servidor, personal, retirado…)'}">${e.ignorar ? 'Controlar' : 'Ignorar'}</button></td></tr>`;
}

const cabecera = (conSede: boolean) => `<thead><tr><th>Equipo</th>${conSede ? '<th>Sede</th>' : ''}${PROGRAMAS.map(([, n]) => `<th class="num">${n}</th>`).join('')}<th>IDs</th><th></th></tr></thead>`;

async function sedesDe(fs: EquipoControl[]) {
  const ids = [...new Set(fs.map(e => e.local_id).filter(Boolean) as string[])];
  const m = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 150) for (const l of (await API.get<{ id: string; nombre: string }[]>('locales', { select: 'id,nombre', id: `in.(${ids.slice(i, i + 150).join(',')})` })).data ?? []) m.set(l.id, l.nombre);
  return m;
}

/** La pestaña «Software obligatorio» de Monitorización. */
export async function tabControl(): Promise<string> {
  const [r, escribe] = await Promise.all([API.fetchAll<EquipoControl>('equipos_control', { select: COLS, order: 'hostname' }), esDelHub('equipos_control')]);
  if (r.error) return `<p class="aviso mal">No se pudo leer el control de equipos: ${esc(r.error.message)}</p>`;
  const todos = r.data ?? [];
  const activos = todos.filter(e => !e.ignorar);
  const incompletos = activos.filter(e => (e.faltan ?? []).length), sinSede = activos.filter(e => !e.local_id);
  const lista = _filtro === 'incompletos' ? incompletos : _filtro === 'sinsede' ? sinSede : _filtro === 'ignorados' ? todos.filter(e => e.ignorar) : todos;
  const [sedes, locs] = await Promise.all([sedesDe(lista),
    sinSede.length && _filtro === 'sinsede' ? API.fetchAll<{ id: string; nombre: string }>('locales', { select: 'id,nombre', activo: 'eq.true', order: 'nombre' }) : Promise.resolve({ data: [], error: null })]);
  const opciones = (locs.data ?? []).map(l => `<option value="${esc(l.id)}">${esc(l.nombre)}</option>`).join('');
  const ult = ultima(todos);
  return `${escribe ? '' : avisoSoloLectura('El control de equipos')}
    <div class="di-cifras pp-cifras mce-cifras">
      <article class="tarjeta di-cifra"><h3>PCs controlados</h3><p class="di-valor">${activos.length}</p><p class="nota">${todos.length - activos.length} ignorado(s)</p></article>
      <article class="tarjeta di-cifra ${incompletos.length ? 'mal' : ''}"><h3>Incompletos</h3><p class="di-valor">${incompletos.length}</p><p class="nota">les falta algún programa</p></article>
      <article class="tarjeta di-cifra ${sinSede.length ? 'atento' : ''}"><h3>Sin sede</h3><p class="di-valor">${sinSede.length}</p><p class="nota">vistos sin saber de quién son</p></article>
      <article class="tarjeta di-cifra"><h3>Última comprobación</h3><p class="di-valor">${ult ? esc(hace(ult)) : '—'}</p><p class="nota">cada día con Breeze y Action1</p></article>
    </div>
    <div class="acciones mo-barra"><div class="segmentado" role="tablist">${FILTROS.map(([k, t]) => `<button type="button" data-action="mceFiltro" data-p0="${k}" class="${k === _filtro ? 'activo' : ''}">${t}</button>`).join('')}</div>
      ${escribe && esAdmin() ? `<button class="btn secundario" data-action="mceComprobar">${ico('actualizar')} Comprobar ahora</button>` : ''}</div>
    <div class="tarjeta mo-scroll">${lista.length ? `<table class="tabla" id="mce-tabla">${cabecera(true)}<tbody>${lista.map(e => fila(e, sedes, opciones, escribe, true)).join('')}</tbody></table>`
      : `<p class="vacio">${_filtro === 'incompletos' ? 'Todos los PCs llevan lo que tienen que llevar.' : 'Nada por aquí.'}</p>`}</div>
    <p class="nota">Cada PC de cliente tiene que llevar Action1, Breeze, RustDesk y AnyDesk. Lo comprueba cada mañana la app; aquí llega a las 7:40 (hora de Canarias, 6:40 UTC).</p>`;
}

/** La sección de una sede (en #/monitorizacion/sede/<id>). */
export async function seccionControlSede(localId: string): Promise<string> {
  const [r, escribe] = await Promise.all([API.get<EquipoControl[]>('equipos_control', { select: COLS, local_id: `eq.${localId}`, order: 'hostname' }), esDelHub('equipos_control')]);
  if (r.error) return '';
  const lista = r.data ?? [];
  const ult = ultima(lista);
  return `<section class="tarjeta mo-scroll" id="mce-sede"><h3>${ico('escudo')} Software obligatorio</h3>
    ${lista.length ? `<table class="tabla">${cabecera(false)}<tbody>${lista.map(e => fila(e, new Map(), '', escribe, false)).join('')}</tbody></table>`
      : '<p class="nota">Ni Breeze ni Action1 tienen equipos de esta sede todavía.</p>'}
    <p class="nota">${ult ? `Última comprobación ${esc(hace(ult))}. ` : ''}Se comprueba sola cada día con Breeze y Action1.</p></section>`;
}

registrarAcciones({
  mceFiltro(f: string) { _filtro = f; resolver(); },
  async mceIgnorar(id: string, v: string) {
    const r = await API.patch('equipos_control', { id: `eq.${id}` }, { ignorar: v === '1' });
    if (r.error) { toast(`No se pudo: ${r.error.message}`, 'error'); return; }
    toast(v === '1' ? 'Este PC ya no se controla' : 'Este PC vuelve a controlarse');
    resolver();
  },
  async mceAsignar(id: string, local: string) {
    if (!local) return;
    const r = await API.patch('equipos_control', { id: `eq.${id}` }, { local_id: local, local_manual: true });
    if (r.error) { toast(`No se pudo asignar: ${r.error.message}`, 'error'); return; }
    toast('PC asignado a la sede');
    resolver();
  },
  async mceComprobar() {
    toast('Comprobando… puede tardar un par de minutos');
    const r = await llamarFuncion<{ equipos: number; breeze: string; action1: string; omitido?: string }>('control-equipos', {}, 300000);
    if (r.error) { toast(`No se pudo comprobar: ${r.error}`, 'error'); return; }
    toast(r.data?.omitido ?? `Comprobados ${r.data?.equipos} PCs · Breeze: ${r.data?.breeze} · Action1: ${r.data?.action1}`);
    resolver();
  },
});
