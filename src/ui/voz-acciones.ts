// Ejecutor de las acciones del asistente de voz (paridad: ui/voice-actions.js
// de la app). Recibe lo que el modelo emite ([[ACCION]]{accion, datos}) y opera
// sobre el hub con las MISMAS piezas que las pantallas: el cliente de datos
// (deshacer, cola sin red), las funciones de la base que exigen el área y las
// rutas de las fichas. Cada acción devuelve:
//   { ok, mensaje (para decirlo), contexto? (lo que vuelve al historial del
//     modelo, p. ej. la lista numerada), resultados? (tarjetas), abrir? }
// Las reglas de búsqueda (estados dichos de palabra, local por nombre del local
// o del cliente, número de trabajo…) son las de la app. El espejo no tiene
// «embeds»: los nombres de sede y cliente salen de una caché aparte.
import { API } from '../core/api';
import { usuario } from '../core/estado';
import { deshacer, nuevaAccion } from '../core/deshacer';
import { remotosDe, type Remoto } from '../modulos/sitios/equipamiento';

export interface Resultado { tipo: 'trabajo' | 'tarea' | 'ticket' | 'presupuesto' | 'cliente' | 'local' | 'remoto' | 'lugar'; id: string; titulo: string; sub?: string; ruta?: string; localId?: string; remoto?: Remoto }
export interface Respuesta { ok: boolean; mensaje: string; contexto?: string; resultados?: Resultado[]; abrir?: Resultado }
export type Datos = Record<string, unknown>;

