// Asistente de voz → ÓRDENES DIRECTAS (paridad: voice-actions.js de la app,
// tanda 2): fichar, cambiar estado, programar o mover un día, cita suelta,
// gasto, nota del tablero, escribir la descripción de un trabajo y la comanda
// para el equipo (esta, del hub). Se ejecutan al momento, sin confirmar (las
// dicta alguien andando) y se cuentan después. Van por las MISMAS piezas que
// las pantallas: hub.fichar, hub.trabajo_estado, hub.agenda_mover y el cliente
// de datos (deshacer, cola sin red). Lo que aún es de la app lo dice: antes de
// escribir en un área se pregunta `esDelHub` (un PATCH que la RLS no deja pasar
// no da error, solo no cambia nada).
import { API } from '../core/api';
import { usuario } from '../core/estado';
import { esDelHub } from '../core/areas';
import { llamarFuncion } from '../core/funciones';
import {
  type Datos, type Respuesta, type Resultado, registrarAccionesVoz, norm, esNumero, limpiarTexto, resolverLocal, hoy, fmtDuracion,
  SEL_TRABAJO, mapTrabajos, mapTareas, mapTickets, ETIQUETA, lista,
} from './voz-acciones';

type Tipo = 'trabajo' | 'tarea' | 'ticket';
const ENTIDADES: Record<Tipo, { tabla: string; col: string; select: string; abiertos: string; orden: string; texto: string[]; mapa: (f: any[]) => Promise<Resultado[]> }> = {
  trabajo: { tabla: 'trabajos', col: 'trabajo_id', select: SEL_TRABAJO, abiertos: 'in.(Pendiente,"En progreso")', orden: 'fecha_programada.desc.nullslast', texto: ['titulo', 'descripcion'], mapa: mapTrabajos },
  tarea: { tabla: 'tareas', col: 'tarea_id', select: 'id,numero,titulo,descripcion,estado,fecha_vencimiento,tecnico_id,cliente_id,local_id', abiertos: 'in.(pendiente,en_progreso)', orden: 'created_at.desc', texto: ['titulo', 'descripcion'], mapa: mapTareas },
  ticket: { tabla: 'tickets', col: 'ticket_id', select: 'id,numero,titulo,estado,tecnico_id,cliente_id,local_id', abiertos: 'in.(Abierto,"En curso",Pendiente)', orden: 'created_at.desc', texto: ['titulo', 'descripcion'], mapa: mapTickets },
};
const tipoEntidad = (v: unknown): Tipo => { const n = norm(v); return n.startsWith('tarea') ? 'tarea' : n.startsWith('ticket') || n.startsWith('aviso') ? 'ticket' : 'trabajo'; };
const like = (t: string) => `*${t}*`;
const refrescar = () => window.dispatchEvent(new Event('hashchange'));   // la pantalla de delante vuelve a leer
const enLaApp = (que: string): Respuesta => ({ ok: false, mensaje: `${que} todavía se hace en la app: hazlo allí.`, contexto: `${que}: todavía es de la app; no se ha hecho nada.` });
const fmtFecha = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
const euros = (n: number) => { const v = Math.round(n * 100) / 100, e = Math.trunc(v), c = Math.round((v - e) * 100); return c ? `${e} con ${String(c).padStart(2, '0')}` : `${e}`; };   // se HABLA
const isoDe = (fecha: string, hora: string, min = 0) => { const [h, m] = (hora || '09:00').split(':').map(Number); const d = new Date(`${fecha}T00:00:00`); d.setHours(h || 0, m || 0, 0, 0); if (min) d.setMinutes(d.getMinutes() + min); return d.toISOString(); };
const horaDe = (iso: string) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

