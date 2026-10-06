// Lista del día: #/lista-dia (la lista) y #/lista-dia/planificar (hoy/mañana).
// Reglas de la app (lista-dia.js, docs/LISTA_DIA.md):
//   · Una fila = una cosa en la lista de UNA persona para UN día; título, cliente
//     y estado se leen del registro real, no se copian (salvo las notas).
//   · Meter algo en la lista de alguien es ASIGNÁRSELO: al trabajo se le AÑADE
//     el técnico (al pasarlo a otra persona se quita al anterior); tarea y ticket
//     cambian de tecnico_id.
//   · Marcar lo cierra en origen por hub.lista_dia_marcar (exige fichaje en
//     trabajos y tareas; desmarcar lo devuelve).
//   · El técnico ve SU lista; el admin elige persona o «Todo el equipo».
// Escribe solo con el área `lista_dia` cortada. Prefijo de ids: ld-.
import { API } from '../../core/api';
import { equipo } from '../../core/equipo';
import { usuario, esAdmin } from '../../core/estado';
import { registrarAcciones } from '../../core/dispatcher';
import { resolver } from '../../core/router';
import { esDelHub, avisoSoloLectura } from '../../core/areas';
import { esc, toast } from '../../ui/dom';
import { ico } from '../../shell/linea';
import type { IconoLinea } from '../../shell/linea';
import { nombresClientes } from '../ventas/datos';

type Tipo = 'trabajo' | 'tarea' | 'ticket' | 'nota';
interface Item { id: string; fecha: string; usuario: string; tipo: Tipo; ref_id: string | null; titulo: string | null; orden: number; completado: boolean; estado_previo: string | null; _reg?: any; _cliente?: string }
const TABLA: Record<Exclude<Tipo, 'nota'>, string> = { trabajo: 'trabajos', tarea: 'tareas', ticket: 'tickets' };
const ABIERTOS: Record<Exclude<Tipo, 'nota'>, string> = { trabajo: '(Pendiente,"En progreso")', tarea: '(pendiente,en_progreso)', ticket: '(Abierto,"En curso",Pendiente)' };
const ICONO: Record<Tipo, IconoLinea> = { trabajo: 'herramienta', tarea: 'hecho', ticket: 'etiqueta', nota: 'nota' };
const ETIQ: Record<Tipo, string> = { trabajo: 'Trabajo', tarea: 'Tarea', ticket: 'Ticket', nota: 'Recado' };
const TODOS = '__todos';
const leer = (k: string, d: string) => { try { return sessionStorage.getItem(k) ?? d; } catch { return d; } };
const guardar = (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };
const hoyStr = () => new Date().toLocaleDateString('sv-SE');
const masDias = (n: number) => new Date(Date.now() + n * 86400000).toLocaleDateString('sv-SE');

let _items: Item[] = [];
let _fecha = hoyStr();
let _persona = '';
let _cands: { tipo: Exclude<Tipo, 'nota'>; id: string; titulo: string; sub: string; suyo: boolean }[] = [];

const enlace = (it: { tipo: Tipo; _reg?: any; ref_id: string | null }) =>
  it.tipo === 'trabajo' && it._reg?.numero ? `#/trabajos/${it._reg.numero}` : it.tipo === 'ticket' && it._reg?.numero ? `#/tickets/${it._reg.numero}` : it.tipo === 'tarea' && it.ref_id ? `#/tareas/${it.ref_id}` : '';
const tituloDe = (it: Item) => it.tipo === 'nota' ? it.titulo ?? '' : it._reg ? `${it._reg.numero ? `#${it._reg.numero} ` : ''}${it._reg.titulo ?? it._reg.descripcion ?? ''}` : it.titulo ?? '(ya no existe)';

async function enriquecer(items: Item[]) {
  for (const tipo of ['trabajo', 'tarea', 'ticket'] as const) {
    const ids = [...new Set(items.filter(i => i.tipo === tipo && i.ref_id).map(i => i.ref_id!))];
    if (!ids.length) continue;
    const { data } = await API.get<any[]>(TABLA[tipo], { select: tipo === 'trabajo' ? 'id,numero,titulo,descripcion,estado,cliente_id,tecnicos' : 'id,numero,titulo,estado,cliente_id,tecnico_id', id: `in.(${ids.join(',')})` });
    const porId = new Map((data ?? []).map(r => [r.id, r]));
    items.filter(i => i.tipo === tipo).forEach(i => { i._reg = porId.get(i.ref_id!) ?? null; });
  }
  const nombres = await nombresClientes(items.map(i => i._reg?.cliente_id ?? null));
  items.forEach(i => { i._cliente = i._reg?.cliente_id ? nombres.get(i._reg.cliente_id) ?? '' : ''; });
}