// ── Utilidades (las de la app) ──────────────────────────────────────────────
export const norm = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
// Un candidato vacío o de dos letras no vale: si no, hace de comodín.
export function nombreParecido(candidato: unknown, q: string) { const c = norm(candidato); return c.length >= 3 && !!q && (c.includes(q) || q.includes(c)); }
export const esNumero = (s: unknown) => { const m = String(s ?? '').trim().match(/^#?(\d+)$/); return m ? Number(m[1]) : null; };
export const limpiarTexto = (s: unknown) => String(s ?? '').replace(/[(),*%\\]/g, ' ').replace(/\s+/g, ' ').trim();
const like = (t: string) => `*${t}*`;
export const hoy = () => new Date().toLocaleDateString('sv-SE');
const fmtFecha = (d: string | null | undefined) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : '');
export const fmtDuracion = (min: number) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`; };

export interface Sede { id: string; nombre: string; direccion: string | null; cliente_id: string | null; cliente: string | null }
let _sedes: { at: number; lista: Sede[] } | null = null;
export async function sedes(): Promise<Sede[]> {
  if (_sedes && Date.now() - _sedes.at < 5 * 60_000) return _sedes.lista;
  const [ls, cs] = await Promise.all([
    API.fetchAll<any>('locales', { select: 'id,nombre,direccion,cliente_id', activo: 'eq.true', order: 'nombre' }),
    API.fetchAll<any>('clientes', { select: 'id,nombre', activo: 'eq.true' }),
  ]);
  const cli = new Map((cs.data ?? []).map(c => [c.id, c.nombre]));
  _sedes = { at: Date.now(), lista: (ls.data ?? []).map(l => ({ ...l, cliente: l.cliente_id ? cli.get(l.cliente_id) ?? null : null })) };
  return _sedes.lista;
}
export const olvidarSedes = () => { _sedes = null; };
/** El local más parecido por su nombre o por el de su cliente (resolverLocal de la app). */
export async function resolverLocal(nombre: unknown): Promise<Sede | null> {
  const q = norm(nombre);
  if (!q) return null;
  const ls = await sedes();
  return ls.find(l => norm(l.nombre) === q) ?? ls.find(l => nombreParecido(l.nombre, q)) ?? ls.find(l => nombreParecido(l.cliente, q)) ?? null;
}
const donde = (s: Sede[] | null, localId: string | null, clienteId: string | null) => {
  const l = localId ? s?.find(x => x.id === localId) : null;
  return l?.nombre ?? (clienteId ? s?.find(x => x.cliente_id === clienteId)?.cliente : null) ?? null;
};

// ── Estados dichos de palabra → filtros (los de la app) ─────────────────────
function filtroEstadoTrabajo(v: unknown) {
  const n = norm(v); if (!n) return null;
  if (n.includes('abiert') || n.includes('activ')) return 'in.(Pendiente,"En progreso")';
  if (n.includes('progreso') || n.includes('curso')) return 'eq.En progreso';
  if (n.includes('pendiente')) return 'eq.Pendiente';
  if (n.includes('para facturar') || n === 'facturar') return 'eq.Para facturar';
  if (n.includes('facturado')) return 'eq.Facturado';
  if (n.includes('completad') || n.includes('terminad') || n.includes('finalizad') || n.includes('hech')) return 'eq.Completado';
  if (n.includes('cancelad')) return 'eq.Cancelado';
  return null;
}
function filtroEstadoTarea(v: unknown) {
  const n = norm(v); if (!n) return null;
  if (n.includes('abiert') || n.includes('activ')) return 'in.(pendiente,en_progreso)';
  if (n.includes('progreso') || n.includes('curso')) return 'eq.en_progreso';
  if (n.includes('pendiente')) return 'eq.pendiente';
  if (n.includes('completad') || n.includes('terminad') || n.includes('hech')) return 'eq.completada';
  return null;
}
function filtroEstadoTicket(v: unknown) {
  const n = norm(v); if (!n) return null;
  if (n.includes('abiert') || n.includes('activ')) return 'in.(Abierto,"En curso",Pendiente)';
  if (n.includes('progreso') || n.includes('curso')) return 'eq.En curso';
  if (n.includes('cerrad') || n.includes('resuelt')) return 'eq.Cerrado';
  return null;
}
function filtroEstadoPresupuesto(v: unknown) {
  const n = norm(v); if (!n) return null;
  if (n.includes('borrador')) return 'eq.Borrador';
  if (n.includes('aceptad')) return 'eq.Aceptado';
  if (n.includes('pendiente') || n.includes('enviad')) return 'in.(Pendiente,Enviado)';
  return null;
}

// ── Búsquedas ───────────────────────────────────────────────────────────────
export const SEL_TRABAJO = 'id,numero,titulo,descripcion,materiales,estado,fecha_programada,tecnicos,cliente_id,local_id';
export async function mapTrabajos(filas: any[]): Promise<Resultado[]> {
  const s = await sedes();
  return filas.map(t => ({ tipo: 'trabajo', id: t.id, ruta: `#/trabajos/${t.numero ?? t.id}`,
    titulo: `${t.numero ? `#${t.numero} · ` : ''}${t.titulo || String(t.descripcion || 'Trabajo').slice(0, 60)}`,
    sub: [donde(s, t.local_id, t.cliente_id), t.estado, fmtFecha(t.fecha_programada)].filter(Boolean).join(' · ') }));
}
export async function mapTareas(filas: any[]): Promise<Resultado[]> {
  const s = await sedes();
  return filas.map(t => ({ tipo: 'tarea', id: t.id, ruta: `#/tareas/${t.id}`,
    titulo: `${t.numero ? `#${t.numero} · ` : ''}${t.titulo || String(t.descripcion || 'Tarea').slice(0, 60)}`,
    sub: [donde(s, t.local_id, t.cliente_id), t.estado, fmtFecha(t.fecha_vencimiento)].filter(Boolean).join(' · ') }));
}
async function filtroLocal(d: Datos, params: Record<string, string>) {
  if (!d.local) return true;
  const l = await resolverLocal(d.local);
  if (l) { params.local_id = `eq.${l.id}`; return true; }
  return false;
}