// Por número, por local (prefiriendo los abiertos) o por texto (localizarEntidad de la app).
async function localizar(tipo: Tipo, ref: string): Promise<any[]> {
  const c = ENTIDADES[tipo];
  const num = esNumero(ref);
  if (num) return (await API.get<any[]>(c.tabla, { select: c.select, numero: `eq.${num}`, limit: '2' })).data ?? [];
  if (!ref) return [];
  const l = await resolverLocal(ref);
  if (l) {
    const base = { select: c.select, local_id: `eq.${l.id}`, order: c.orden, limit: '5' };
    const ab = (await API.get<any[]>(c.tabla, { ...base, estado: c.abiertos })).data ?? [];
    return ab.length ? ab : (await API.get<any[]>(c.tabla, base)).data ?? [];
  }
  const t = limpiarTexto(ref);
  if (!t) return [];
  return (await API.get<any[]>(c.tabla, { select: c.select, or: `(${c.texto.map(x => `${x}.ilike.${like(t)}`).join(',')})`, order: c.orden, limit: '5' })).data ?? [];
}
async function una(tipo: Tipo, ref: string, verbo: string): Promise<{ e?: any; fallo?: Respuesta }> {
  const cs = await localizar(tipo, ref);
  if (!cs.length) return { fallo: { ok: false, mensaje: `No he encontrado ${ETIQUETA[tipo].toLowerCase()} «${ref}». Dime su número o el nombre del local.` } };
  if (cs.length > 1) {
    const rs = await ENTIDADES[tipo].mapa(cs);
    return { fallo: { ok: false, resultados: rs, mensaje: `He encontrado ${cs.length}. Dime el número del que quieres ${verbo}.`, contexto: `Candidatos:\n${lista(rs)}` } };
  }
  return { e: cs[0] };
}
const ref = (d: Datos) => String(d.referencia ?? d.trabajo ?? d.local ?? '').trim();

// ── Fichar (la MISMA hub.fichar que «Hoy» y el reloj) ──────────────────────
async function fichar(d: Datos): Promise<Respuesta> {
  const que = norm(d.que ?? d.accion);
  if (que.startsWith('traslad') || que.includes('camino')) {
    const r = await API.rpc('fichar', { p_accion: 'traslado' });
    return r.error ? { ok: false, mensaje: r.error.message } : { ok: true, mensaje: 'Traslado iniciado. Avísame cuando llegues.' };
  }
  if (que.startsWith('fin') || que.includes('termin') || que.includes('acab')) {
    const r = await API.rpc<{ sesion?: { duracion_min?: number } }>('fichar', { p_accion: 'fin' });
    if (r.error) return { ok: false, mensaje: r.error.message };
    const min = Number(r.data?.sesion?.duracion_min ?? 0);
    refrescar();
    return { ok: true, mensaje: `Fin registrado.${min ? ` Has estado ${fmtDuracion(min)}.` : ''}`, contexto: `Sesión cerrada, duración ${min} minutos.` };
  }
  const tipo = tipoEntidad(d.tipo), r0 = ref(d);
  if (!r0) {
    const { data } = await API.get<any[]>('sesiones', { select: 'traslado,inicio', tecnico_id: `eq.${usuario()?.id ?? ''}`, fin: 'is.null', order: 'created_at.desc', limit: '1' });
    return { ok: false, mensaje: data?.[0]?.traslado && !data[0].inicio ? 'Estás en traslado. Dime en qué trabajo empiezas: su número o el local.' : '¿En qué trabajo empiezas? Dime el número o el nombre del local.' };
  }
  const { e, fallo } = await una(tipo, r0, 'empezar');
  if (fallo) return fallo;
  const r = await API.rpc<{ cerrada?: unknown }>('fichar', { p_accion: 'inicio', p_tipo: tipo, p_id: e.id });
  if (r.error) return { ok: false, mensaje: r.error.message };
  const [res] = await ENTIDADES[tipo].mapa([e]);
  refrescar();
  return { ok: true, resultados: [res], mensaje: `Inicio registrado en ${res.titulo}.${r.data?.cerrada ? ' He cerrado la sesión que tenías abierta.' : ''}`,
    contexto: `Fichado inicio en ${ETIQUETA[tipo]} ${res.titulo}. Queda en estado «en progreso».` };
}