async function vistaLista(): Promise<string> {
  const [personas, escribe] = await Promise.all([equipo(), esDelHub('lista_dia')]);
  const yo = usuario()?.nombre ?? '';
  _fecha = leer('hub_ld_fecha', hoyStr());
  _persona = esAdmin() ? leer('hub_ld_persona', yo) : yo;
  const { data, error } = await API.get<Item[]>('lista_dia', { select: '*', fecha: `eq.${_fecha}`, ...(_persona === TODOS ? {} : { usuario: `eq.${_persona}` }), order: 'completado,orden' });
  if (error) return `<p class="aviso mal">${esc(error.message)}</p>`;
  _items = data ?? [];
  await enriquecer(_items);
  const hechos = _items.filter(i => i.completado).length;
  const d = new Date(`${_fecha}T12:00`);
  const fila = (it: Item) => {
    const href = enlace(it);
    const estado = it._reg?.estado;
    return `<li class="ld-fila${it.completado ? ' hecho' : ''}">
      <label class="ld-check"><input type="checkbox" ${it.completado ? 'checked' : ''} ${escribe ? '' : 'disabled'} data-on-change="ldMarcar:${it.id},$checked" aria-label="Hecho"></label>
      <span class="ld-ico" aria-hidden="true">${ico(ICONO[it.tipo])}</span>
      <span class="ld-txt"><strong>${href ? `<a href="${href}">${esc(tituloDe(it))}</a>` : esc(tituloDe(it))}</strong>
        <small class="nota">${esc([ETIQ[it.tipo], it._cliente, estado, _persona === TODOS ? it.usuario : null].filter(Boolean).join(' · '))}</small></span>
      ${escribe ? `<select class="ld-mover" data-on-change="ldMover:${it.id},$value" aria-label="Pasar a otra persona"><option value="">Pasar a…</option>${personas.filter(p => p.nombre !== it.usuario).map(p => `<option>${esc(p.nombre)}</option>`).join('')}</select>
        <button class="btn secundario" data-action="ldQuitar" data-p0="${it.id}" aria-label="Quitar de la lista">${ico('cerrar')}</button>` : ''}</li>`;
  };
  return `${escribe ? '' : avisoSoloLectura('La lista del día')}
    <div class="acciones pr-barra"><div class="segmentado" role="tablist"><button role="tab" aria-selected="true" class="activo">Lista</button><button role="tab" aria-selected="false" data-action="ldIrPlanificar">Planificar</button></div>
      <button class="btn secundario" data-action="ldDia" data-p0="-1" aria-label="Día anterior">${ico('izquierda')}</button>
      <input type="date" id="ld-fecha" value="${_fecha}" data-on-change="ldFecha:$value" aria-label="Día">
      <button class="btn secundario" data-action="ldDia" data-p0="1" aria-label="Día siguiente">${ico('derecha')}</button>
      ${_fecha !== hoyStr() ? '<button class="btn secundario" data-action="ldFecha" data-p0="">Hoy</button>' : ''}</div>
    ${esAdmin() ? `<div class="acciones ld-personas">${personas.map(p => `<button class="chip-boton${_persona === p.nombre ? ' activo' : ''}" data-action="ldPersona" data-p0="${esc(p.nombre)}">${esc(p.nombre)}</button>`).join('')}
      <button class="chip-boton${_persona === TODOS ? ' activo' : ''}" data-action="ldPersona" data-p0="${TODOS}">${ico('personas')} Todo el equipo</button></div>` : ''}
    <section class="tarjeta"><div class="tarjeta-cab"><h3>${esc(_persona === TODOS ? 'Todo el equipo' : _persona)} · ${esc(d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }))}</h3>
      <span class="chip ${_items.length && hechos === _items.length ? 'bien' : ''}">${hechos}/${_items.length} hechos</span></div>
      ${_items.length ? `<ul class="ld-lista">${_items.map(fila).join('')}</ul>` : '<p class="vacio">La lista está vacía.</p>'}
      ${escribe && _persona !== TODOS ? `<form class="acciones" data-on-submit="ldNota" data-prevent="1"><input id="ld-nota" placeholder="Apuntar un recado suelto…" aria-label="Recado"><button class="btn secundario" type="submit">Apuntar</button></form>
        <div class="acciones"><button class="btn" data-action="ldAbrirAnadir">${ico('mas')} Añadir de lo pendiente</button><button class="btn secundario" data-action="ldTraer">Traer lo que ya tiene asignado ese día</button></div>
        <div id="ld-anadir"></div>` : ''}</section>`;
}

