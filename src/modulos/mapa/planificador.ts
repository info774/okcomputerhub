// Mapa → panel del planificador (paridad bloque 8, tanda 2: mapa.js de la
// app). Tres pestañas sobre el MISMO día elegido (‹ Hoy › lo mueven y las
// filas de la semana lo eligen):
//   · Día: técnicos fichados (sesión sin fin: el GPS del fichaje o, si no, al
//     lado de la sede donde ficharon), trabajos del día y tickets abiertos.
//   · Semana: planificador con arrastrar y soltar. Una fila por día con sus
//     bloques de agenda y la bandeja «Sin planificar» (trabajos Pendiente sin
//     fecha). Soltar un pendiente en un día lo planifica a las 9:00 (la fecha
//     va al trabajo y el bloque lo crea la base, como en el calendario);
//     soltar un bloque en otro día lo mueve (hub.agenda_mover, con sus horas)
//     y en la bandeja lo quita (el trabajo vuelve a «sin planificar» si era su
//     único día). «Asignar al soltar» añade además ese técnico. Escribir solo
//     con las áreas `trabajos` y `agenda` del hub; antes, se ve y no se arrastra.
//   · Ruta: las paradas del día de un técnico (o de todos) por hora o, con
//     «Optimizar», por vecino más cercano desde la oficina (la misma salida que
//     los traslados del calendario); línea numerada en el mapa, km en línea
//     recta y enlace a Google Maps con las paradas.
// Los trabajos de un día son los de `fecha_programada` MÁS los que tienen un
// bloque de agenda ese día (el día 2 de un trabajo largo solo está allí).
// Prefijo de ids: map-.
import type * as Leaflet from 'leaflet';
import { API } from '../../core/api';
import { equipo } from '../../core/equipo';
import { esDelHub, avisoSoloLectura } from '../../core/areas';
import { registrarAcciones } from '../../core/dispatcher';
import { ir } from '../../core/router';
import { esc, toast } from '../../ui/dom';
import { dejarBorrador } from '../../ui/borrador';
import { ico } from '../../shell/linea';
import { OFICINA, kmEntre, mismaPersona } from '../calendario/motor';

export interface SedeMapa { id: string; nombre: string; cliente_id: string | null; lat: number | string; lng: number | string; direccion: string | null }
interface Trabajo { id: string; numero: number | null; titulo: string | null; descripcion: string | null; estado: string; local_id: string | null; cliente_id: string | null;
  hora_llegada: string | null; tecnicos: string[] | null; duracion_teorica: number | null; bloque_id?: string }
interface Ticket { id: string; numero: number; titulo: string; prioridad: string | null; local_id: string | null; cliente_id: string | null }
interface Bloque { id: string; trabajo_id: string | null; tarea_id: string | null; ticket_id: string | null; tipo: string | null; titulo: string | null;
  inicio: string; fin: string; todo_el_dia: boolean | null; tecnicos: string[] | null }
interface Tecnico { nombre: string; enSitio: boolean; desde: string | null; localId: string | null; que: string; lat: number | null; lng: number | null }
type Panel = 'dia' | 'semana' | 'ruta';
type Ctx = { L: typeof Leaflet; mapa: Leaflet.Map; sedes: SedeMapa[]; clientes: Map<string, string>; centrar: (localId: string) => boolean; repintar: () => void };

const HORA_DEFECTO = 9;
const DIA_MS = 86_400_000;
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const hoy = () => new Date().toLocaleDateString('sv-SE');
const sumarDias = (ymd: string, n: number) => { const d = new Date(`${ymd}T12:00:00`); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };
const lunesDe = (ymd: string) => { const d = new Date(`${ymd}T12:00:00`); return sumarDias(ymd, -((d.getDay() + 6) % 7)); };
const inicioDia = (ymd: string) => new Date(`${ymd}T00:00:00`);
const fechaLarga = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '—:—');
const fmtKm = (k: number) => `${k < 10 ? k.toFixed(1).replace('.', ',') : Math.round(k)} km`;
const leer = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const guardar = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };

let _ctx: Ctx | null = null;
let _capas: { tecnicos: Leaflet.LayerGroup; ruta: Leaflet.LayerGroup } | null = null;
let _dia = hoy();
let _panel: Panel = (leer('hub_ma_panel', 'dia') as Panel);
let _escribe = false;
let _trabajos: Trabajo[] = [];
let _tickets: Ticket[] = [];
let _tecnicos: Tecnico[] = [];
let _semana: { desde: string; bloques: Bloque[]; pendientes: Trabajo[]; trabajos: Map<string, Trabajo>; etiquetas: Map<string, string> } = { desde: lunesDe(_dia), bloques: [], pendientes: [], trabajos: new Map(), etiquetas: new Map() };
const _nombresSede = new Map<string, string>();
let _equipo: string[] = [];
let _asignarA = '';
let _tecRuta = '';
let _optimizar = false;
let _verTecnicos = leer('hub_ma_tecnicos', '1') === '1';
let _arrastra: string | null = null;