async function buscarTrabajos(d: Datos): Promise<Resultado[]> {
  const p: Record<string, string> = { select: SEL_TRABAJO, order: 'fecha_programada.desc.nullslast', limit: '8' };
  const num = esNumero(d.texto), txt = num ? '' : limpiarTexto(d.texto);
  if (num) p.numero = `eq.${num}`;
  else if (txt) p.or = `(descripcion.ilike.${like(txt)},titulo.ilike.${like(txt)},materiales.ilike.${like(txt)})`;
  const est = filtroEstadoTrabajo(d.estado); if (est) p.estado = est;
  if (d.fecha) p.fecha_programada = `eq.${d.fecha}`;
  if (!(await filtroLocal(d, p)) && !p.or && !num) { const t2 = limpiarTexto(d.local); if (t2) p.or = `(descripcion.ilike.${like(t2)},titulo.ilike.${like(t2)})`; }
  return mapTrabajos((await API.get<any[]>('trabajos', p)).data ?? []);
}
async function buscarTareas(d: Datos): Promise<Resultado[]> {
  const p: Record<string, string> = { select: 'id,numero,titulo,descripcion,estado,prioridad,fecha_vencimiento,cliente_id,local_id', order: 'created_at.desc', limit: '8' };
  const txt = limpiarTexto(d.texto);
  if (txt) p.or = `(titulo.ilike.${like(txt)},descripcion.ilike.${like(txt)},notas.ilike.${like(txt)})`;
  p.estado = filtroEstadoTarea(d.estado) ?? 'neq.archivada';
  if (d.fecha) p.fecha_vencimiento = `eq.${d.fecha}`;
  await filtroLocal(d, p);
  return mapTareas((await API.get<any[]>('tareas', p)).data ?? []);
}
export async function mapTickets(filas: any[]): Promise<Resultado[]> {
  const s = await sedes();
  return filas.map(t => ({ tipo: 'ticket' as const, id: t.id, ruta: `#/tickets/${t.numero}`, titulo: `#${t.numero} · ${t.titulo || 'Ticket'}`, sub: [donde(s, t.local_id, t.cliente_id), t.estado].filter(Boolean).join(' · ') }));
}
async function buscarTickets(d: Datos): Promise<Resultado[]> {
  const p: Record<string, string> = { select: 'id,numero,titulo,estado,cliente_id,local_id', order: 'created_at.desc', limit: '8' };
  const num = esNumero(d.texto), txt = num ? '' : limpiarTexto(d.texto);
  if (num) p.numero = `eq.${num}`; else if (txt) p.or = `(titulo.ilike.${like(txt)},descripcion.ilike.${like(txt)})`;
  const est = filtroEstadoTicket(d.estado); if (est) p.estado = est;
  await filtroLocal(d, p);
  return mapTickets((await API.get<any[]>('tickets', p)).data ?? []);
}
async function buscarPresupuestos(d: Datos): Promise<Resultado[]> {
  const p: Record<string, string> = { select: 'id,titulo,exigencias,estado,total,cliente_id,local_id', order: 'created_at.desc', limit: '8' };
  const txt = limpiarTexto(d.texto); if (txt) p.or = `(titulo.ilike.${like(txt)},exigencias.ilike.${like(txt)})`;
  const est = filtroEstadoPresupuesto(d.estado); if (est) p.estado = est;
  await filtroLocal(d, p);
  const s = await sedes();
  return ((await API.get<any[]>('presupuestos', p)).data ?? []).map(x => ({ tipo: 'presupuesto' as const, id: x.id, ruta: `#/presupuestos/${x.id}`, titulo: x.titulo || 'Presupuesto',
    sub: [donde(s, x.local_id, x.cliente_id), x.estado, x.total ? `${Number(x.total).toLocaleString('es-ES', { minimumFractionDigits: 2 })} €` : null].filter(Boolean).join(' · ') }));
}
async function buscarClientes(d: Datos): Promise<Resultado[]> {
  const p: Record<string, string> = { select: 'id,nombre,nif,telefono', activo: 'eq.true', order: 'nombre', limit: '8' };
  const txt = limpiarTexto(d.texto || d.local); if (txt) p.or = `(nombre.ilike.${like(txt)},nif.ilike.${like(txt)})`;
  return ((await API.get<any[]>('clientes', p)).data ?? []).map(c => ({ tipo: 'cliente' as const, id: c.id, ruta: `#/clientes/${c.id}`, titulo: c.nombre, sub: [c.nif, c.telefono].filter(Boolean).join(' · ') }));
}
async function buscarLocales(d: Datos): Promise<Resultado[]> {
  const q = norm(limpiarTexto(d.texto || d.local)), ls = await sedes();
  return (q ? ls.filter(l => norm(l.nombre).includes(q) || norm(l.cliente).includes(q) || norm(l.direccion).includes(q)) : ls).slice(0, 8)
    .map(l => ({ tipo: 'local' as const, id: l.id, ruta: `#/sitios/${l.id}`, titulo: l.nombre, sub: [l.cliente, l.direccion].filter(Boolean).join(' · ') }));
}

