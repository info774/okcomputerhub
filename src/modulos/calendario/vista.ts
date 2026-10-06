// Calendario planificador (paridad bloque 1, tanda 2): el calendario de la app
// en el hub. Vistas Semana · Día (rejilla por técnico) · Por técnico · Agenda ·
// Mes; carga del día, solapes, traslados entre sedes, panel de pendientes con
// «Sugerir hueco» y filtros guardados. Las reglas están en motor.ts.
// Escribir (mover un bloque, reasignar, planificar un pendiente) solo con las
// áreas `agenda` y `trabajos` cortadas; antes, todo se ve y nada se mueve.
// Planificar escribe la fecha en el TRABAJO y el bloque sale del disparador
// hub.trabajo_espejo_agenda (como en la app). Prefijo de ids: ca-.
import { API } from '../../core/api';
import { equipo } from '../../core/equipo';
import { usuario } from '../../core/estado';
import { registrarAcciones } from '../../core/dispatcher';
import { resolver } from '../../core/router';
import { esDelHub, avisoSoloLectura } from '../../core/areas';
import { esc, toast } from '../../ui/dom';
import { ico } from '../../shell/linea';
import { nombresClientes } from '../ventas/datos';
import { pintarCita } from './cita';
import { llamarFuncion } from '../../core/funciones';
import {
  type Ev, type Coords, type Pendiente, type Hueco, dia, horaDe, durMin, durCorta, horaTexto,
  solapes, trasladosDelDia, cargaDia, buscarHueco, mismaPersona, deTecnico,
} from './motor';

type Vista = 'semana' | 'dia' | 'tecnicos' | 'agenda' | 'mes';
interface Bloque { id: string; trabajo_id: string | null; tarea_id: string | null; ticket_id: string | null; titulo: string | null; inicio: string; fin: string; tecnicos: string[] | null; estado: string | null; todo_el_dia: boolean | null }
interface Trab { id: string; numero: number; titulo: string | null; cliente_id: string | null; local_id: string | null; estado: string; fecha_programada: string | null; duracion_teorica: number | null; tecnicos: string[] | null; prioridad: string | null }
interface Guardado { nombre: string; filtro: string; vista: Vista; traslados: boolean }

const DIA_MS = 86400000, H0 = 7, H1 = 21, PX = 48;   // rejilla del Día: 7:00–21:00, 48 px por hora
const VISTAS: Record<Vista, string> = { semana: 'Semana', dia: 'Día', tecnicos: 'Por técnico', agenda: 'Agenda', mes: 'Mes' };
const leer = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const guardar = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };
const lunes = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const alDia = (s: string) => new Date(`${s}T00:00:00`);
const hhmm = (d: Date) => d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
const COLORES = ['#007a3f', '#8a5a12', '#01bf61', '#526257', '#a83232', '#172c22', '#7dd956'];
const color = (n: string) => COLORES[Math.abs([...n].reduce((a, c) => a + c.charCodeAt(0), 0)) % COLORES.length];
const claveGuardados = () => `hub_ca_filtros_${usuario()?.id ?? ''}`;
// Vista de arranque: la guardada; si no hay, Agenda en el móvil (como la app).
const vistaInicial = (): Vista => (leer('hub_ca_vista', '') as Vista) || (window.matchMedia('(max-width: 767px)').matches ? 'agenda' : 'semana');

// Estado de la pantalla (lo que hace falta entre un repintado y las acciones)
let _evs: Ev[] = [];
let _pend: (Trab & { cliente: string; sede: string | null })[] = [];
let _coords = new Map<string, Coords | null>();
let _equipo: string[] = [];
let _hueco: Hueco | null = null;
let _escribe = false;
let _arrastra: string | null = null;     // id de bloque o «pend-<trabajo>»
let _ses: any[] = [];
// Capa de Google Calendar (paridad bloque 7, tanda 5): SOLO LECTURA, por la
// función `google` (el calendario de la empresa y el tuyo si tienes correo de
// la empresa). Nunca se escribe nada en Google.
interface GEv { id: string; calendario: string; titulo: string; ubicacion: string; inicio: string; fin: string; todoDia: boolean; enlace: string }
let _google: GEv[] = [];
let _googleMsg = '';
// Los de todo el día acaban el día DESPUÉS (Google da el fin exclusivo).
const gDia = (ds: string) => _google.filter(g => { const i = g.inicio.slice(0, 10), f = g.fin.slice(0, 10); return i <= ds && (g.todoDia ? ds < f : ds <= f); });
const gHora = (g: GEv) => g.todoDia ? 'Todo el día' : `${hhmm(new Date(g.inicio))}–${hhmm(new Date(g.fin))}`;
const gTarjeta = (g: GEv) => `<a class="ca-google" href="${esc(g.enlace)}" target="_blank" rel="noopener" title="Google Calendar (${esc(g.calendario)}) · solo lectura">
  <span class="chip">Google</span> <strong>${esc(gHora(g))}</strong> ${esc(g.titulo)}${g.ubicacion ? `<small class="nota">${esc(g.ubicacion)}</small>` : ''}</a>`;
async function cargarGoogle(desde: Date, hasta: Date) {
  _google = []; _googleMsg = '';
  const r = await llamarFuncion<{ eventos: GEv[]; error?: string; mensaje?: string }>('google', { accion: 'calendario', desde: desde.toISOString(), hasta: hasta.toISOString() }, 25000);
  if (r.error) { _googleMsg = 'Google Calendar no contestó.'; return; }
  _google = Array.isArray(r.data?.eventos) ? r.data!.eventos : [];
  if (r.data?.mensaje) _googleMsg = r.data.mensaje;
}