const SEL_TR = 'id,numero,titulo,descripcion,estado,local_id,cliente_id,hora_llegada,tecnicos,duracion_teorica';
const sedeDe = (id: string | null) => (id ? _ctx?.sedes.find(s => s.id === id) ?? null : null);
const nombreSede = (t: { local_id: string | null; cliente_id: string | null }) =>
  (t.local_id ? _nombresSede.get(t.local_id) : null) ?? (t.cliente_id ? _ctx?.clientes.get(t.cliente_id) : null) ?? 'Sin sede';
const tituloTr = (t: Trabajo) => t.titulo || t.descripcion || 'Trabajo';

async function nombresSedes(ids: (string | null)[]) {
  const faltan = [...new Set(ids.filter(Boolean) as string[])].filter(id => !_nombresSede.has(id));
  for (const s of _ctx?.sedes ?? []) _nombresSede.set(s.id, s.nombre);
  const resto = faltan.filter(id => !_nombresSede.has(id));
  for (let i = 0; i < resto.length; i += 150) {
    const { data } = await API.get<{ id: string; nombre: string }[]>('locales', { select: 'id,nombre', id: `in.(${resto.slice(i, i + 150).join(',')})` });
    for (const l of data ?? []) _nombresSede.set(l.id, l.nombre);
  }
}

// ── Datos ───────────────────────────────────────────────────────────────────
async function trabajosDia(dia: string): Promise<Trabajo[]> {
  const desde = inicioDia(dia), hasta = new Date(desde.getTime() + DIA_MS);
  const [tr, ag] = await Promise.all([
    API.get<Trabajo[]>('trabajos', { select: SEL_TR, fecha_programada: `eq.${dia}`, estado: 'in.(Pendiente,"En progreso")', order: 'hora_llegada.nullslast', limit: '100' }),
    API.get<Bloque[]>('agenda', { select: 'id,trabajo_id,inicio,fin,tecnicos', trabajo_id: 'not.is.null', inicio: `lt.${hasta.toISOString()}`, fin: `gt.${desde.toISOString()}`, order: 'inicio', limit: '200' }),
  ]);
  const porId = new Map((tr.data ?? []).map(t => [t.id, t]));
  const faltan = [...new Set((ag.data ?? []).map(b => b.trabajo_id!).filter(id => !porId.has(id)))];
  const otros = new Map<string, Trabajo>();
  for (let i = 0; i < faltan.length; i += 150) {
    const { data } = await API.get<Trabajo[]>('trabajos', { select: SEL_TR, id: `in.(${faltan.slice(i, i + 150).join(',')})` });
    for (const t of data ?? []) otros.set(t.id, t);
  }
  for (const b of ag.data ?? []) {
    const ya = porId.get(b.trabajo_id!);
    if (ya) { if (!ya.bloque_id) { ya.bloque_id = b.id; ya.hora_llegada ??= b.inicio; } continue; }
    const t = otros.get(b.trabajo_id!);
    if (!t || !['Pendiente', 'En progreso'].includes(t.estado)) continue;
    porId.set(t.id, { ...t, hora_llegada: b.inicio, tecnicos: b.tecnicos?.length ? b.tecnicos : t.tecnicos, bloque_id: b.id });
  }
  return [...porId.values()].sort((a, b) => String(a.hora_llegada ?? 'z').localeCompare(String(b.hora_llegada ?? 'z')));
}