export const ETIQUETA: Record<string, string> = { trabajo: 'Trabajo', tarea: 'Tarea', ticket: 'Ticket', presupuesto: 'Presupuesto', cliente: 'Cliente', local: 'Local' };
export const lista = (rs: Resultado[]) => rs.map(r => `- ${ETIQUETA[r.tipo] ?? ''} ${r.titulo}${r.sub ? ` (${r.sub})` : ''}`).join('\n');

async function buscar(d: Datos): Promise<Respuesta> {
  const tipo = norm(d.tipo);
  let rs: Resultado[];
  if (tipo.startsWith('trabajo')) rs = await buscarTrabajos(d);
  else if (tipo.startsWith('tarea')) rs = await buscarTareas(d);
  else if (tipo.startsWith('ticket')) rs = await buscarTickets(d);
  else if (tipo.startsWith('presupuesto')) rs = await buscarPresupuestos(d);
  else if (tipo.startsWith('cliente')) rs = await buscarClientes(d);
  else if (tipo.startsWith('local') || tipo.startsWith('sitio') || tipo.startsWith('sede')) rs = await buscarLocales(d);
  else rs = (await Promise.all([buscarTrabajos(d), buscarTareas(d), buscarTickets(d), buscarPresupuestos(d), buscarClientes(d), buscarLocales(d)])).flat().slice(0, 12);
  if (!rs.length) return { ok: true, mensaje: 'No he encontrado nada con esos datos. Prueba con otras palabras.', contexto: 'Búsqueda sin resultados.' };
  return { ok: true, resultados: rs, contexto: `Resultados de la búsqueda:\n${lista(rs)}`,
    mensaje: rs.length === 1 ? `He encontrado un resultado: ${rs[0].titulo}. Lo tienes en pantalla, toca para abrirlo.` : `He encontrado ${rs.length} resultados. Te los muestro en pantalla; toca uno para abrirlo.` };
}

async function abrir(d: Datos): Promise<Respuesta> {
  const r = await buscar(d);
  if (!r.resultados?.length) return { ok: false, mensaje: `No he encontrado «${String(d.texto ?? d.local ?? '')}». ¿Puedes decírmelo de otra forma?` };
  if (r.resultados.length === 1) { const x = r.resultados[0]; return { ok: true, mensaje: `Abriendo ${x.titulo}.`, contexto: `Abierto: ${ETIQUETA[x.tipo]} ${x.titulo}.`, resultados: [x], abrir: x }; }
  return { ...r, mensaje: `He encontrado ${r.resultados.length} coincidencias. Dime cuál, o toca la que quieras.` };
}

// ── Control remoto (AnyDesk y RustDesk de la sede) ──────────────────────────
async function controlRemoto(d: Datos): Promise<Respuesta> {
  const nombre = String(d.local ?? d.texto ?? '').trim();
  if (!nombre) return { ok: false, mensaje: '¿De qué sitio quieres abrir el control remoto?' };
  const l = await resolverLocal(nombre);
  if (!l) return { ok: false, mensaje: `No he encontrado el sitio «${nombre}». ¿Puedes decírmelo de otra forma?` };
  const equipos = await remotosDe(l.id);
  if (!equipos.length) return { ok: false, mensaje: `${l.nombre} no tiene ningún AnyDesk ni RustDesk guardado. Puedes apuntarlo en la ficha del sitio.`, contexto: `${l.nombre} no tiene acceso remoto guardado.` };
  let cand = equipos;
  const pista = String(d.equipo ?? '').trim();
  if (pista && equipos.length > 1) { const q = norm(pista); const f = equipos.filter(e => nombreParecido(e.nombre, q) || e.id === pista.replace(/\s+/g, '')); if (f.length) cand = f; }
  const res = cand.map(e => ({ tipo: 'remoto' as const, id: e.id, titulo: e.nombre || `Equipo ${e.id}`, sub: [l.nombre, `${e.tipo === 'rustdesk' ? 'RustDesk' : 'AnyDesk'} ${e.id}`].join(' · '), localId: l.id, remoto: e }));
  if (res.length > 1) return { ok: true, resultados: res, mensaje: `${l.nombre} tiene ${res.length} equipos con acceso remoto. Dime cuál, o toca el que quieras.`, contexto: `Equipos con acceso remoto de ${l.nombre}:\n${res.map(r => `- ${r.titulo} (${r.sub})`).join('\n')}` };
  return { ok: true, resultados: res, abrir: res[0], mensaje: `Abriendo el control remoto de ${l.nombre}, ${res[0].titulo}.`, contexto: `Abierto el control remoto de ${l.nombre} (${res[0].sub}).` };
}