// ── Estados («márcalo como hecho» → el estado de cada tabla) ───────────────
function normaEstado(tipo: Tipo, v: unknown): string | null {
  const n = norm(v); if (!n) return null;
  if (tipo === 'tarea') {
    if (n.includes('complet') || n.includes('termin') || n.includes('hech') || n.includes('finaliz')) return 'completada';
    if (n.includes('progreso') || n.includes('curso') || n.includes('empez')) return 'en_progreso';
    if (n.includes('pendiente')) return 'pendiente';
    if (n.includes('archiv')) return 'archivada';
    return null;
  }
  if (tipo === 'ticket') {
    if (n.includes('cerrad') || n.includes('resuelt') || n.includes('hech')) return 'Cerrado';
    if (n.includes('curso') || n.includes('progreso')) return 'En curso';
    if (n.includes('pendiente')) return 'Pendiente';
    if (n.includes('abiert')) return 'Abierto';
    return null;
  }
  if (n.includes('para facturar') || n === 'facturar') return 'Para facturar';
  if (n.includes('no facturar')) return 'No facturar';
  if (n.includes('facturad')) return 'Facturado';
  if (n.includes('complet') || n.includes('termin') || n.includes('hech') || n.includes('finaliz')) return 'Completado';
  if (n.includes('progreso') || n.includes('curso') || n.includes('empez')) return 'En progreso';
  if (n.includes('pendiente')) return 'Pendiente';
  if (n.includes('cancel') || n.includes('anul')) return 'Cancelado';
  return null;
}
async function cambiarEstado(d: Datos): Promise<Respuesta> {
  const tipo = tipoEntidad(d.tipo), estado = normaEstado(tipo, d.estado);
  if (!estado) return { ok: false, mensaje: '¿A qué estado lo paso?' };
  const { e, fallo } = await una(tipo, ref(d), 'cambiar');
  if (fallo) return fallo;
  let extra = '';
  if (tipo === 'trabajo') {
    // hub.trabajo_estado: exige fichaje para completar y cierra los tickets del trabajo (lo de la app).
    const r = await API.rpc('trabajo_estado', { p_id: e.id, p_estado: estado });
    if (r.error) return { ok: false, mensaje: /fich/i.test(r.error.message) ? 'Ese trabajo no tiene inicio y fin fichados. Marca primero el fin y lo completo.' : r.error.message };
    if (estado === 'Completado') extra = ' Si quieres lo dejo para facturar, dímelo.';
  } else {
    if (!(await esDelHub(ENTIDADES[tipo].tabla))) return enLaApp(tipo === 'tarea' ? 'Cambiar el estado de una tarea' : 'Cambiar el estado de un ticket');
    const r = await API.patch(ENTIDADES[tipo].tabla, { id: `eq.${e.id}` }, { estado });
    if (r.error) return { ok: false, mensaje: 'No pude cambiar el estado. Inténtalo de nuevo.' };
  }
  const [res] = await ENTIDADES[tipo].mapa([{ ...e, estado }]);
  refrescar();
  return { ok: true, resultados: [res], mensaje: `Hecho. ${res.titulo} queda en ${estado}.${extra}`, contexto: `${ETIQUETA[tipo]} ${res.titulo} cambiado al estado «${estado}».` };
}