async function tecnicosFichados(): Promise<Tecnico[]> {
  const { data } = await API.get<any[]>('sesiones', { select: 'id,entidad_tipo,entidad_id,tecnico_id,tecnico_nombre,traslado,inicio,gps_lat,gps_lng,created_at',
    fin: 'is.null', created_at: `gt.${new Date(Date.now() - 2 * DIA_MS).toISOString()}`, order: 'created_at.desc', limit: '60' });
  const vistos = new Set<string>(), abiertas: any[] = [];
  for (const s of data ?? []) { const k = s.tecnico_nombre || s.tecnico_id; if (!k || vistos.has(k)) continue; vistos.add(k); abiertas.push(s); }
  const ent = new Map<string, { local_id: string | null; titulo: string }>();
  for (const t of _trabajos) ent.set(`trabajo:${t.id}`, { local_id: t.local_id, titulo: tituloTr(t) });
  const TABLA: Record<string, string> = { trabajo: 'trabajos', tarea: 'tareas', ticket: 'tickets' };
  await Promise.all(Object.entries(TABLA).map(async ([tipo, tabla]) => {
    const ids = abiertas.filter(s => s.entidad_tipo === tipo && s.entidad_id && !ent.has(`${tipo}:${s.entidad_id}`)).map(s => s.entidad_id);
    if (!ids.length) return;
    const { data: filas } = await API.get<any[]>(tabla, { select: tipo === 'ticket' ? 'id,local_id,titulo' : 'id,local_id,titulo,descripcion', id: `in.(${ids.join(',')})` });
    for (const f of filas ?? []) ent.set(`${tipo}:${f.id}`, { local_id: f.local_id, titulo: f.titulo || f.descripcion || '' });
  }));
  return abiertas.map(s => {
    const e = s.entidad_id ? ent.get(`${s.entidad_tipo}:${s.entidad_id}`) : null;
    return { nombre: s.tecnico_nombre || 'Técnico', enSitio: !!s.inicio, desde: s.inicio || s.traslado, localId: e?.local_id ?? null, que: e?.titulo ?? '',
      lat: s.gps_lat != null ? Number(s.gps_lat) : null, lng: s.gps_lng != null ? Number(s.gps_lng) : null };
  });
}

async function cargarDia() {
  const [tr, tk] = await Promise.all([
    trabajosDia(_dia),
    API.get<Ticket[]>('tickets', { select: 'id,numero,titulo,prioridad,local_id,cliente_id', estado: 'in.(Abierto,"En curso",Pendiente)', order: 'created_at.desc', limit: '100' }),
  ]);
  _trabajos = tr; _tickets = tk.data ?? [];
  _tecnicos = await tecnicosFichados().catch(() => []);
  await nombresSedes([..._trabajos.map(t => t.local_id), ..._tickets.map(t => t.local_id), ..._tecnicos.map(t => t.localId)]);
}

async function cargarSemana() {
  const desde = inicioDia(_semana.desde), hasta = new Date(desde.getTime() + 7 * DIA_MS);
  const [ag, pend] = await Promise.all([
    API.get<Bloque[]>('agenda', { select: 'id,trabajo_id,tarea_id,ticket_id,tipo,titulo,inicio,fin,todo_el_dia,tecnicos', inicio: `lt.${hasta.toISOString()}`, fin: `gt.${desde.toISOString()}`, order: 'inicio', limit: '500' }),
    API.get<Trabajo[]>('trabajos', { select: SEL_TR, estado: 'eq.Pendiente', fecha_programada: 'is.null', order: 'created_at.desc', limit: '80' }),
  ]);
  const bloques = ag.data ?? [];
  const ids = (k: 'trabajo_id' | 'tarea_id' | 'ticket_id') => [...new Set(bloques.map(b => b[k]).filter(Boolean) as string[])];
  const trabajos = new Map<string, Trabajo>(), etiquetas = new Map<string, string>();
  const [tr, ta, tk] = await Promise.all([
    ids('trabajo_id').length ? API.get<Trabajo[]>('trabajos', { select: SEL_TR, id: `in.(${ids('trabajo_id').join(',')})` }) : Promise.resolve({ data: [] as Trabajo[] }),
    ids('tarea_id').length ? API.get<any[]>('tareas', { select: 'id,titulo,tecnico_id', id: `in.(${ids('tarea_id').join(',')})` }) : Promise.resolve({ data: [] as any[] }),
    ids('ticket_id').length ? API.get<any[]>('tickets', { select: 'id,numero,titulo', id: `in.(${ids('ticket_id').join(',')})` }) : Promise.resolve({ data: [] as any[] }),
  ]);
  for (const t of tr.data ?? []) trabajos.set(t.id, t);
  for (const t of ta.data ?? []) etiquetas.set(`tarea:${t.id}`, `Tarea · ${t.titulo ?? ''}`);
  for (const t of tk.data ?? []) etiquetas.set(`ticket:${t.id}`, `#${t.numero} ${t.titulo ?? ''}`);
  // Como la app: fuera los bloques de trabajos ya completados o facturados.
  _semana = { ..._semana, bloques: bloques.filter(b => !b.trabajo_id || ['Pendiente', 'En progreso'].includes(trabajos.get(b.trabajo_id)?.estado ?? 'Pendiente')),
    pendientes: pend.data ?? [], trabajos, etiquetas };
  await nombresSedes([...trabajos.values(), ..._semana.pendientes].map(t => t.local_id));
}