// ── Resúmenes ───────────────────────────────────────────────────────────────
async function trabajosDelDia(dia: string): Promise<any[]> {
  const d0 = new Date(`${dia}T00:00:00`), d1 = new Date(d0.getTime() + 86_400_000);
  const ag = await API.get<any[]>('agenda', { select: 'trabajo_id', trabajo_id: 'not.is.null', inicio: `lt.${d1.toISOString()}`, fin: `gt.${d0.toISOString()}`, limit: '200' });
  const ids = [...new Set((ag.data ?? []).map(b => b.trabajo_id))];
  const or: Record<string, string> = ids.length ? { or: `(fecha_programada.eq.${dia},id.in.(${ids.join(',')}))` } : { fecha_programada: `eq.${dia}` };
  return (await API.get<any[]>('trabajos', { select: SEL_TRABAJO, estado: 'in.(Pendiente,"En progreso")', ...or, order: 'fecha_programada', limit: '20' })).data ?? [];
}
async function resumenDia(fecha: unknown): Promise<Respuesta> {
  const dia = typeof fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : hoy();
  const [tr, ta] = await Promise.all([trabajosDelDia(dia),
    API.get<any[]>('tareas', { select: 'id,numero,titulo,descripcion,estado,fecha_vencimiento,cliente_id,local_id', estado: 'in.(pendiente,en_progreso)', fecha_vencimiento: `eq.${dia}`, limit: '20' })]);
  const rs = [...await mapTrabajos(tr), ...await mapTareas(ta.data ?? [])];
  const cuando = dia === hoy() ? 'hoy' : `el ${fmtFecha(dia)}`;
  if (!rs.length) return { ok: true, mensaje: `No tienes nada planificado para ${cuando}.`, contexto: `Sin trabajos ni tareas ${cuando}.` };
  const nT = tr.length, nTa = (ta.data ?? []).length;
  const partes = [nT ? `${nT} trabajo${nT > 1 ? 's' : ''}` : null, nTa ? `${nTa} tarea${nTa > 1 ? 's' : ''}` : null].filter(Boolean);
  return { ok: true, resultados: rs, mensaje: `Para ${cuando} tienes ${partes.join(' y ')}. Te los pongo en pantalla.`, contexto: `Plan de ${cuando}:\n${lista(rs)}` };
}
async function resumenHoras(): Promise<Respuesta> {
  const yo = usuario();
  if (!yo?.id) return { ok: false, mensaje: 'No sé quién eres para contar tus horas.' };
  const ahora = new Date(), dia0 = new Date(ahora); dia0.setHours(0, 0, 0, 0);
  const lunes = new Date(dia0); lunes.setDate(lunes.getDate() - ((lunes.getDay() + 6) % 7));
  const { data } = await API.get<any[]>('sesiones', { select: 'inicio,fin,duracion_min', tecnico_id: `eq.${yo.id}`, inicio: `gte.${lunes.toISOString()}`, order: 'inicio' });
  const ses = data ?? [];
  const min = (s: any) => s.duracion_min || (s.inicio ? Math.round(((s.fin ? new Date(s.fin).getTime() : ahora.getTime()) - new Date(s.inicio).getTime()) / 60000) : 0);
  const total = (desde: Date) => ses.filter(s => s.inicio && new Date(s.inicio) >= desde).reduce((a, s) => a + min(s), 0);
  const h = total(dia0), sem = total(lunes);
  if (!sem) return { ok: true, mensaje: 'Esta semana no tienes horas fichadas todavía.', contexto: 'Sin sesiones esta semana.' };
  return { ok: true, mensaje: `Hoy llevas ${fmtDuracion(h)} y esta semana ${fmtDuracion(sem)}.${ses.some(s => s.inicio && !s.fin) ? ' Tienes una sesión abierta ahora mismo.' : ''}`,
    contexto: `Horas fichadas: hoy ${h} minutos, semana ${sem} minutos.` };
}
async function resumenPendientes(d: Datos): Promise<Respuesta> {
  const pT: Record<string, string> = { select: SEL_TRABAJO, estado: 'in.(Pendiente,"En progreso")', order: 'fecha_programada.nullslast', limit: '10' };
  const pA: Record<string, string> = { select: 'id,numero,titulo,descripcion,estado,fecha_vencimiento,cliente_id,local_id', estado: 'in.(pendiente,en_progreso)', order: 'fecha_vencimiento.nullslast', limit: '10' };
  let en = '';
  if (d.local) {
    const l = await resolverLocal(d.local);
    if (!l) return { ok: false, mensaje: `No he encontrado el local «${String(d.local)}».` };
    pT.local_id = pA.local_id = `eq.${l.id}`; en = ` en ${l.nombre}`;
  }
  const [tr, ta] = await Promise.all([API.get<any[]>('trabajos', pT), API.get<any[]>('tareas', pA)]);
  const rs = [...await mapTrabajos(tr.data ?? []), ...await mapTareas(ta.data ?? [])];
  if (!rs.length) return { ok: true, mensaje: `No queda nada pendiente${en}.`, contexto: `Sin pendientes${en}.` };
  return { ok: true, resultados: rs, mensaje: `Quedan ${rs.length} cosas pendientes${en}. Te las pongo en pantalla.`, contexto: `Pendientes${en}:\n${lista(rs)}` };
}
async function resumen(d: Datos): Promise<Respuesta> {
  const q = norm(d.que);
  if (q.startsWith('hora') || q.includes('fichad')) return resumenHoras();
  if (q.startsWith('pendiente') || q.includes('abiert')) return resumenPendientes(d);
  return resumenDia(d.fecha);
}