function rango(v: Vista, f: Date): [Date, Date] {
  if (v === 'dia') return [new Date(f), new Date(f.getTime() + DIA_MS)];
  if (v === 'agenda') return [new Date(f), new Date(f.getTime() + 7 * DIA_MS)];
  if (v === 'mes') { const p = lunes(new Date(f.getFullYear(), f.getMonth(), 1)); return [p, new Date(p.getTime() + 42 * DIA_MS)]; }
  const l = lunes(f); return [l, new Date(l.getTime() + 7 * DIA_MS)];
}

function pasaFiltro(e: Ev, filtro: string): boolean {
  if (filtro === 'todo') return true;
  if (filtro === 'sin') return !e.tecnicos.length;
  if (filtro === 'mios') return deTecnico(e, usuario()?.nombre ?? '');
  return deTecnico(e, filtro);
}

async function cargar(v: Vista, f: Date) {
  const [desde, hasta] = rango(v, f);
  // Para «Sugerir hueco» hacen falta también las dos semanas que vienen.
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const ini = new Date(Math.min(desde.getTime(), hoy.getTime())), fin = new Date(Math.max(hasta.getTime(), hoy.getTime() + 15 * DIA_MS));
  const [ag, ses, pend, personas, escribe] = await Promise.all([
    API.fetchAll<Bloque>('agenda', { select: 'id,trabajo_id,tarea_id,ticket_id,titulo,inicio,fin,tecnicos,estado,todo_el_dia', and: `(inicio.lt.${fin.toISOString()},fin.gt.${ini.toISOString()})`, order: 'inicio' }),
    API.get<any[]>('sesiones', { select: 'id,entidad_tipo,entidad_id,inicio,fin,tecnico_nombre', and: `(inicio.gte.${desde.toISOString()},inicio.lt.${hasta.toISOString()})`, order: 'inicio' }),
    API.get<Trab[]>('trabajos', { select: 'id,numero,titulo,cliente_id,local_id,estado,fecha_programada,duracion_teorica,tecnicos,prioridad', estado: 'in.(Pendiente,"En progreso")', order: 'numero.desc', limit: '400' }),
    equipo(), esDelHub('agenda', 'trabajos')]);
  _escribe = escribe;
  _equipo = personas.map(p => p.nombre);
  _ses = ses.data ?? [];
  const bloques = ag.data ?? [];
  const ids = (k: keyof Bloque) => [...new Set(bloques.map(b => b[k] as string | null).filter(Boolean))] as string[];
  const [trab, tar, tks] = await Promise.all([
    ids('trabajo_id').length ? API.get<Trab[]>('trabajos', { select: 'id,numero,titulo,cliente_id,local_id,estado,fecha_programada,duracion_teorica,tecnicos,prioridad', id: `in.(${ids('trabajo_id').join(',')})` }) : Promise.resolve({ data: [] as Trab[] }),
    ids('tarea_id').length ? API.get<any[]>('tareas', { select: 'id,numero,titulo,cliente_id,local_id,estado', id: `in.(${ids('tarea_id').join(',')})` }) : Promise.resolve({ data: [] as any[] }),
    ids('ticket_id').length ? API.get<any[]>('tickets', { select: 'id,numero,titulo,cliente_id,local_id,estado', id: `in.(${ids('ticket_id').join(',')})` }) : Promise.resolve({ data: [] as any[] }),
  ]);
  const porId = new Map<string, any>([...(trab.data ?? []), ...(tar.data ?? []), ...(tks.data ?? [])].map(x => [x.id, x]));
  const pendientes = pend.data ?? [];
  const locIds = [...new Set([...porId.values(), ...pendientes].map(x => x.local_id).filter(Boolean))] as string[];
  const [locs, nombres] = await Promise.all([
    locIds.length ? API.get<any[]>('locales', { select: 'id,nombre,lat,lng', id: `in.(${locIds.join(',')})` }) : Promise.resolve({ data: [] as any[] }),
    nombresClientes([...porId.values(), ...pendientes].map(x => x.cliente_id)),
  ]);
  const sedes = new Map<string, string>();
  _coords = new Map();
  for (const l of locs.data ?? []) {
    sedes.set(l.id, l.nombre);
    _coords.set(l.id, l.lat != null && l.lng != null ? { lat: Number(l.lat), lng: Number(l.lng) } : null);
  }
  _evs = bloques.map(b => {
    const o = porId.get(b.trabajo_id ?? b.tarea_id ?? b.ticket_id ?? '') ?? null;
    return {
      id: b.id, key: b.id, trabajoId: b.trabajo_id, tareaId: b.tarea_id, ticketId: b.ticket_id, numero: o?.numero ?? null,
      titulo: o?.titulo ?? b.titulo ?? (b.tarea_id ? 'Tarea' : b.ticket_id ? 'Ticket' : 'Cita'),
      cliente: o?.cliente_id ? nombres.get(o.cliente_id) ?? null : null, sede: o?.local_id ? sedes.get(o.local_id) ?? null : null, localId: o?.local_id ?? null,
      inicio: new Date(b.inicio), fin: new Date(b.fin), tecnicos: b.tecnicos?.length ? b.tecnicos : (o?.tecnicos ?? []), estado: o?.estado ?? b.estado, todoDia: !!b.todo_el_dia,
    };
  });
  const conBloque = new Set(bloques.map(b => b.trabajo_id).filter(Boolean));
  const todos = leer('hub_ca_pend_todos', '') === '1';
  _pend = pendientes.filter(t => todos || (!t.fecha_programada && !conBloque.has(t.id)))
    .map(t => ({ ...t, cliente: nombres.get(t.cliente_id ?? '') ?? '', sede: t.local_id ? sedes.get(t.local_id) ?? null : null }));
}