// ── Lo que se ve ────────────────────────────────────────────────────────────
function etiquetaBloque(b: Bloque) {
  const t = b.trabajo_id ? _semana.trabajos.get(b.trabajo_id) : null;
  if (t) return `${t.numero ? `#${t.numero} · ` : ''}${nombreSede(t) !== 'Sin sede' ? nombreSede(t) : tituloTr(t)}`;
  if (b.tarea_id) return _semana.etiquetas.get(`tarea:${b.tarea_id}`) ?? 'Tarea';
  if (b.ticket_id) return _semana.etiquetas.get(`ticket:${b.ticket_id}`) ?? 'Ticket';
  return b.titulo || 'Bloque';
}
const enlaceBloque = (b: Bloque) => {
  const t = b.trabajo_id ? _semana.trabajos.get(b.trabajo_id) : null;
  return t?.numero ? `#/trabajos/${t.numero}` : b.trabajo_id ? `#/trabajos/${b.trabajo_id}` : b.ticket_id ? '#/tickets' : `#/calendario/dia/b:${b.id}`;
};
const tecnicosDe = (b: Bloque) => (b.tecnicos?.length ? b.tecnicos : (b.trabajo_id ? _semana.trabajos.get(b.trabajo_id)?.tecnicos : null) ?? []);
const chipsTec = (n: string[] | null) => (n ?? []).slice(0, 3).map(x => `<span class="map-ini" title="${esc(x)}">${esc(x.split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase())}</span>`).join('');

function htmlDia(): string {
  const fila = (izq: string, titulo: string, sub: string, accion: string, extra = '') =>
    `<button type="button" class="map-fila" ${accion}><span class="map-hora">${izq}</span><span class="map-txt"><strong>${titulo}</strong><small>${sub}</small></span>${extra}</button>`;
  const bloque = (t: string, filas: string[], vacio: string) => `<h4>${t}</h4>${filas.length ? filas.join('') : `<p class="nota">${vacio}</p>`}`;
  return bloque('Técnicos', _tecnicos.map(t => fila(`<span class="map-tec ${t.enSitio ? '' : 'traslado'}">${esc(t.nombre.split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase())}</span>`,
      esc(t.nombre), esc([t.enSitio ? 'en sitio' : 'en traslado', t.localId ? _nombresSede.get(t.localId) : '', t.desde ? hora(t.desde) : ''].filter(Boolean).join(' · ')),
      `data-action="maCentrar" data-p0="${esc(t.localId ?? '')}"`)), 'Nadie fichado ahora mismo')
    + bloque(_dia === hoy() ? 'Trabajos de hoy' : `Trabajos del ${fechaLarga(_dia)}`, _trabajos.map(t => fila(esc(hora(t.hora_llegada)), esc(nombreSede(t)),
      esc(`${tituloTr(t)}${t.tecnicos?.length ? ` · ${t.tecnicos.join(', ')}` : ''}`), `data-action="maCentrar" data-p0="${esc(t.local_id ?? '')}" data-p1="${esc(t.numero ? `#/trabajos/${t.numero}` : '')}"`,
      `<span class="chip ${t.estado === 'En progreso' ? 'bien' : ''}">${esc(t.estado)}</span>`)), _dia === hoy() ? 'Nada programado para hoy' : 'Nada programado ese día')
    + bloque('Tickets abiertos', _tickets.slice(0, 30).map(t => fila(`<span class="${/alta|urgente/i.test(t.prioridad ?? '') ? 'g-mal' : ''}">#${t.numero}</span>`, esc(nombreSede(t)), esc(t.titulo),
      `data-action="maCentrar" data-p0="${esc(t.local_id ?? '')}" data-p1="#/tickets/${t.numero}"`)), 'Ningún ticket abierto');
}