async function deshacerUltimo(): Promise<Respuesta> {
  const r = await deshacer();
  if (!r.ok) return { ok: false, mensaje: r.mensaje === 'No hay nada que deshacer' ? 'No tengo nada reciente que deshacer.' : `${r.mensaje}.` };
  window.dispatchEvent(new Event('hashchange'));   // la pantalla de delante vuelve a leer
  return { ok: true, mensaje: `Hecho, ${r.mensaje.charAt(0).toLowerCase()}${r.mensaje.slice(1)}.`, contexto: `Deshecha la última acción (${r.mensaje}).` };
}

// Las que llegan en las tandas siguientes (órdenes directas y altas).
const OTRAS: Record<string, (d: Datos) => Promise<Respuesta>> = {};
export function registrarAccionesVoz(mas: Record<string, (d: Datos) => Promise<Respuesta>>) { Object.assign(OTRAS, mas); }

/** Ejecuta una acción del asistente. Cada orden es una acción nueva del deshacer. */
export async function ejecutarAccion(accion: string, datos: Datos = {}): Promise<Respuesta> {
  try {
    if (accion !== 'deshacer') nuevaAccion();
    switch (accion) {
      case 'buscar': return await buscar(datos);
      case 'abrir': return await abrir(datos);
      case 'resumen': return await resumen(datos);
      case 'control_remoto': return await controlRemoto(datos);
      case 'deshacer': return await deshacerUltimo();
    }
    if (!OTRAS[accion]) await import('./voz-ordenes');   // las órdenes directas se cargan al primer uso
    if (OTRAS[accion]) return await OTRAS[accion](datos);
    return { ok: false, mensaje: 'Eso todavía no lo hago desde el hub: hazlo desde su pantalla.', contexto: `La acción ${accion} aún no está disponible en el hub.` };
  } catch (e) {
    console.error('[voz-acciones]', e);
    return { ok: false, mensaje: 'Hubo un error al ejecutar la acción. Inténtalo de nuevo.' };
  }
}