// ── Añadir de lo pendiente del equipo ──────────────────────────────────────
async function cargarCandidatos() {
  const [tr, ta, tk] = await Promise.all([
    API.get<any[]>('trabajos', { select: 'id,numero,titulo,descripcion,cliente_id,tecnicos,fecha_programada', estado: `in.${ABIERTOS.trabajo}`, order: 'numero.desc', limit: '300' }),
    API.get<any[]>('tareas', { select: 'id,numero,titulo,cliente_id,tecnico_id,fecha_vencimiento', estado: `in.${ABIERTOS.tarea}`, order: 'created_at.desc', limit: '300' }),
    API.get<any[]>('tickets', { select: 'id,numero,titulo,cliente_id,tecnico_id', estado: `in.${ABIERTOS.ticket}`, order: 'numero.desc', limit: '200' }),
  ]);
  const nombres = await nombresClientes([...(tr.data ?? []), ...(ta.data ?? []), ...(tk.data ?? [])].map(r => r.cliente_id));
  const sub = (r: any, extra: string | null) => [nombres.get(r.cliente_id) ?? '', extra].filter(Boolean).join(' · ');
  _cands = [
    ...(tr.data ?? []).map(r => ({ tipo: 'trabajo' as const, id: r.id, titulo: `#${r.numero} ${r.titulo ?? r.descripcion ?? ''}`, sub: sub(r, (r.tecnicos ?? []).join(', ') || null), suyo: (r.tecnicos ?? []).includes(_persona) })),
    ...(ta.data ?? []).map(r => ({ tipo: 'tarea' as const, id: r.id, titulo: `${r.numero ? `#${r.numero} ` : ''}${r.titulo ?? ''}`, sub: sub(r, r.tecnico_id), suyo: r.tecnico_id === _persona })),
    ...(tk.data ?? []).map(r => ({ tipo: 'ticket' as const, id: r.id, titulo: `#${r.numero} ${r.titulo ?? ''}`, sub: sub(r, r.tecnico_id), suyo: r.tecnico_id === _persona })),
  ];
}
function pintarCandidatos() {
  const el = document.getElementById('ld-anadir');
  if (!el) return;
  const q = (document.getElementById('ld-cand-q') as HTMLInputElement | null)?.value.toLowerCase() ?? '';
  const tipo = (document.getElementById('ld-cand-tipo') as HTMLSelectElement | null)?.value ?? '';
  const lista = _cands.filter(c => (!tipo || c.tipo === tipo) && (!q || `${c.titulo} ${c.sub}`.toLowerCase().includes(q))).slice(0, 60);
  const ul = el.querySelector('.ld-cands');
  const html = lista.map(c => {
    const dentro = _items.some(i => i.tipo === c.tipo && i.ref_id === c.id && i.usuario === _persona);
    return `<li><button class="ld-cand${dentro ? ' dentro' : ''}" data-action="ldAlternar" data-p0="${c.tipo}" data-p1="${c.id}" aria-pressed="${dentro}">
      <span aria-hidden="true">${ico(ICONO[c.tipo])}</span><span><strong>${esc(c.titulo)}</strong><small class="nota">${esc(c.sub)}${c.suyo ? ' · ya es suyo' : ''}</small></span><span aria-hidden="true">${dentro ? '✓' : '+'}</span></button></li>`;
  }).join('') || '<li class="vacio">Nada con ese filtro.</li>';
  if (ul) { ul.innerHTML = html; return; }
  el.innerHTML = `<div class="tarjeta ld-panel"><div class="acciones"><input id="ld-cand-q" type="search" placeholder="Buscar…" data-on-input="ldFiltrarCands" aria-label="Buscar pendiente">
    <select id="ld-cand-tipo" data-on-change="ldFiltrarCands" aria-label="Tipo"><option value="">Todo</option><option value="trabajo">Trabajos</option><option value="tarea">Tareas</option><option value="ticket">Tickets</option></select></div>
    <ul class="ld-cands">${html}</ul></div>`;
}

// Meter algo en la lista de alguien es asignárselo (_asignarRegistro de la app).
async function asignar(tipo: Tipo, refId: string | null, persona: string, anterior: string | null = null) {
  if (tipo === 'nota' || !refId || !persona) return;
  if (tipo === 'trabajo') {
    const { data } = await API.single<any>('trabajos', { select: 'tecnicos', id: `eq.${refId}` });
    let tec: string[] = data?.tecnicos ?? [];
    if (anterior) tec = tec.filter(t => t !== anterior);
    if (!tec.includes(persona)) tec = [...tec, persona];
    await API.patch('trabajos', { id: `eq.${refId}` }, { tecnicos: tec });
  } else {
    await API.patch(TABLA[tipo], { id: `eq.${refId}` }, { tecnico_id: persona });
  }
}

export async function anadirALista(o: { tipo: Tipo; refId?: string | null; persona: string; fecha?: string; titulo?: string | null; asignarlo?: boolean }): Promise<boolean> {
  const fecha = o.fecha || hoyStr();
  if (o.refId) {
    const { data } = await API.get<any[]>('lista_dia', { select: 'id', fecha: `eq.${fecha}`, usuario: `eq.${o.persona}`, tipo: `eq.${o.tipo}`, ref_id: `eq.${o.refId}`, limit: '1' });
    if (data?.[0]) return true;
  }
  const r = await API.post('lista_dia', { fecha, usuario: o.persona, tipo: o.tipo, ref_id: o.refId ?? null, titulo: o.titulo ?? null, orden: Date.now() % 100000, creado_por: usuario()?.nombre ?? null });
  if (r.error) return false;
  if (o.asignarlo !== false) await asignar(o.tipo, o.refId ?? null, o.persona);
  return true;
}

// Mover un trabajo de día: con la fecha va también la hora (si no, el bloque de
// agenda se quedaría en el día viejo con la hora vieja).
async function trabajoADia(id: string, fecha: string) {
  const { data } = await API.single<any>('trabajos', { select: 'hora_llegada', id: `eq.${id}` });
  const h = data?.hora_llegada ? new Date(data.hora_llegada) : null;
  return API.patch('trabajos', { id: `eq.${id}` }, { fecha_programada: fecha, ...(h ? { hora_llegada: new Date(`${fecha}T${h.toTimeString().slice(0, 8)}`).toISOString() } : {}) });
}

// ── Planificar (hoy / mañana / un día): plan-dia.js de la app ──────────────
async function vistaPlanificar(params: string[]): Promise<string> {
  const pest = params[1] ?? 'hoy';
  const dia = pest === 'manana' ? masDias(1) : pest === 'fecha' ? (params[2] ?? hoyStr()) : hoyStr();
  // «Hoy» trae también lo atrasado (fecha ≤ hoy); un trabajo de varios días sale en todos sus días.
  const filtro = pest === 'hoy' ? `lte.${dia}` : `eq.${dia}`;
  const [escribe, ag] = await Promise.all([esDelHub('trabajos', 'tareas', 'agenda'),
    API.get<any[]>('agenda', { select: 'trabajo_id', trabajo_id: 'not.is.null', and: `(inicio.lt.${new Date(`${dia}T23:59:59`).toISOString()},fin.gt.${new Date(`${dia}T00:00:00`).toISOString()})` })]);
  const idsDia = [...new Set((ag.data ?? []).map(a => a.trabajo_id))];
  const [tr, ta] = await Promise.all([
    API.get<any[]>('trabajos', { select: 'id,numero,titulo,descripcion,tipo,fecha_programada,cliente_id', estado: 'in.(Pendiente,"En progreso")',
      ...(idsDia.length ? { or: `(fecha_programada.${filtro},id.in.(${idsDia.join(',')}))` } : { fecha_programada: filtro }), order: 'fecha_programada' }),
    API.get<any[]>('tareas', { select: 'id,numero,titulo,fecha_vencimiento,prioridad,tecnico_id', estado: 'in.(pendiente,en_progreso)', fecha_vencimiento: filtro, order: 'fecha_vencimiento' }),
  ]);
  const nombres = await nombresClientes((tr.data ?? []).map(t => t.cliente_id));
  const items = [...(tr.data ?? []).map(t => ({ tipo: 'trabajo', id: t.id, titulo: `#${t.numero} ${t.titulo ?? t.descripcion ?? t.tipo ?? 'Trabajo'}`, sub: nombres.get(t.cliente_id) ?? '—', fecha: t.fecha_programada, href: `#/trabajos/${t.numero}` })),
    ...(ta.data ?? []).map(t => ({ tipo: 'tarea', id: t.id, titulo: t.titulo ?? 'Tarea', sub: t.tecnico_id ?? '', fecha: t.fecha_vencimiento, href: `#/tareas/${t.id}` }))];
  const fechaCorta = (f: string | null) => f ? new Date(`${f}T12:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : '';
  return `${escribe ? '' : avisoSoloLectura('Trabajos y tareas')}
    <div class="acciones pr-barra"><div class="segmentado" role="tablist"><button role="tab" aria-selected="false" data-action="ldIrLista">Lista</button><button role="tab" aria-selected="true" class="activo">Planificar</button></div>
      <div class="segmentado" role="tablist" aria-label="Qué día">${[['hoy', 'Hoy y atrasado'], ['manana', 'Mañana']].map(([k, t]) => `<button role="tab" aria-selected="${pest === k}" class="${pest === k ? 'activo' : ''}" data-action="ldPlanPest" data-p0="${k}">${t}</button>`).join('')}</div>
      <input type="date" value="${pest === 'fecha' ? dia : ''}" data-on-change="ldPlanFecha:$value" aria-label="Otro día">
      ${escribe && pest === 'hoy' && items.some(i => i.fecha && i.fecha < hoyStr()) ? '<button class="btn" data-action="ldTodoHoy">Pasar todo lo atrasado a hoy</button>' : ''}</div>
    <section class="tarjeta">${items.length ? `<ul class="ld-lista">${items.map(i => `<li class="ld-fila" id="ld-p-${i.id}"><span class="ld-ico" aria-hidden="true">${ico(ICONO[i.tipo as Tipo])}</span>
      <span class="ld-txt"><strong><a href="${i.href}">${esc(i.titulo)}</a></strong><small class="nota">${esc([i.sub, fechaCorta(i.fecha)].filter(Boolean).join(' · '))}${i.fecha && i.fecha < hoyStr() ? ' · <span class="g-mal">atrasado</span>' : ''}</small></span>
      ${escribe ? `<span class="acciones">${[['hoy', 'Hoy'], ['manana', 'Mañana'], ['semana', '+7 d']].map(([a, t]) => `<button class="btn secundario" data-action="ldPlanMover" data-p0="${i.tipo}" data-p1="${i.id}" data-p2="${a}">${t}</button>`).join('')}</span>` : ''}</li>`).join('')}</ul>` : '<p class="vacio">Nada pendiente para ese día.</p>'}</section>`;
}

export async function pintar(el: HTMLElement, params: string[] = []) {
  el.innerHTML = '<p class="cargando">Cargando…</p>';
  el.innerHTML = params[0] === 'planificar' ? await vistaPlanificar(params) : await vistaLista();
}

registrarAcciones({
  ldIrPlanificar() { location.hash = '#/lista-dia/planificar'; },
  ldIrLista() { location.hash = '#/lista-dia'; },
  ldFecha(v: string) { guardar('hub_ld_fecha', v || hoyStr()); resolver(); },
  ldDia(d: string) { guardar('hub_ld_fecha', new Date(new Date(`${_fecha}T12:00`).getTime() + Number(d) * 86400000).toLocaleDateString('sv-SE')); resolver(); },
  ldPersona(p: string) { guardar('hub_ld_persona', p); resolver(); },
  async ldMarcar(id: string, marcar: boolean) {
    const r = await API.rpc<{ ok: boolean; aviso: string | null }>('lista_dia_marcar', { p_id: id, p_marcar: marcar });
    if (r.error) { toast(r.error.message, 'error'); resolver(); return; }
    if (r.data?.aviso) toast(r.data.aviso, 'error'); else if (marcar) toast('Hecho');
    resolver();
  },
  async ldQuitar(id: string) {
    const r = await API.delete('lista_dia', { id: `eq.${id}` });
    if (r.error) { toast(`No se pudo quitar: ${r.error.message}`, 'error'); return; }
    toast('Quitado de la lista'); resolver();
  },
  async ldMover(id: string, persona: string) {
    const it = _items.find(x => x.id === id);
    if (!it || !persona || persona === it.usuario) return;
    const r = await API.patch('lista_dia', { id: `eq.${id}` }, { usuario: persona });
    if (r.error) { toast(`No se pudo pasar: ${r.error.message}`, 'error'); return; }
    await asignar(it.tipo, it.ref_id, persona, it.usuario);
    toast(`Pasado a ${persona}`); resolver();
  },
  async ldNota() {
    const campo = document.getElementById('ld-nota') as HTMLInputElement | null;
    const texto = campo?.value.trim() ?? '';
    if (!texto) { toast('Escribe primero el recado', 'error'); return; }
    if (!await anadirALista({ tipo: 'nota', persona: _persona, fecha: _fecha, titulo: texto })) { toast('No se pudo apuntar', 'error'); return; }
    toast('Apuntado'); resolver();
  },
  async ldAbrirAnadir() { await cargarCandidatos(); pintarCandidatos(); },
  ldFiltrarCands() { pintarCandidatos(); },
  async ldAlternar(tipo: Exclude<Tipo, 'nota'>, refId: string) {
    const dentro = _items.find(i => i.tipo === tipo && i.ref_id === refId && i.usuario === _persona);
    if (dentro) {
      const r = await API.delete('lista_dia', { id: `eq.${dentro.id}` });
      if (r.error) { toast('No se pudo quitar', 'error'); return; }
      _items = _items.filter(i => i !== dentro);
    } else {
      if (!await anadirALista({ tipo, refId, persona: _persona, fecha: _fecha })) { toast('No se pudo añadir', 'error'); return; }
      _items.push({ id: `nuevo-${refId}`, fecha: _fecha, usuario: _persona, tipo, ref_id: refId, titulo: null, orden: 0, completado: false, estado_previo: null });
    }
    pintarCandidatos();
  },
  // Trae lo que ya estaba programado para esa persona y ese día (no reasigna: ya es suyo).
  async ldTraer() {
    const [tr, ta, tk] = await Promise.all([
      API.get<any[]>('trabajos', { select: 'id,tecnicos', estado: `in.${ABIERTOS.trabajo}`, fecha_programada: `eq.${_fecha}`, limit: '200' }),
      API.get<any[]>('tareas', { select: 'id', estado: `in.${ABIERTOS.tarea}`, fecha_vencimiento: `eq.${_fecha}`, tecnico_id: `eq.${_persona}`, limit: '200' }),
      API.get<any[]>('tickets', { select: 'id', estado: `in.${ABIERTOS.ticket}`, tecnico_id: `eq.${_persona}`, limit: '50' }),
    ]);
    const nuevos = [...(tr.data ?? []).filter(r => (r.tecnicos ?? []).includes(_persona)).map(r => ({ tipo: 'trabajo' as const, id: r.id })),
      ...(ta.data ?? []).map(r => ({ tipo: 'tarea' as const, id: r.id })), ...(tk.data ?? []).map(r => ({ tipo: 'ticket' as const, id: r.id }))]
      .filter(p => !_items.some(i => i.tipo === p.tipo && i.ref_id === p.id && i.usuario === _persona));
    if (!nuevos.length) { toast('No hay nada nuevo asignado para ese día'); return; }
    for (const p of nuevos) await anadirALista({ tipo: p.tipo, refId: p.id, persona: _persona, fecha: _fecha, asignarlo: false });
    toast(`${nuevos.length} añadido${nuevos.length === 1 ? '' : 's'} a la lista`); resolver();
  },
  ldPlanPest(p: string) { location.hash = `#/lista-dia/planificar/${p}`; },
  ldPlanFecha(v: string) { if (v) location.hash = `#/lista-dia/planificar/fecha/${v}`; },
  async ldPlanMover(tipo: string, id: string, a: string) {
    const fecha = a === 'hoy' ? hoyStr() : a === 'manana' ? masDias(1) : masDias(7);
    const r = tipo === 'tarea' ? await API.patch('tareas', { id: `eq.${id}` }, { fecha_vencimiento: fecha }) : await trabajoADia(id, fecha);
    if (r.error) { toast(r.error.message, 'error'); return; }
    document.getElementById(`ld-p-${id}`)?.remove();
    toast(`Pasado a ${a === 'hoy' ? 'hoy' : a === 'manana' ? 'mañana' : 'la semana que viene'}`);
  },
  async ldTodoHoy() {
    const filas = [...document.querySelectorAll<HTMLElement>('.ld-fila [data-action="ldPlanMover"][data-p2="hoy"]')];
    for (const b of filas) {
      const { p0: tipo, p1: id } = b.dataset;
      await (tipo === 'tarea' ? API.patch('tareas', { id: `eq.${id}` }, { fecha_vencimiento: hoyStr() }) : trabajoADia(id!, hoyStr()));
    }
    toast(`${filas.length} pasado${filas.length === 1 ? '' : 's'} a hoy`); resolver();
  },
});