function htmlSemana(): string {
  const dnd = (atrs: string) => (_escribe ? atrs : '');
  const filas: string[] = [];
  for (let i = 0; i < 7; i++) {
    const f = sumarDias(_semana.desde, i), d = new Date(`${f}T12:00:00`);
    const d0 = inicioDia(f).getTime(), d1 = d0 + DIA_MS;
    const bl = _semana.bloques.filter(b => new Date(b.inicio).getTime() < d1 && new Date(b.fin).getTime() > d0);
    filas.push(`<div class="map-sem-fila ${f === hoy() ? 'hoy' : ''} ${f === _dia ? 'sel' : ''}" data-dia="${f}"
        ${dnd(`data-on-dragover="maSobre:$this" data-prevent="1" data-on-dragleave="maFuera:$this" data-on-drop="maSoltar:${f}"`)}>
      <button type="button" class="map-sem-cab" data-action="maElegirDia" data-p0="${f}" title="Ver este día"><b>${DIAS[d.getDay()]}</b><span>${d.getDate()}</span>${bl.length ? `<i>${bl.length}</i>` : ''}</button>
      <div class="map-sem-bloques">${bl.length ? bl.map(b => `<a class="map-bloque" href="${esc(enlaceBloque(b))}" data-bloque="${esc(b.id)}" ${dnd(`draggable="true" data-on-dragstart="maArrastrar:bloque:${esc(b.id)}"`)}
          title="${esc(etiquetaBloque(b))}${_escribe ? ' · arrastra a otro día para moverlo' : ''}"><span class="map-hora">${b.todo_el_dia ? 'día' : esc(hora(b.inicio))}</span><span class="map-txt">${esc(etiquetaBloque(b))}</span>${chipsTec(tecnicosDe(b))}</a>`).join('')
        : `<span class="nota">Libre${_escribe ? ' · suelta aquí un trabajo' : ''}</span>`}</div></div>`);
  }
  const chips = [{ n: '', l: 'Nadie' }, ..._equipo.map(n => ({ n, l: n.split(/\s+/)[0] }))]
    .map(c => `<button type="button" class="${_asignarA === c.n ? 'activo' : ''}" data-action="maAsignarA" data-p0="${esc(c.n)}">${esc(c.l)}</button>`).join('');
  const fin = new Date(`${sumarDias(_semana.desde, 6)}T12:00:00`);
  const rango = `${new Date(`${_semana.desde}T12:00:00`).getDate()}–${fin.getDate()} ${fin.toLocaleDateString('es-ES', { month: 'short' })}`;
  return `${_escribe ? '' : avisoSoloLectura('La agenda')}
    <div class="acciones map-nav"><button class="btn secundario" data-action="maSemana" data-p0="-1" aria-label="Semana anterior">${ico('izquierda')}</button>
      <button class="btn secundario" data-action="maSemana" data-p0="0" title="Ir a la semana de hoy">Semana del ${esc(rango)}</button>
      <button class="btn secundario" data-action="maSemana" data-p0="1" aria-label="Semana siguiente">${ico('derecha')}</button></div>
    ${_escribe ? `<div class="map-asignar"><span class="nota">Asignar al soltar:</span><div class="segmentado">${chips}</div></div>` : ''}
    <div class="map-sem">${filas.join('')}</div>
    <div class="map-bandeja" data-dia="bandeja" ${dnd('data-on-dragover="maSobre:$this" data-prevent="1" data-on-dragleave="maFuera:$this" data-on-drop="maSoltar:bandeja"')}>
      <h4>Sin planificar <span class="chip">${_semana.pendientes.length}</span></h4>
      ${_semana.pendientes.length ? _semana.pendientes.map(t => `<a class="map-bloque map-pend" href="#/trabajos/${t.numero ?? t.id}" data-pend="${esc(t.id)}" ${dnd(`draggable="true" data-on-dragstart="maArrastrar:pend:${esc(t.id)}"`)}
          title="${_escribe ? 'Arrastra a un día para planificarlo' : ''}"><span class="map-hora">#${t.numero ?? ''}</span><span class="map-txt">${esc(nombreSede(t))} · ${esc(tituloTr(t))}</span>${chipsTec(t.tecnicos)}</a>`).join('')
        : `<p class="nota">Nada pendiente de planificar.${_escribe ? ' Suelta aquí un bloque para quitarle el día.' : ''}</p>`}
    </div>`;
}

function paradas() {
  const lista = _trabajos.filter(t => !_tecRuta || (t.tecnicos ?? []).some(x => mismaPersona(x, _tecRuta)));
  const ps = lista.map(t => { const s = sedeDe(t.local_id); return { t, s: s ? { lat: Number(s.lat), lng: Number(s.lng) } : null }; });
  if (!_optimizar) return ps;
  const con = ps.filter(p => p.s), sin = ps.filter(p => !p.s), orden: typeof ps = [];
  let pos = OFICINA;
  while (con.length) {
    let mejor = 0, dm = Infinity;
    con.forEach((p, i) => { const d = kmEntre(pos, p.s!); if (d < dm) { dm = d; mejor = i; } });
    const p = con.splice(mejor, 1)[0];
    orden.push(p); pos = p.s!;
  }
  return [...orden, ...sin];
}

function htmlRuta(): string {
  const nombres = [...new Set(_trabajos.flatMap(t => t.tecnicos ?? []))].sort();
  if (_tecRuta && !nombres.includes(_tecRuta)) _tecRuta = '';
  const ps = paradas();
  let total = 0, pos = OFICINA;
  const filas = ps.map((p, i) => {
    let tramo = '';
    if (p.s) { const d = kmEntre(pos, p.s); total += d; tramo = fmtKm(d); pos = p.s; }
    return `<button type="button" class="map-fila ${p.s ? '' : 'apagado'}" data-action="maCentrar" data-p0="${esc(p.t.local_id ?? '')}" data-p1="${esc(p.t.numero ? `#/trabajos/${p.t.numero}` : '')}"
      title="${p.s ? 'Centrar en la sede' : 'Sede sin situar en el mapa'}"><span class="map-num">${i + 1}</span>
      <span class="map-txt"><strong>${esc(hora(p.t.hora_llegada))} · ${esc(nombreSede(p.t))}</strong><small>${esc(tituloTr(p.t))}${p.t.tecnicos?.length ? ` · ${esc(p.t.tecnicos.join(', '))}` : ''}</small></span>
      <span class="nota">${tramo}</span></button>`;
  });
  const puntos = [OFICINA, ...ps.filter(p => p.s).map(p => p.s!)];
  const c = (p: { lat: number; lng: number }) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  const enlace = puntos.length >= 2 ? `https://www.google.com/maps/dir/?api=1&origin=${c(puntos[0])}&destination=${c(puntos[puntos.length - 1])}${puntos.length > 2 ? `&waypoints=${encodeURIComponent(puntos.slice(1, -1).map(c).join('|'))}` : ''}&travelmode=driving` : '';
  return `<div class="segmentado map-ruta-tec">${[{ n: '', l: 'Todos' }, ...nombres.map(n => ({ n, l: n }))].map(x => `<button type="button" class="${_tecRuta === x.n ? 'activo' : ''}" data-action="maRutaTecnico" data-p0="${esc(x.n)}">${esc(x.l)}</button>`).join('')}</div>
    <label class="check"><input type="checkbox" id="map-optimizar" ${_optimizar ? 'checked' : ''} data-on-change="maOptimizar:$checked"> Optimizar el orden (vecino más cercano desde la oficina)</label>
    <p class="nota">Salida: la oficina de Armeñime.</p>
    ${filas.length ? filas.join('') : `<p class="vacio">${_tecRuta ? `${esc(_tecRuta)} no tiene trabajos ese día.` : 'Ningún trabajo ese día.'}</p>`}
    <div class="acciones map-total"><span id="map-total">${ps.length} parada${ps.length === 1 ? '' : 's'} · ${fmtKm(total)} en línea recta</span>
      ${enlace ? `<a class="btn" href="${esc(enlace)}" target="_blank" rel="noopener">Google Maps ${ico('externo')}</a>` : ''}</div>`;
}