// ── Agenda: programar o mover un día, cita suelta ──────────────────────────
async function programar(d: Datos): Promise<Respuesta> {
  const fecha = String(d.fecha ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { ok: false, mensaje: '¿Para qué día lo pongo?' };
  if (!(await esDelHub('agenda'))) return enLaApp('La agenda');
  const tipo = tipoEntidad(d.tipo);
  const { e, fallo } = await una(tipo, ref(d), 'programar');
  if (fallo) return fallo;
  const c = ENTIDADES[tipo];
  const bloques = (await API.get<any[]>('agenda', { select: 'id,inicio,fin,tecnicos', [c.col]: `eq.${e.id}`, order: 'inicio' })).data ?? [];
  const m = norm(d.modo), anadir = m.startsWith('anad') || m.includes('otro');
  const previo = bloques.find(b => String(b.inicio).slice(0, 10) >= hoy()) ?? bloques[bloques.length - 1] ?? null;
  const dur = Number(d.duracion) > 0 ? Number(d.duracion) : previo && !anadir ? Math.max(15, Math.round((new Date(previo.fin).getTime() - new Date(previo.inicio).getTime()) / 60000)) : 60;
  const hora = typeof d.hora === 'string' && /^\d{1,2}:\d{2}$/.test(d.hora) ? d.hora : previo && !anadir ? horaDe(previo.inicio) : '09:00';
  const inicio = isoDe(fecha, hora), fin = isoDe(fecha, hora, dur);
  const tecnico = String(d.tecnico ?? '').trim();
  const mover = !anadir && previo;
  if (mover) {
    const tecs = tecnico ? [...new Set([...(previo.tecnicos ?? []), tecnico])] : null;
    const r = await API.rpc('agenda_mover', { p_id: previo.id, p_inicio: inicio, p_fin: fin, ...(tecs ? { p_tecnicos: tecs } : {}) });
    if (r.error) return { ok: false, mensaje: r.error.message };
  } else {
    const r = await API.post('agenda', { [c.col]: e.id, inicio, fin, tecnicos: tecnico ? [tecnico] : null });
    if (r.error) return { ok: false, mensaje: 'No pude guardar la programación. Inténtalo de nuevo.' };
  }
  // El técnico se AÑADE al trabajo (como meterlo en su lista del día); a tarea y ticket se le asigna.
  if (tecnico && await esDelHub(c.tabla)) {
    if (tipo === 'trabajo') { const ya: string[] = Array.isArray(e.tecnicos) ? e.tecnicos : []; if (!ya.includes(tecnico)) await API.patch('trabajos', { id: `eq.${e.id}` }, { tecnicos: [...ya, tecnico] }); }
    else await API.patch(c.tabla, { id: `eq.${e.id}` }, { tecnico_id: tecnico });
  }
  const [res] = await c.mapa([e]);
  refrescar();
  const cuando = `${fmtFecha(fecha)} a las ${hora}`;
  return { ok: true, resultados: [res], mensaje: `${mover ? `Movido. ${res.titulo} queda el ${cuando}.` : `Añadido. ${res.titulo} tiene otro día el ${cuando}.`}${tecnico ? ` Va ${tecnico}.` : ''}`,
    contexto: `${ETIQUETA[tipo]} ${res.titulo} programado el ${fecha} a las ${hora} (${dur} minutos)${tecnico ? ` con ${tecnico}` : ''}.` };
}
async function crearEvento(d: Datos): Promise<Respuesta> {
  const titulo = String(d.titulo ?? d.descripcion ?? '').trim(), fecha = String(d.fecha ?? '');
  if (!titulo) return { ok: false, mensaje: '¿Qué apunto en el calendario?' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { ok: false, mensaje: '¿Qué día la pongo?' };
  if (!(await esDelHub('agenda'))) return enLaApp('La agenda');
  const hora = typeof d.hora === 'string' && /^\d{1,2}:\d{2}$/.test(d.hora) ? d.hora : '09:00', dur = Number(d.duracion) > 0 ? Number(d.duracion) : 60;
  const r = await API.post('agenda', { titulo, inicio: isoDe(fecha, hora), fin: isoDe(fecha, hora, dur), notas: d.notas ? String(d.notas) : null, todo_el_dia: false });
  if (r.error) return { ok: false, mensaje: 'No pude crear la cita. Inténtalo de nuevo.' };
  refrescar();
  return { ok: true, mensaje: `Apuntado: ${titulo}, el ${fmtFecha(fecha)} a las ${hora}.` };
}

// ── Gasto y nota ────────────────────────────────────────────────────────────
function normaCategoria(v: unknown) {
  const n = norm(v);
  if (n.includes('material') || n.includes('pieza') || n.includes('recambio')) return 'Material';
  if (n.includes('herramient') || n.includes('equipo')) return 'Herramienta';
  return 'Otro';
}
async function apuntarGasto(d: Datos): Promise<Respuesta> {
  const importe = parseFloat(String(d.importe ?? '').replace(',', '.'));
  if (!(importe > 0)) return { ok: false, mensaje: '¿De cuánto es el gasto?' };
  if (!(await esDelHub('gastos'))) return enLaApp('Apuntar gastos');
  let local_id: string | null = null, trabajo_id: string | null = null, donde = '';
  if (d.trabajo) { const { e } = await una('trabajo', String(d.trabajo), 'apuntar el gasto'); if (e) { trabajo_id = e.id; local_id = e.local_id ?? null; donde = ` en ${(await mapTrabajos([e]))[0].titulo}`; } }
  if (!trabajo_id && d.local) { const l = await resolverLocal(d.local); if (l) { local_id = l.id; donde = ` en ${l.nombre}`; } }
  const categoria = normaCategoria(d.categoria), fecha = typeof d.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.fecha) ? d.fecha : hoy();
  const r = await API.post('gastos', { tipo: 'gasto', importe, fecha, categoria, notas: String(d.concepto ?? d.notas ?? '').trim() || null, trabajo_id, local_id, tecnico_id: usuario()?.nombre ?? null });
  if (r.error) return { ok: false, mensaje: 'No pude guardar el gasto. Inténtalo de nuevo.' };
  refrescar();
  return { ok: true, mensaje: `Gasto apuntado: ${euros(importe)} euros de ${categoria.toLowerCase()}${donde}.`,
    contexto: `Gasto de ${importe} € (${categoria})${donde} guardado el ${fecha}. La foto del ticket se sube desde Personas → Gastos.` };
}
async function apuntarNota(d: Datos): Promise<Respuesta> {
  const texto = String(d.texto ?? '').trim();
  let titulo = String(d.titulo ?? '').trim();
  if (!texto && !titulo) return { ok: false, mensaje: '¿Qué apunto en la nota?' };
  if (!titulo) { const p = texto.split('\n')[0]; titulo = p.length > 60 ? `${p.slice(0, 60).trimEnd()}…` : p; }
  if (!(await esDelHub('tablero_notas'))) return enLaApp('Las notas del tablero');
  const r = await API.post('tablero_notas', { titulo, descripcion: texto || null, user_id: usuario()?.id });
  if (r.error) return { ok: false, mensaje: 'No pude guardar la nota. Inténtalo de nuevo.' };
  refrescar();
  return { ok: true, mensaje: `Nota apuntada: ${titulo}.`, contexto: `Nota guardada en el tablero — título: «${titulo}»${texto ? `, contenido: «${texto}»` : ''}.` };
}

// ── Descripción o materiales de un trabajo ─────────────────────────────────
async function actualizarDescripcion(d: Datos): Promise<Respuesta> {
  const texto = String(d.texto ?? '').trim();
  if (!texto) return { ok: false, mensaje: '¿Qué texto quieres que escriba?' };
  if (!(await esDelHub('trabajos'))) return enLaApp('Escribir en un trabajo');
  const r0 = String(d.trabajo ?? d.local ?? '').trim();
  const cs = await localizar('trabajo', r0);
  if (!cs.length) return { ok: false, mensaje: `No he encontrado el trabajo «${r0}». Dime su número o el nombre del local.` };
  if (cs.length > 1) { const rs = await mapTrabajos(cs); return { ok: false, resultados: rs, mensaje: `He encontrado ${cs.length} trabajos. Dime el número del que quieres actualizar.`, contexto: `Trabajos candidatos:\n${lista(rs)}` }; }
  const t = cs[0];
  const campo = norm(d.campo).startsWith('material') ? 'materiales' : 'descripcion';
  const reemplazar = norm(d.modo).startsWith('reempl');
  const actual = String(t[campo] ?? '').trim();
  const r = await API.patch('trabajos', { id: `eq.${t.id}` }, { [campo]: !reemplazar && actual ? `${actual}\n${texto}` : texto });
  if (r.error) return { ok: false, mensaje: 'No pude guardar el cambio. Inténtalo de nuevo.' };
  const [res] = await mapTrabajos([t]);
  refrescar();
  return { ok: true, resultados: [res], mensaje: `Hecho. He ${!reemplazar && actual ? 'añadido el texto a' : 'escrito'} ${campo === 'materiales' ? 'los materiales' : 'la descripción'} del trabajo ${res.titulo}.`,
    contexto: `Actualizado el campo ${campo} del trabajo ${res.titulo}. Texto guardado: ${texto}` };
}

// ── Comanda para el equipo (del hub: se reparte en tareas y avisa) ─────────
async function crearComanda(d: Datos): Promise<Respuesta> {
  const texto = String(d.texto ?? '').trim();
  if (!texto) return { ok: false, mensaje: '¿Qué le digo al equipo?' };
  const r = await llamarFuncion<{ tareas: unknown[] }>('comandas', { accion: 'crear', texto }, 120000);
  if (r.error || !r.data) return { ok: false, mensaje: `No pude repartirla: ${r.error ?? 'sin respuesta'}.` };
  refrescar();
  return { ok: true, mensaje: `Comanda repartida en ${r.data.tareas.length} tarea${r.data.tareas.length === 1 ? '' : 's'}; el equipo ya tiene el aviso.`, contexto: `Comanda creada: «${texto}».`,
    resultados: [{ tipo: 'trabajo', id: 'comandas', titulo: 'Ver las comandas', ruta: '#/comandas' }] };
}

registrarAccionesVoz({
  fichar, cambiar_estado: cambiarEstado, programar, crear_evento: crearEvento, apuntar_gasto: apuntarGasto,
  apuntar_nota: apuntarNota, actualizar_descripcion: actualizarDescripcion, crear_comanda: crearComanda,
});