// Bloques que se pisan en una misma columna van lado a lado (carril i de n).
function carriles(evs: Ev[]): Map<string, { i: number; n: number }> {
  const out = new Map<string, { i: number; n: number }>();
  const orden = [...evs].sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
  let grupo: Ev[] = [], finGrupo = 0, fines: number[] = [];
  const cerrar = () => { const n = fines.length; for (const e of grupo) out.set(e.key, { i: out.get(e.key)!.i, n }); grupo = []; fines = []; };
  for (const e of orden) {
    if (grupo.length && e.inicio.getTime() >= finGrupo) cerrar();
    let i = fines.findIndex(f => f <= e.inicio.getTime());
    if (i < 0) { i = fines.length; fines.push(0); }
    fines[i] = e.fin.getTime();
    out.set(e.key, { i, n: 1 });
    grupo.push(e);
    finGrupo = Math.max(finGrupo, e.fin.getTime());
  }
  cerrar();
  return out;
}

const enlace = (e: Ev) => (e.trabajoId && e.numero ? `#/trabajos/${e.numero}` : e.ticketId && e.numero ? `#/tickets/${e.numero}` : e.tareaId ? `#/tareas/${e.tareaId}` : `#/calendario/cita/${e.id}`);
function tarjeta(e: Ev, solapa: Set<string>, tras: Map<string, string>, comoRejilla = false, carril?: { i: number; n: number }): string {
  const arrastra = _escribe ? `draggable="true" data-on-dragstart="caArrastrar:${e.id}"` : '';
  const c = carril ?? { i: 0, n: 1 };
  const pos = comoRejilla ? ` style="top:${(Math.max(H0, horaDe(e.inicio)) - H0) * PX}px;height:${Math.max(22, durMin(e) / 60 * PX)}px;left:calc(${(c.i / c.n) * 100}% + 3px);width:calc(${100 / c.n}% - 6px);border-left-color:${color(e.tecnicos[0] ?? '')}"` : ` style="border-left-color:${color(e.tecnicos[0] ?? '')}"`;
  const href = enlace(e);
  return `<article class="ca-bloque${solapa.has(e.key) ? ' ca-solapa' : ''}${comoRejilla ? ' en-rejilla' : ''}" id="ca-b-${e.id}" data-id="${e.id}" ${arrastra}${pos}>
    ${comoRejilla ? '' : tras.get(e.key) ?? ''}
    <strong>${e.todoDia ? 'Todo el día' : `${hhmm(e.inicio)}–${hhmm(e.fin)}`}</strong> ${href ? `<a href="${href}">${esc(`${e.numero ? `#${e.numero} ` : ''}${e.titulo}`)}</a>` : esc(e.titulo)}
    ${e.cliente || e.sede ? `<small class="nota">${esc([e.cliente, e.sede].filter(Boolean).join(' · '))}</small>` : ''}
    <small class="nota">${esc(e.tecnicos.join(', ') || 'Sin técnico')}${e.estado ? ` · ${esc(e.estado)}` : ''}</small>
    ${solapa.has(e.key) ? `<small class="g-mal">${ico('atencion')} Se pisa con otro bloque del mismo técnico</small>` : ''}</article>`;
}

function cargaHtml(evs: Ev[], ds: string, equipo: string[]): string {
  if (!equipo.length) return '';
  const c = cargaDia(evs, ds, equipo);
  const pct = Math.min(100, Math.round(c.total / c.capacidad * 100));
  const tono = c.total > c.capacidad ? 'mal' : pct >= 75 ? 'aviso' : 'bien';
  return `<div class="ca-carga ${tono}" title="${esc(`${durCorta(c.total)} planificadas de ${durCorta(c.capacidad)} (${equipo.length} × 8 h)${c.libres.length ? `\nLibres: ${c.libres.join(', ')}` : ''}`)}">
    <span class="ca-carga-barra"><span style="width:${pct}%"></span></span>
    <small>${durCorta(c.total)} de ${durCorta(c.capacidad)} · ${c.libres.length ? `${c.libres.length} libre${c.libres.length === 1 ? '' : 's'}` : 'todos ocupados'}</small></div>`;
}

const real = (s: any) => `<div class="ca-real" title="Fichado">${ico('cronometro')} ${hhmm(new Date(s.inicio))}–${s.fin ? hhmm(new Date(s.fin)) : 'en curso'} · ${esc(s.tecnico_nombre ?? '')}</div>`;

function vistaSemana(evs: Ev[], desde: Date, solapa: Set<string>, tras: Map<string, string>, equipo: string[], filtro: string): string {
  const hoy = dia(new Date());
  return `<div class="ca-semana">${Array.from({ length: 7 }, (_, i) => new Date(desde.getTime() + i * DIA_MS)).map(d => {
    const ds = dia(d);
    return `<section class="tarjeta ca-dia ${ds === hoy ? 'ca-hoy' : ''}" data-dia="${ds}" ${_escribe ? `data-on-dragover="caSobre:$this" data-prevent="1" data-on-dragleave="caFuera:$this" data-on-drop="caSoltarDia:${ds}"` : ''}>
      <h3><button class="ca-ir-dia" data-action="caIrDia" data-p0="${ds}">${esc(d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' }))}</button></h3>
      ${cargaHtml(evs, ds, equipo)}
      ${evs.filter(e => dia(e.inicio) === ds).sort((a, b) => a.inicio.getTime() - b.inicio.getTime()).map(e => tarjeta(e, solapa, tras)).join('') || (gDia(ds).length ? '' : '<p class="vacio col-vacia">—</p>')}
      ${gDia(ds).map(gTarjeta).join('')}
      ${_ses.filter(s => dia(new Date(s.inicio)) === ds && (filtro === 'todo' || (filtro === 'mios' ? mismaPersona(s.tecnico_nombre ?? '', usuario()?.nombre ?? '') : mismaPersona(s.tecnico_nombre ?? '', filtro)))).map(real).join('')}</section>`;
  }).join('')}</div>`;
}

function vistaDia(evs: Ev[], f: Date, solapa: Set<string>, tras: Map<string, string>, equipo: string[], conTraslados: boolean): string {
  const ds = dia(f);
  const cols = [...equipo.map(n => ({ nombre: n, sin: false })), { nombre: '', sin: true }];
  const horas = Array.from({ length: H1 - H0 }, (_, i) => H0 + i);
  const hueco = _hueco && _hueco.fecha === ds ? _hueco : null;
  return `${gDia(ds).length ? `<div class="ca-google-dia">${gDia(ds).map(gTarjeta).join('')}</div>` : ''}<div class="tarjeta ca-rejilla-caja mo-scroll">${cargaHtml(evs, ds, equipo)}
    <div class="ca-rejilla" style="--cols:${cols.length}">
      <div class="ca-horas"><div class="ca-col-cab"></div>${horas.map(h => `<div class="ca-hora" style="height:${PX}px">${String(h).padStart(2, '0')}:00</div>`).join('')}</div>
      ${cols.map(c => {
        const mios = evs.filter(e => dia(e.inicio) === ds && !e.todoDia && (c.sin ? !e.tecnicos.length : deTecnico(e, c.nombre)));
        const min = mios.reduce((a, e) => a + durMin(e), 0);
        const lanes = carriles(mios);
        // El trayecto se pinta ANTES de cada bloque (como en la app), en rojo si no llega.
        const bandas = conTraslados && !c.sin ? trasladosDelDia(mios, ds, [c.nombre], _coords).map(t => {
          const fin = horaDe(t.ev.inicio), ini = Math.max(H0, fin - t.min / 60);
          return `<div class="ca-tras-banda${t.tarde ? ' tarde' : ''}" style="top:${(ini - H0) * PX}px;height:${Math.max(4, (fin - ini) * PX)}px" title="${esc(`${t.min} min desde ${t.desde}${t.km != null ? ` · ${t.km.toFixed(1)} km` : ' · sede sin coordenadas'}${t.tarde ? ` · llega ${t.tarde} min tarde` : ''}`)}">${ico('coche')} ${t.min}′${t.tarde ? ` · +${t.tarde}′` : ''}</div>`;
        }).join('') : '';
        return `<div class="ca-col">
          <div class="ca-col-cab"><strong>${esc(c.sin ? 'Sin asignar' : c.nombre)}</strong>${c.sin ? '' : `<small class="nota">${durCorta(min)}</small>`}</div>
          <div class="ca-col-cuerpo" style="height:${(H1 - H0) * PX}px" data-tecnico="${esc(c.nombre)}"
            ${_escribe ? `data-on-dragover="caSobre:$this" data-prevent="1" data-on-dragleave="caFuera:$this" data-on-drop="caSoltarCol:${esc(c.sin ? '__sin' : c.nombre)},$this,$event"` : ''}>
            ${horas.map(() => `<div class="ca-franja" style="height:${PX}px"></div>`).join('')}
            ${bandas}${mios.map(e => tarjeta(e, solapa, tras, true, lanes.get(e.key))).join('')}
            ${_ses.filter(s => !c.sin && dia(new Date(s.inicio)) === ds && mismaPersona(s.tecnico_nombre ?? '', c.nombre)).map(s => {
              const i = new Date(s.inicio), fi = s.fin ? new Date(s.fin) : new Date();
              return `<div class="ca-real en-rejilla" style="top:${(Math.max(H0, horaDe(i)) - H0) * PX}px;height:${Math.max(16, (fi.getTime() - i.getTime()) / 3600000 * PX)}px" title="Fichado">${ico('cronometro')} ${hhmm(i)}–${s.fin ? hhmm(fi) : 'en curso'}</div>`;
            }).join('')}
            ${hueco && (c.sin ? !hueco.tecnico : mismaPersona(hueco.tecnico, c.nombre)) ? `<div class="ca-hueco" style="top:${(hueco.hora - H0) * PX}px;height:${hueco.dur / 60 * PX}px">Hueco para #${hueco.numero}</div>` : ''}
          </div></div>`;
      }).join('')}
    </div></div>`;
}

function vistaTecnicos(evs: Ev[], desde: Date, solapa: Set<string>, tras: Map<string, string>, equipo: string[]): string {
  const dias = Array.from({ length: 7 }, (_, i) => new Date(desde.getTime() + i * DIA_MS));
  const hoy = dia(new Date());
  return `<div class="tarjeta mo-scroll"><table class="tabla ca-tabla"><thead><tr><th>Técnico</th>${dias.map(d => `<th class="${dia(d) === hoy ? 'ca-hoy' : ''}"><button class="ca-ir-dia" data-action="caIrDia" data-p0="${dia(d)}">${esc(d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' }))}</button></th>`).join('')}</tr></thead><tbody>
    ${[...equipo, ''].map(p => `<tr><th>${esc(p || 'Sin asignar')}</th>${dias.map(d => `<td>${evs.filter(e => dia(e.inicio) === dia(d) && (p ? deTecnico(e, p) : !e.tecnicos.length)).map(e => tarjeta(e, solapa, tras)).join('')}</td>`).join('')}</tr>`).join('')}
  </tbody></table></div>`;
}

function vistaAgenda(evs: Ev[], f: Date, equipo: string[]): string {
  const dias = Array.from({ length: 7 }, (_, i) => new Date(f.getTime() + i * DIA_MS));
  const tras = new Map<string, string>();
  return dias.map(d => {
    const ds = dia(d);
    const del = evs.filter(e => dia(e.inicio) === ds).sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
    for (const t of trasladosDelDia(del, ds, equipo, _coords)) tras.set(t.ev.key, `${t.min} min desde ${t.desde}${t.tarde ? ` · llega ${t.tarde} min tarde` : ''}`);
    return `<section class="tarjeta ca-agenda-dia"><h3>${esc(d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }))}</h3>${cargaHtml(evs, ds, equipo)}
      ${del.length ? `<ul class="ca-agenda">${del.map(e => {
        const c = e.localId ? _coords.get(e.localId) : null;
        const href = enlace(e);
        return `<li id="ca-b-${e.id}"><span class="ca-ag-hora">${e.todoDia ? 'Todo el día' : `${hhmm(e.inicio)}–${hhmm(e.fin)}`}</span>
          <span class="ca-ag-txt"><strong>${href ? `<a href="${href}">${esc(`${e.numero ? `#${e.numero} ` : ''}${e.titulo}`)}</a>` : esc(e.titulo)}</strong>
            <small class="nota">${esc([e.cliente, e.sede, e.tecnicos.join(', ') || 'Sin técnico', e.estado].filter(Boolean).join(' · '))}</small>
            ${tras.get(e.key) ? `<small class="${tras.get(e.key)!.includes('tarde') ? 'g-mal' : 'nota'}">${ico('coche')} ${esc(tras.get(e.key)!)}</small>` : ''}</span>
          ${c ? `<a class="btn secundario" href="https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}" target="_blank" rel="noopener">${ico('mapa')} Cómo llegar</a>` : ''}</li>`;
      }).join('')}</ul>` : gDia(ds).length ? '' : '<p class="vacio">Nada planificado.</p>'}${gDia(ds).length ? `<div class="ca-google-dia">${gDia(ds).map(gTarjeta).join('')}</div>` : ''}</section>`;
  }).join('');
}

function vistaMes(evs: Ev[], f: Date): string {
  const [desde] = rango('mes', f);
  const hoy = dia(new Date());
  return `<div class="ca-mes">${['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(d => `<div class="ca-mes-cab">${d}</div>`).join('')}
    ${Array.from({ length: 42 }, (_, i) => new Date(desde.getTime() + i * DIA_MS)).map(d => {
      const ds = dia(d), del = evs.filter(e => dia(e.inicio) === ds);
      return `<button class="ca-mes-dia${d.getMonth() !== f.getMonth() ? ' fuera' : ''}${ds === hoy ? ' ca-hoy' : ''}" data-action="caIrDia" data-p0="${ds}">
        <span class="ca-mes-num">${d.getDate()}</span>
        ${del.slice(0, 3).map(e => `<span class="ca-mes-ev" style="border-left-color:${color(e.tecnicos[0] ?? '')}">${e.todoDia ? '' : hhmm(e.inicio)} ${esc(e.titulo)}</span>`).join('')}
        ${del.length > 3 ? `<span class="nota">+${del.length - 3} más</span>` : ''}
        ${gDia(ds).slice(0, 2).map(g => `<span class="ca-mes-ev ca-mes-google">${g.todoDia ? '' : hhmm(new Date(g.inicio))} ${esc(g.titulo)}</span>`).join('')}</button>`;
    }).join('')}</div>`;
}

function panelPendientes(): string {
  const q = leer('hub_ca_pend_q', '').toLowerCase();
  const lista = _pend.filter(t => !q || `${t.numero} ${t.titulo ?? ''} ${t.cliente} ${t.sede ?? ''}`.toLowerCase().includes(q));
  const urg = lista.filter(t => ['urgente', 'alta'].includes((t.prioridad ?? '').toLowerCase()));
  const resto = lista.filter(t => !urg.includes(t));
  const grupos: [string, typeof lista][] = [['Urgente', urg], ['Con fecha', resto.filter(t => t.fecha_programada)], ['Sin fecha', resto.filter(t => !t.fecha_programada)]];
  const item = (t: (typeof lista)[number]) => `<li class="ca-pend" ${_escribe ? `draggable="true" data-on-dragstart="caArrastrar:pend-${t.id}"` : ''}>
    <a href="#/trabajos/${t.numero}"><strong>#${t.numero} ${esc(t.titulo ?? '')}</strong></a>
    <small class="nota">${esc([t.cliente, t.sede].filter(Boolean).join(' · ') || 'Sin cliente')} · ${durCorta(t.duracion_teorica || 60)}${t.tecnicos?.length ? ` · ${esc(t.tecnicos.join(', '))}` : ''}</small>
    <button class="btn secundario" data-action="caSugerir" data-p0="${t.id}">Sugerir hueco</button></li>`;
  return `<aside class="tarjeta ca-pendientes" aria-label="Pendientes de planificar">
    <div class="tarjeta-cab"><h3>Pendientes · ${lista.length}</h3>
      <label class="check"><input type="checkbox" ${leer('hub_ca_pend_todos', '') === '1' ? 'checked' : ''} data-on-change="caPendTodos:$checked"> También los planificados</label></div>
    <input type="search" id="ca-pend-q" placeholder="Buscar pendiente…" value="${esc(leer('hub_ca_pend_q', ''))}" data-on-input="caPendBuscar:$value" aria-label="Buscar pendiente">
    ${grupos.filter(([, l]) => l.length).map(([g, l]) => `<h4>${g} · ${l.length}</h4><ul class="ca-pend-lista">${l.map(item).join('')}</ul>`).join('') || '<p class="vacio">Nada pendiente de planificar.</p>'}
    ${_escribe ? '<p class="nota">Arrastra un pendiente a un día (o a una hora en la vista Día) para planificarlo.</p>' : ''}</aside>`;
}

function bannerHueco(): string {
  if (!_hueco) return '';
  const h = _hueco, d = alDia(h.fecha);
  return `<div class="tarjeta ca-hueco-banner" role="status">
    <strong>Hueco para #${h.numero} ${esc(h.titulo)}:</strong> ${esc(d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }))},
    ${horaTexto(h.hora)}–${horaTexto(h.hora + h.dur / 60)} · ${esc(h.tecnico || 'sin técnico')}
    ${h.viene ? `<small class="nota">Viene de ${esc(h.viene.desde)}: ${h.viene.min} min${h.viene.estimado ? ' (sede sin coordenadas: estimado)' : ''}</small>` : ''}
    <div class="acciones">${_escribe ? '<button class="btn" data-action="caPlanificar">Planificar aquí</button>' : '<span class="nota">Se planifica en la app hasta el cambio.</span>'}
      <button class="btn secundario" data-action="caOtroHueco">Otro hueco</button><button class="btn secundario" data-action="caCerrarHueco">Cerrar</button></div></div>`;
}

export async function pintar(el: HTMLElement, params: string[] = []) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  if (params[0] === 'cita' || params[0] === 'dia') { await pintarCita(el, params); return; }
  const vista = vistaInicial();
  const f = alDia(leer('hub_ca_fecha', dia(new Date())));
  const filtro = leer('hub_ca_filtro', 'todo');
  const conTraslados = leer('hub_ca_traslados', '1') === '1';
  const conPend = leer('hub_ca_pend', '1') === '1';
  const conGoogle = leer('hub_ca_google', '1') === '1';
  const [gDesde, gHasta] = rango(vista, f);
  await Promise.all([cargar(vista, f), conGoogle ? cargarGoogle(gDesde, gHasta) : Promise.resolve((_google = [], _googleMsg = ''))]);
  if (!el.isConnected) return;
  const [desde, hasta] = rango(vista, f);
  const visibles = _evs.filter(e => pasaFiltro(e, filtro) && e.fin > desde && e.inicio < hasta);
  const equipoVista = filtro === 'todo' || filtro === 'sin' ? _equipo : filtro === 'mios' ? [usuario()?.nombre ?? ''] : [filtro];
  const sol = solapes(visibles, equipoVista);
  const tras = new Map<string, string>();
  if (conTraslados) {
    for (const ds of [...new Set(visibles.map(e => dia(e.inicio)))]) {
      for (const t of trasladosDelDia(visibles, ds, equipoVista, _coords)) {
        const texto = `${t.min} min desde ${t.desde}${t.km != null ? ` · ${t.km < 10 ? t.km.toFixed(1) : Math.round(t.km)} km` : ' · sede sin coordenadas'}${t.tarde ? ` · llega ${t.tarde} min tarde` : ''}${equipoVista.length > 1 ? ` (${t.tecnico})` : ''}`;
        tras.set(t.ev.key, `${tras.get(t.ev.key) ?? ''}<small class="ca-tras${t.tarde ? ' g-mal' : ''}" title="${esc(texto)}">${ico('coche')} ${esc(texto)}</small>`);
      }
    }
  }
  const guardados: Guardado[] = (() => { try { return JSON.parse(leer(claveGuardados(), '[]')); } catch { return []; } })();
  const titulo = vista === 'dia' ? f.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
    : vista === 'mes' ? f.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
      : `${desde.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })} – ${new Date(hasta.getTime() - DIA_MS).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}`;
  const cuerpo = vista === 'dia' ? vistaDia(visibles, f, sol.claves, tras, filtro === 'sin' ? [] : equipoVista, conTraslados)
    : vista === 'tecnicos' ? vistaTecnicos(visibles, desde, sol.claves, tras, filtro === 'sin' ? [] : equipoVista)
      : vista === 'agenda' ? vistaAgenda(visibles, f, equipoVista)
        : vista === 'mes' ? vistaMes(visibles, f)
          : vistaSemana(visibles, desde, sol.claves, tras, equipoVista, filtro);
  el.innerHTML = `${_escribe ? '' : avisoSoloLectura('La agenda')}
    <div class="acciones pr-barra ca-barra">
      <button class="btn secundario" data-action="caMover" data-p0="-1" aria-label="Anterior">${ico('izquierda')}</button>
      <strong class="ca-titulo">${esc(titulo)}</strong>
      <button class="btn secundario" data-action="caMover" data-p0="1" aria-label="Siguiente">${ico('derecha')}</button>
      <button class="btn secundario" data-action="caMover" data-p0="0">Hoy</button>
      ${_escribe ? `<a class="btn secundario" href="#/calendario/cita">${ico('mas')} Cita</a>` : ''}
      <input type="date" id="ca-ir" value="${dia(f)}" data-on-change="caIrDia:$value" aria-label="Ir a la fecha">
      ${sol.lista.length ? `<button class="chip mal" data-action="caVerSolape" data-p0="${sol.lista[0].a.id}">${ico('atencion')} ${sol.lista.length} solape${sol.lista.length === 1 ? '' : 's'}</button>` : ''}
    </div>
    <div class="acciones pr-barra ca-barra">
      <div class="segmentado" role="tablist" aria-label="Vista">${(Object.keys(VISTAS) as Vista[]).map(v => `<button role="tab" aria-selected="${v === vista}" class="${v === vista ? 'activo' : ''}" data-action="caVista" data-p0="${v}">${VISTAS[v]}</button>`).join('')}</div>
      <select id="ca-filtro" data-on-change="caFiltro:$value" aria-label="Qué se ve">
        <option value="todo" ${filtro === 'todo' ? 'selected' : ''}>Todo</option><option value="mios" ${filtro === 'mios' ? 'selected' : ''}>Mis trabajos</option>
        <option value="sin" ${filtro === 'sin' ? 'selected' : ''}>Sin técnico</option>
        <optgroup label="Técnico">${_equipo.map(n => `<option ${filtro === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</optgroup></select>
      <select id="ca-guardados" data-on-change="caAplicarGuardado:$value" aria-label="Filtros guardados"><option value="">Filtros guardados…</option>${guardados.map((g, i) => `<option value="${i}">${esc(g.nombre)}</option>`).join('')}</select>
      <button class="btn secundario" data-action="caGuardarFiltro">Guardar filtro</button>
      <span class="acciones ca-capas"><label class="check"><input type="checkbox" ${conTraslados ? 'checked' : ''} data-on-change="caTraslados:$checked"> Traslados</label>
      <label class="check"><input type="checkbox" ${conPend ? 'checked' : ''} data-on-change="caPendPanel:$checked"> Pendientes</label>
      <label class="check" title="Los eventos de Google Calendar, solo para ver"><input type="checkbox" id="ca-google" ${conGoogle ? 'checked' : ''} data-on-change="caGoogle:$checked"> Google</label></span>
    </div>
    ${conGoogle && _googleMsg ? `<p class="nota ca-google-nota">${ico('info')} ${esc(_googleMsg)}</p>` : ''}
    ${bannerHueco()}
    <div class="ca-cuerpo${conPend && vista !== 'mes' ? ' con-panel' : ''}"><div class="ca-principal">${cuerpo}</div>${conPend && vista !== 'mes' ? panelPendientes() : ''}</div>
    <p class="nota">${ico('cronometro')} = lo fichado de verdad. ${_escribe ? 'Arrastra un bloque para moverlo; en la vista Día, a otra columna para cambiar de técnico.' : ''}</p>`;
}

// ── Escrituras (solo con el corte) ─────────────────────────────────────────
async function planificar(trabajoId: string, fecha: string, hora: number, tecnico: string | null) {
  const t = _pend.find(x => x.id === trabajoId);
  const ini = new Date(`${fecha}T${horaTexto(hora)}:00`);
  const cuerpo: Record<string, unknown> = { fecha_programada: fecha, hora_llegada: ini.toISOString() };
  if (t && !t.duracion_teorica) cuerpo.duracion_teorica = 60;
  if (tecnico && !(t?.tecnicos ?? []).some(x => mismaPersona(x, tecnico))) cuerpo.tecnicos = [tecnico];
  const r = await API.patch('trabajos', { id: `eq.${trabajoId}` }, cuerpo);
  if (r.error) { toast(r.error.message, 'error'); return; }
  toast(`#${t?.numero ?? ''} planificado: ${fecha} a las ${horaTexto(hora)}${tecnico ? ` · ${tecnico}` : ''}`);
  _hueco = null;
  guardar('hub_ca_fecha', fecha);
  resolver();
}

async function moverBloque(id: string, inicio: Date, tecnicos: string[] | null) {
  const e = _evs.find(x => x.id === id);
  if (!e) return;
  const fin = new Date(inicio.getTime() + (e.fin.getTime() - e.inicio.getTime()));
  const r = await API.rpc('agenda_mover', { p_id: id, p_inicio: inicio.toISOString(), p_fin: fin.toISOString(), ...(tecnicos ? { p_tecnicos: tecnicos } : {}) });
  if (r.error) { toast(r.error.message, 'error'); return; }
  toast(tecnicos ? `Movido a ${tecnicos.join(', ') || 'sin técnico'}` : 'Movido');
  resolver();
}

function pendienteComo(t: (typeof _pend)[number]): Pendiente {
  return { id: t.id, numero: t.numero, titulo: t.titulo ?? 'Trabajo', duracion: t.duracion_teorica, tecnico: t.tecnicos?.[0] ?? '', localId: t.local_id };
}
function sugerir(id: string, saltar = 0) {
  const t = _pend.find(x => x.id === id);
  if (!t) return;
  const h = buscarHueco(pendienteComo(t), _evs, _equipo, _coords, { saltar, traslados: leer('hub_ca_traslados', '1') === '1' });
  if (!h) { toast('No queda hueco libre en las dos próximas semanas', 'error'); return; }
  _hueco = h;
  guardar('hub_ca_fecha', h.fecha);
  const v = vistaInicial();
  if (v !== 'dia' && v !== 'agenda') guardar('hub_ca_vista', 'dia');
  resolver();
}

registrarAcciones({
  caMover(d: string) {
    const v = vistaInicial(), f = alDia(leer('hub_ca_fecha', dia(new Date())));
    if (d === '0') guardar('hub_ca_fecha', dia(new Date()));
    else if (v === 'mes') guardar('hub_ca_fecha', dia(new Date(f.getFullYear(), f.getMonth() + Number(d), 1)));
    else guardar('hub_ca_fecha', dia(new Date(f.getTime() + Number(d) * (v === 'dia' ? 1 : 7) * DIA_MS)));
    resolver();
  },
  caIrDia(ds: string) { if (!ds) return; guardar('hub_ca_fecha', ds); guardar('hub_ca_vista', 'dia'); resolver(); },
  caVista(v: Vista) { guardar('hub_ca_vista', v); resolver(); },
  caFiltro(v: string) { guardar('hub_ca_filtro', v); resolver(); },
  caTraslados(v: boolean) { guardar('hub_ca_traslados', v ? '1' : '0'); resolver(); },
  caGoogle(v: boolean) { guardar('hub_ca_google', v ? '1' : '0'); resolver(); },
  caPendPanel(v: boolean) { guardar('hub_ca_pend', v ? '1' : '0'); resolver(); },
  caPendTodos(v: boolean) { guardar('hub_ca_pend_todos', v ? '1' : ''); resolver(); },
  caPendBuscar(q: string) {
    guardar('hub_ca_pend_q', q);
    const panel = document.querySelector('.ca-pendientes');
    if (!panel) return;
    const campo = document.getElementById('ca-pend-q') as HTMLInputElement | null, pos = campo?.selectionStart ?? null;
    panel.outerHTML = panelPendientes();
    const nuevo = document.getElementById('ca-pend-q') as HTMLInputElement | null;
    if (nuevo) { nuevo.focus(); if (pos != null) nuevo.setSelectionRange(pos, pos); }
  },
  caGuardarFiltro() {
    const nombre = prompt('¿Cómo se llama este filtro?')?.trim();
    if (!nombre) return;
    const lista: Guardado[] = (() => { try { return JSON.parse(leer(claveGuardados(), '[]')); } catch { return []; } })();
    lista.push({ nombre, filtro: leer('hub_ca_filtro', 'todo'), vista: vistaInicial(), traslados: leer('hub_ca_traslados', '1') === '1' });
    guardar(claveGuardados(), JSON.stringify(lista));
    toast(`Filtro «${nombre}» guardado`);
    resolver();
  },
  caAplicarGuardado(i: string) {
    const lista: Guardado[] = (() => { try { return JSON.parse(leer(claveGuardados(), '[]')); } catch { return []; } })();
    const g = lista[Number(i)];
    if (!g) return;
    guardar('hub_ca_filtro', g.filtro); guardar('hub_ca_vista', g.vista); guardar('hub_ca_traslados', g.traslados ? '1' : '0');
    resolver();
  },
  caVerSolape(id: string) { document.getElementById(`ca-b-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); },
  caSugerir: (id: string) => sugerir(id),
  caOtroHueco() { if (_hueco) sugerir(_hueco.trabajoId, _hueco.n + 1); },
  caCerrarHueco() { _hueco = null; resolver(); },
  async caPlanificar() { if (_hueco) await planificar(_hueco.trabajoId, _hueco.fecha, _hueco.hora, _hueco.tecnico || null); },
  caArrastrar(id: string) { _arrastra = id; },
  caSobre(el: HTMLElement) { el.classList.add('sobre'); },
  caFuera(el: HTMLElement) { el.classList.remove('sobre'); },
  // Soltar en un día de la Semana: el bloque conserva sus horas; un pendiente
  // se planifica a las 9:00 con el técnico que ya tuviera.
  async caSoltarDia(ds: string) {
    document.querySelectorAll('.sobre').forEach(x => x.classList.remove('sobre'));
    const id = _arrastra; _arrastra = null;
    if (!id) return;
    if (id.startsWith('pend-')) { const t = _pend.find(x => x.id === id.slice(5)); await planificar(id.slice(5), ds, 9, t?.tecnicos?.[0] ?? null); return; }
    const e = _evs.find(x => x.id === id);
    if (!e || dia(e.inicio) === ds) return;
    await moverBloque(id, new Date(`${ds}T${e.inicio.toTimeString().slice(0, 8)}`), null);
  },
  // Soltar en la rejilla del Día: a esa hora (de 15 en 15 min) y, si es otra
  // columna, con ese técnico. Un fichaje (capa real) no se arrastra.
  async caSoltarCol(col: string, el: HTMLElement, ev: DragEvent) {
    document.querySelectorAll('.sobre').forEach(x => x.classList.remove('sobre'));
    const id = _arrastra; _arrastra = null;
    if (!id) return;
    const r = el.getBoundingClientRect();
    const h = Math.min(H1 - 0.25, Math.max(H0, H0 + Math.round(((ev?.clientY ?? r.top) - r.top) / PX * 4) / 4));
    const ds = leer('hub_ca_fecha', dia(new Date()));
    const tecnico = col === '__sin' ? '' : col;
    if (id.startsWith('pend-')) { await planificar(id.slice(5), ds, h, tecnico || null); return; }
    const e = _evs.find(x => x.id === id);
    if (!e) return;
    const ini = new Date(`${ds}T${horaTexto(h)}:00`);
    const otraPersona = tecnico ? !deTecnico(e, tecnico) : e.tecnicos.length > 0;
    await moverBloque(id, ini, otraPersona ? (tecnico ? [tecnico] : []) : null);
  },
});