function pintarTecnicos() {
  if (!_ctx || !_capas) return;
  _capas.tecnicos.clearLayers();
  if (!_verTecnicos) return;
  const { L } = _ctx;
  for (const t of _tecnicos) {
    let lat = t.lat, lng = t.lng;
    const s = sedeDe(t.localId);
    if (lat == null && s) { lat = Number(s.lat) + 0.0012; lng = Number(s.lng) + 0.0012; } // al lado del punto, no encima
    if (lat == null || lng == null) continue;
    const ini = t.nombre.split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase();
    L.marker([lat, lng], { icon: L.divIcon({ className: '', html: `<div class="map-tec ${t.enSitio ? '' : 'traslado'}" title="${esc(t.nombre)}">${esc(ini)}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }), zIndexOffset: 1000 })
      .bindPopup(`<strong>${esc(t.nombre)}</strong><br>${t.enSitio ? 'En sitio' : 'En traslado'}${t.desde ? ` desde las ${esc(hora(t.desde))}` : ''}${s ? `<br>${esc(s.nombre)}${t.que ? ` · ${esc(t.que)}` : ''}` : ''}${t.lat != null ? '<br><small>Posición del GPS al fichar</small>' : ''}`)
      .addTo(_capas.tecnicos);
  }
}

function pintarRutaEnMapa() {
  if (!_ctx || !_capas) return;
  const capa = _capas.ruta;
  capa.clearLayers();
  if (_panel !== 'ruta') return;
  const { L, mapa } = _ctx;
  const ps = paradas().filter(p => p.s);
  const puntos: [number, number][] = [[OFICINA.lat, OFICINA.lng], ...ps.map(p => [p.s!.lat, p.s!.lng] as [number, number])];
  if (puntos.length >= 2) L.polyline(puntos, { color: getComputedStyle(document.documentElement).getPropertyValue('--serie-1').trim() || '#1a6b4a', weight: 4, opacity: 0.85, dashArray: '8 6' }).addTo(capa);
  L.marker([OFICINA.lat, OFICINA.lng], { icon: L.divIcon({ className: '', html: '<div class="map-num casa" title="Salida: la oficina">O</div>', iconSize: [22, 22], iconAnchor: [11, 11] }), zIndexOffset: 900 }).addTo(capa);
  ps.forEach((p, i) => L.marker([p.s!.lat, p.s!.lng], { icon: L.divIcon({ className: '', html: `<div class="map-num">${i + 1}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }), zIndexOffset: 900 }).addTo(capa));
  if (ps.length) mapa.fitBounds(puntos, { padding: [40, 40], maxZoom: 14 });
}

function pintarPanel() {
  const el = document.getElementById('map-panel');
  if (!el) return;
  const esHoy = _dia === hoy();
  const PESTANAS: [Panel, string][] = [['dia', 'Día'], ['semana', 'Semana'], ['ruta', 'Ruta']];
  el.innerHTML = `<div class="acciones map-cab">
      <div class="segmentado" role="tablist">${PESTANAS.map(([k, n]) => `<button role="tab" aria-selected="${k === _panel}" class="${k === _panel ? 'activo' : ''}" data-action="maPanel" data-p0="${k}">${n}</button>`).join('')}</div>
      <div class="acciones map-dia"><button class="btn secundario" data-action="maDia" data-p0="-1" aria-label="Día anterior">${ico('izquierda')}</button>
        <button class="btn secundario ${esHoy ? '' : 'otro'}" id="map-dia" data-action="maDia" data-p0="0" title="${esHoy ? 'Hoy' : 'Volver a hoy'}">${esHoy ? 'Hoy · ' : ''}${esc(fechaLarga(_dia))}</button>
        <button class="btn secundario" data-action="maDia" data-p0="1" aria-label="Día siguiente">${ico('derecha')}</button></div></div>
    <p class="nota" id="map-resumen">${_trabajos.length} trabajo(s) ${esHoy ? 'hoy' : 'ese día'} · ${_tickets.length} ticket(s) abierto(s) · ${_tecnicos.length} técnico(s) fichado(s)
      · <label class="check"><input type="checkbox" ${_verTecnicos ? 'checked' : ''} data-on-change="maVerTecnicos:$checked"> técnicos en el mapa</label></p>
    <div id="map-cuerpo">${_panel === 'dia' ? htmlDia() : _panel === 'semana' ? htmlSemana() : htmlRuta()}</div>`;
  pintarRutaEnMapa();
}

/** Lo que va en el globo de una sede: su trabajo del día, sus tickets y las acciones. */
export function extraPopup(s: SedeMapa): string {
  const tr = _trabajos.filter(t => t.local_id === s.id), tk = _tickets.filter(t => t.local_id === s.id);
  const llegar = `https://www.google.com/maps/dir/?api=1&destination=${Number(s.lat).toFixed(6)},${Number(s.lng).toFixed(6)}`;
  return `${tr.map(t => `<br>${ico('herramienta')} <a href="#/trabajos/${t.numero ?? t.id}">${esc(hora(t.hora_llegada))} · ${esc(tituloTr(t))}</a>${t.tecnicos?.length ? ` · ${esc(t.tecnicos.join(', '))}` : ''}`).join('')}
    ${tk.map(t => `<br>${ico('etiqueta')} <a href="#/tickets/${t.numero}">#${t.numero} ${esc(t.titulo)}</a>`).join('')}
    <br><a href="${esc(llegar)}" target="_blank" rel="noopener">Cómo llegar</a> · <a href="#" data-action="maNuevoTrabajo" data-p0="${esc(s.id)}">Nuevo trabajo</a>`;
}
/** Para el radio del punto: la sede tiene trabajo ese día. */
export const tieneTrabajo = (localId: string) => _trabajos.some(t => t.local_id === localId);

/** Engancha el panel al mapa ya creado (lo llama el `pintar` del módulo). */
export async function iniciarPanel(ctx: Ctx) {
  _ctx = ctx;
  _capas = { tecnicos: ctx.L.layerGroup().addTo(ctx.mapa), ruta: ctx.L.layerGroup().addTo(ctx.mapa) };
  const [esc2, personas] = await Promise.all([esDelHub('trabajos', 'agenda'), equipo().catch(() => [])]);
  _escribe = esc2;
  _equipo = personas.map(p => p.nombre);
  _semana.desde = lunesDe(_dia);
  await Promise.all([cargarDia(), cargarSemana()]);
  pintarPanel(); pintarTecnicos(); ctx.repintar();
}

async function recargarDia() {
  await cargarDia();
  pintarPanel(); pintarTecnicos(); _ctx?.repintar();
}

async function soltar(carga: string, destino: string) {
  const [tipo, id] = carga.split(':');
  if (!tipo || !id) return;
  if (tipo === 'pend' && destino !== 'bandeja') {
    // La misma regla que planificar del calendario: la fecha va al trabajo y la base crea el bloque.
    const t = _semana.pendientes.find(x => x.id === id);
    const cuerpo: Record<string, unknown> = { fecha_programada: destino, hora_llegada: new Date(`${destino}T${String(HORA_DEFECTO).padStart(2, '0')}:00:00`).toISOString() };
    if (t && !t.duracion_teorica) cuerpo.duracion_teorica = 60;
    if (_asignarA && !(t?.tecnicos ?? []).some(x => mismaPersona(x, _asignarA))) cuerpo.tecnicos = [...(t?.tecnicos ?? []), _asignarA];
    const r = await API.patch('trabajos', { id: `eq.${id}` }, cuerpo);
    if (r.error) { toast(`No se pudo planificar: ${r.error.message}`, 'error'); return; }
    toast(`Planificado el ${fechaLarga(destino)} a las ${String(HORA_DEFECTO).padStart(2, '0')}:00${_asignarA ? ` para ${_asignarA}` : ''}`);
  } else if (tipo === 'bloque') {
    const b = _semana.bloques.find(x => x.id === id);
    if (!b) return;
    if (destino === 'bandeja') {
      if (!confirm(`¿Quitar «${etiquetaBloque(b)}» del ${fechaLarga(new Date(b.inicio).toLocaleDateString('sv-SE'))}? ${b.trabajo_id ? 'El trabajo no se borra: vuelve a «sin planificar» si era su único día.' : 'El bloque desaparece del calendario.'}`)) return;
      const r = await API.delete('agenda', { id: `eq.${id}` });
      if (r.error) { toast(`No se pudo quitar: ${r.error.message}`, 'error'); return; }
      toast('Día quitado');
    } else {
      const ini = new Date(b.inicio), fin = new Date(b.fin);
      const nIni = new Date(`${destino}T${ini.toTimeString().slice(0, 8)}`);
      if (nIni.getTime() === ini.getTime() && !_asignarA) return;
      const nFin = new Date(nIni.getTime() + Math.max(60_000, fin.getTime() - ini.getTime()));
      const tecs = _asignarA ? [...new Set([...tecnicosDe(b), _asignarA])] : null;
      const r = await API.rpc('agenda_mover', { p_id: id, p_inicio: nIni.toISOString(), p_fin: nFin.toISOString(), ...(tecs ? { p_tecnicos: tecs } : {}) });
      if (r.error) { toast(`No se pudo mover: ${r.error.message}`, 'error'); return; }
      toast(`Movido al ${fechaLarga(destino)}${_asignarA ? ` · ${_asignarA}` : ''}`);
    }
  } else return;
  await Promise.all([cargarSemana(), cargarDia()]);
  pintarPanel(); pintarTecnicos(); _ctx?.repintar();
}

registrarAcciones({
  async maPanel(p: Panel) { _panel = p; guardar('hub_ma_panel', p); pintarPanel(); },
  async maDia(d: string) {
    _dia = d === '0' ? hoy() : sumarDias(_dia, Number(d) || 0);
    if (lunesDe(_dia) !== _semana.desde) { _semana.desde = lunesDe(_dia); await cargarSemana(); }
    await recargarDia();
  },
  async maElegirDia(f: string) { if (!f) return; _dia = f; await recargarDia(); },
  async maSemana(d: string) {
    _semana.desde = d === '0' ? lunesDe(hoy()) : sumarDias(_semana.desde, 7 * (Number(d) || 0));
    await cargarSemana(); pintarPanel();
  },
  maAsignarA(n: string) { _asignarA = _asignarA === n ? '' : n; pintarPanel(); },
  maRutaTecnico(n: string) { _tecRuta = n; pintarPanel(); },
  maOptimizar(v: boolean) { _optimizar = v; pintarPanel(); },
  maVerTecnicos(v: boolean) { _verTecnicos = v; guardar('hub_ma_tecnicos', v ? '1' : '0'); pintarTecnicos(); },
  maCentrar(localId: string, ruta?: string) {
    if (localId && _ctx?.centrar(localId)) return;
    if (ruta) { location.hash = ruta; return; }
    if (localId) toast('Esa sede no está situada en el mapa', 'error');
  },
  maNuevoTrabajo(localId: string) {
    const s = sedeDe(localId);
    dejarBorrador('trabajo', { cliente_id: s?.cliente_id ?? null, local_id: localId });
    ir('trabajos', 'nuevo');
  },
  maArrastrar(carga: string) { _arrastra = carga; },
  maSobre(el: HTMLElement) { el.classList.add('sobre'); },
  maFuera(el: HTMLElement) { el.classList.remove('sobre'); },
  async maSoltar(destino: string) {
    document.querySelectorAll('#map-panel .sobre').forEach(x => x.classList.remove('sobre'));
    const c = _arrastra; _arrastra = null;
    if (c) await soltar(c, destino);
  },
});
