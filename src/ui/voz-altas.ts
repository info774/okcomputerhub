// Asistente de voz → ALTAS (paridad: voice-actions.js de la app, tanda 3):
// trabajo, tarea, ticket, presupuesto con sus líneas dictadas (precio del
// catálogo si no se dice), añadir líneas, cliente, sede y el alta desde Google
// Maps. El modelo las CONFIRMA antes de emitirlas (prompt de la función `voz`).
// Van por las piezas del hub: `crearCliente()` (NIF repetido no, alta en Zoho),
// `hub.presupuesto_guardar_lineas` (deja el total) y, en cada área, `esDelHub`
// antes de escribir.
import { API } from '../core/api';
import { esDelHub } from '../core/areas';
import {
  type Datos, type Respuesta, type Resultado, registrarAccionesVoz, norm, nombreParecido, esNumero, limpiarTexto, resolverLocal, olvidarSedes, sedes,
  mapTrabajos, mapTareas, mapTickets, lista,
} from './voz-acciones';

const enLaApp = (que: string): Respuesta => ({ ok: false, mensaje: `${que} todavía se hace en la app: hazlo allí.`, contexto: `${que}: todavía es de la app; no se ha hecho nada.` });
const refrescar = () => window.dispatchEvent(new Event('hashchange'));
const euros = (n: number) => { const v = Math.round(n * 100) / 100, e = Math.trunc(v), c = Math.round((v - e) * 100); return c ? `${e} con ${String(c).padStart(2, '0')}` : `${e}`; };
const num = (v: unknown, def = 0) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : def; };
const fecha = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
const hora = (v: unknown) => typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v) ? v.padStart(5, '0') : null;
const horaIso = (f: string | null, h: string | null) => { if (!f || !h) return null; const d = new Date(`${f}T${h}:00`); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };
const capitaliza = (s: unknown) => { const t = String(s ?? '').trim(); return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase(); };
const TIPOS_TRABAJO = ['Instalación', 'Asistencia', 'Mantenimiento', 'Visita comercial'];
const PRIO_TRABAJO = ['Urgente', 'Alta', 'Media', 'Baja'];
const normaTipoTrabajo = (v: unknown) => TIPOS_TRABAJO.find(t => norm(t) === norm(capitaliza(v))) ?? 'Asistencia';
const normaPrioTrabajo = (v: unknown) => v ? PRIO_TRABAJO.find(p => norm(p) === norm(capitaliza(v))) ?? null : null;
const normaPrioTarea = (v: unknown) => { const n = norm(v); return ['alta', 'media', 'baja'].includes(n) ? n : 'media'; };
// El título que la app no pone en el dictado: la primera frase, corta.
const tituloDe = (t: string) => { const p = t.split(/[.\n]/)[0].trim(); return p.length > 60 ? `${p.slice(0, 60).trimEnd()}…` : p; };

// ── Trabajo, tarea y ticket ─────────────────────────────────────────────────
async function crearTrabajo(d: Datos): Promise<Respuesta> {
  if (!(await esDelHub('trabajos'))) return enLaApp('Crear trabajos');
  const local = await resolverLocal(d.local);
  if (!local) return { ok: false, mensaje: `No he encontrado el local «${d.local ?? ''}». ¿Puedes decírmelo de otra forma?` };
  const descripcion = String(d.descripcion ?? '').trim();
  if (!descripcion) return { ok: false, mensaje: 'Me falta la descripción del trabajo. ¿Qué hay que hacer?' };
  const f = fecha(d.fecha), h = hora(d.hora);
  const r = await API.post<any[]>('trabajos', {
    cliente_id: local.cliente_id ?? null, local_id: local.id, titulo: tituloDe(descripcion), tipo: normaTipoTrabajo(d.tipo), descripcion,
    materiales: String(d.materiales ?? '').trim() || null, estado: 'Pendiente', prioridad: normaPrioTrabajo(d.prioridad),
    fecha_programada: f, hora_llegada: horaIso(f, h),
  });
  const t = r.data?.[0];
  if (r.error || !t) return { ok: false, mensaje: 'No pude guardar el trabajo. Inténtalo de nuevo.' };
  const [res] = await mapTrabajos([t]);
  refrescar();
  const cuando = f ? ` para el ${f}${h ? ` a las ${h}` : ''}` : '';
  return { ok: true, resultados: [res], mensaje: `Listo. He creado el trabajo ${t.numero ? `${t.numero} ` : ''}en ${local.nombre}${cuando}.`, contexto: `Trabajo creado: ${res.titulo}${cuando}.` };
}

async function crearTarea(d: Datos): Promise<Respuesta> {
  const descripcion = String(d.descripcion ?? '').trim();
  if (!descripcion) return { ok: false, mensaje: '¿Qué tarea quieres que cree?' };
  if (!(await esDelHub('tareas'))) return enLaApp('Crear tareas');
  const local = d.local ? await resolverLocal(d.local) : null;
  const r = await API.post<any[]>('tareas', {
    id: crypto.randomUUID(), titulo: descripcion, descripcion, tipo: 'Generica', prioridad: normaPrioTarea(d.prioridad), estado: 'pendiente',
    fecha_vencimiento: fecha(d.fecha), hora_inicio: hora(d.hora), cliente_id: local?.cliente_id ?? null, local_id: local?.id ?? null,
  });
  const t = r.data?.[0];
  if (r.error || !t) return { ok: false, mensaje: 'No pude guardar la tarea. Inténtalo de nuevo.' };
  const [res] = await mapTareas([t]);
  refrescar();
  return { ok: true, resultados: [res], mensaje: `Hecho. Tarea creada${local ? ` para ${local.nombre}` : ''}${fecha(d.fecha) ? ` para el ${d.fecha}` : ''}.`, contexto: `Tarea creada: ${descripcion}.` };
}

async function crearTicket(d: Datos): Promise<Respuesta> {
  const titulo = String(d.titulo ?? d.descripcion ?? '').trim();
  if (!titulo) return { ok: false, mensaje: '¿Cuál es el aviso? Dime en una frase qué pasa.' };
  if (!(await esDelHub('tickets'))) return enLaApp('Abrir tickets');
  let local = null;
  if (d.local) { local = await resolverLocal(d.local); if (!local) return { ok: false, mensaje: `No he encontrado el local «${d.local}». ¿Puedes decírmelo de otra forma?` }; }
  const r = await API.post<any[]>('tickets', {
    titulo: titulo.slice(0, 120), descripcion: String(d.descripcion ?? '').trim() || titulo, estado: 'Abierto', prioridad: normaPrioTrabajo(d.prioridad) ?? 'Media',
    cliente_id: local?.cliente_id ?? null, local_id: local?.id ?? null, canal: 'hub',
  });
  const t = r.data?.[0];
  if (r.error || !t) return { ok: false, mensaje: 'No pude guardar el ticket. Inténtalo de nuevo.' };
  const [res] = await mapTickets([t]);
  refrescar();
  return { ok: true, resultados: [res], mensaje: `Ticket ${t.numero} abierto${local ? ` para ${local.nombre}` : ''}: ${titulo}.`, contexto: `Ticket creado: ${res.titulo}.` };
}

// ── Presupuestos con líneas dictadas ────────────────────────────────────────
let _catalogo: { id: string; nombre: string; referencia: string | null; precio: number | null }[] | null = null;
async function catalogo() {
  if (_catalogo) return _catalogo;
  const r = await API.fetchAll<any>('catalogo', { select: 'id,nombre,referencia,precio,activo', activo: 'eq.true', order: 'nombre.asc' });
  _catalogo = r.data ?? [];
  return _catalogo;
}
// Lo que se dicta («dos cámaras Dahua») rara vez coincide al pie de la letra: nombre o
// referencia, luego «contiene», luego palabras sueltas (buscarEnCatalogo de la app).
function enCatalogo(concepto: string, cat: NonNullable<typeof _catalogo>) {
  const q = norm(concepto);
  if (!q) return null;
  const exacto = cat.find(p => norm(p.nombre) === q || norm(p.referencia) === q);
  if (exacto) return exacto;
  const contiene = cat.find(p => nombreParecido(p.nombre, q));
  if (contiene) return contiene;
  const palabras = q.split(/\s+/).filter(w => w.length > 3);
  if (!palabras.length) return null;
  let mejor = null, puntos = 0;
  for (const p of cat) { const n = norm(p.nombre), k = palabras.filter(w => n.includes(w)).length; if (k > puntos) { mejor = p; puntos = k; } }
  return puntos >= 2 || (puntos === 1 && palabras.length === 1) ? mejor : null;
}
interface Linea { nombre: string; cantidad: number; precio: number; descuento: number }
/** Lo dictado → líneas: precio dicho o del catálogo; si no, a cero para rellenarlo (mejor que perder el concepto o inventarlo). */
async function lineasDictadas(lineas: unknown) {
  const items = Array.isArray(lineas) ? lineas.filter(l => l && (l.concepto || l.nombre)) : [];
  if (!items.length) return { filas: [] as Linea[], mensaje: '', contexto: '' };
  const cat = await catalogo();
  const marcadas = items.map(l => {
    const concepto = String(l.concepto || l.nombre).trim(), prod = enCatalogo(concepto, cat);
    const dicho = num(l.precio), precio = dicho > 0 ? dicho : Number(prod?.precio ?? 0);
    return { nombre: prod && !l.concepto_literal ? prod.nombre : concepto, cantidad: num(l.cantidad, 1) || 1, precio, descuento: num(l.descuento), cat: !!prod };
  });
  const sub = (f: Linea) => +(f.precio * f.cantidad * (1 - f.descuento / 100)).toFixed(2);
  const total = marcadas.reduce((s, f) => s + sub(f), 0), sin = marcadas.filter(f => !(f.precio > 0));
  return {
    filas: marcadas.map(f => ({ nombre: f.nombre, cantidad: f.cantidad, precio: f.precio, descuento: f.descuento })),
    mensaje: ` He puesto ${marcadas.length} línea${marcadas.length > 1 ? 's' : ''}, ${euros(total)} euros sin IGIC.${sin.length ? ` ${sin.length === 1 ? 'Falta el precio de' : 'Faltan los precios de'} ${sin.map(f => f.nombre).join(', ')}: no ${sin.length === 1 ? 'estaba' : 'estaban'} en el catálogo.` : ''}`,
    contexto: `\nLíneas guardadas:\n${marcadas.map(f => `- ${f.cantidad} × ${f.nombre} a ${f.precio} € (${f.cat ? 'del catálogo' : 'dictado'})`).join('\n')}`,
  };
}
const resPresupuesto = (p: { id: string; titulo: string }, sub = ''): Resultado => ({ tipo: 'presupuesto', id: p.id, ruta: `#/presupuestos/${p.id}`, titulo: p.titulo || 'Presupuesto', sub });

async function crearPresupuesto(d: Datos): Promise<Respuesta> {
  const titulo = String(d.titulo ?? '').trim();
  if (!titulo) return { ok: false, mensaje: '¿Cuál es el asunto del presupuesto?' };
  if (!(await esDelHub('presupuestos'))) return enLaApp('Crear presupuestos');
  const local = d.local ? await resolverLocal(d.local) : null;
  const r = await API.post<{ id: string }[]>('presupuestos', { cliente_id: local?.cliente_id ?? null, local_id: local?.id ?? null, titulo, exigencias: String(d.descripcion ?? '').trim() || null, estado: 'Borrador', total: 0 });
  const id = r.data?.[0]?.id;
  if (r.error || !id) return { ok: false, mensaje: 'No pude guardar el presupuesto. Inténtalo de nuevo.' };
  const l = await lineasDictadas(d.lineas);
  let mensaje = l.mensaje, contexto = l.contexto;
  if (l.filas.length) {
    const g = await API.rpc<number>('presupuesto_guardar_lineas', { p_presupuesto: id, p_lineas: l.filas });
    if (g.error) { mensaje = ' No he podido guardar las líneas, apúntalas a mano.'; contexto = ' Las líneas fallaron al guardarse.'; }
  }
  refrescar();
  const ext = local ? ` para ${local.nombre}` : '';
  return { ok: true, resultados: [resPresupuesto({ id, titulo }, local?.nombre ?? '')], mensaje: `Presupuesto creado${ext}: ${titulo}.${mensaje}`, contexto: `Presupuesto «${titulo}»${ext} creado en Borrador.${contexto}` };
}

async function anadirLineas(d: Datos): Promise<Respuesta> {
  if (!Array.isArray(d.lineas) || !d.lineas.length) return { ok: false, mensaje: '¿Qué artículos añado?' };
  if (!(await esDelHub('presupuestos'))) return enLaApp('Cambiar presupuestos');
  const ref = String(d.presupuesto ?? d.referencia ?? d.local ?? '').trim();
  const p: Record<string, string> = { select: 'id,titulo,estado,total,local_id', order: 'created_at.desc', limit: '6' };
  const local = ref && !esNumero(ref) ? await resolverLocal(ref) : null;
  if (local) p.local_id = `eq.${local.id}`;
  else { const t = limpiarTexto(ref); if (!t) return { ok: false, mensaje: '¿A qué presupuesto lo añado? Dime el asunto o el local.' }; p.or = `(titulo.ilike.*${t}*,exigencias.ilike.*${t}*)`; }
  const cs = (await API.get<any[]>('presupuestos', p)).data ?? [];
  if (!cs.length) return { ok: false, mensaje: `No he encontrado el presupuesto «${ref}». Dime el asunto o el local.` };
  if (cs.length > 1) {
    const rs = cs.map(x => resPresupuesto(x, x.estado));
    return { ok: false, resultados: rs, mensaje: `Hay ${cs.length} presupuestos que encajan. ¿A cuál lo añado?`, contexto: `Presupuestos candidatos:\n${lista(rs)}` };
  }
  const pres = cs[0];
  const l = await lineasDictadas(d.lineas);
  if (!l.filas.length) return { ok: false, mensaje: 'No he podido añadir las líneas. Inténtalo otra vez.' };
  // La función SUSTITUYE las líneas: se le mandan las que había más las nuevas.
  const previas = (await API.get<Linea[]>('documento_lineas', { select: 'nombre,cantidad,precio,descuento', presupuesto_id: `eq.${pres.id}`, order: 'orden' })).data ?? [];
  const g = await API.rpc<number>('presupuesto_guardar_lineas', { p_presupuesto: pres.id, p_lineas: [...previas, ...l.filas] });
  if (g.error) return { ok: false, mensaje: 'No he podido añadir las líneas. Inténtalo otra vez.' };
  refrescar();
  return { ok: true, resultados: [resPresupuesto(pres, pres.estado)], mensaje: `Añadido a ${pres.titulo}.${l.mensaje} El presupuesto va por ${euros(Number(g.data ?? 0))} euros sin IGIC.`,
    contexto: `Añadidas líneas al presupuesto ${pres.titulo}.${l.contexto}` };
}

// ── Cliente y sede ──────────────────────────────────────────────────────────
async function crearClienteVoz(d: Datos): Promise<Respuesta> {
  const nombre = String(d.nombre ?? '').trim();
  if (!nombre) return { ok: false, mensaje: '¿Cómo se llama el cliente?' };
  if (!(await esDelHub('clientes'))) return enLaApp('Dar de alta clientes');
  const nif = String(d.nif ?? '').replace(/[\s.-]/g, '').toUpperCase() || null;
  if (!d.forzar) {
    const t = limpiarTexto(nombre);
    const ya = t ? (await API.get<any[]>('clientes', { select: 'id,nombre', nombre: `ilike.*${t}*`, activo: 'eq.true', limit: '3' })).data ?? [] : [];
    if (ya.length) return { ok: false, mensaje: `Ya hay ${ya.length === 1 ? 'un cliente' : 'clientes'} con ese nombre: ${ya.map(c => c.nombre).join(', ')}. ¿Lo creo de todas formas?` };
  }
  const { crearCliente } = await import('../modulos/clientes/formulario');
  const r = await crearCliente({ tipo: norm(d.tipo).startsWith('particular') ? 'individuo' : 'empresa', nombre, nif, telefono: String(d.telefono ?? '').trim() || null, email: String(d.email ?? '').trim() || null });
  if (r.duplicado) return { ok: false, mensaje: `Ese NIF ya está dado de alta como ${r.duplicado.nombre}.` };
  if (!r.id) return { ok: false, mensaje: 'No pude crear el cliente. Inténtalo de nuevo.' };
  olvidarSedes(); refrescar();
  return { ok: true, resultados: [{ tipo: 'cliente', id: r.id, ruta: `#/clientes/${r.id}`, titulo: nombre, sub: nif ?? '' }],
    mensaje: `Cliente creado: ${nombre}. ${r.zoho ? `En Zoho: ${r.zoho}.` : ''}`.trim(), contexto: `Cliente ${nombre} creado${nif ? ` con NIF ${nif}` : ''}. Zoho: ${r.zoho ?? 'sin respuesta'}.` };
}

// ¿Hay ya una sede con ese nombre (o muy parecido)? La misma regla que el formulario (≥ 80 %).
async function sedeParecida(nombre: string) {
  const ya = await resolverLocal(nombre);
  if (ya) return ya;
  const { similitudNombres } = await import('../modulos/sitios/formulario');
  return (await sedes()).find(l => similitudNombres(l.nombre, nombre) >= 0.8) ?? null;
}

async function crearLocal(d: Datos): Promise<Respuesta> {
  const nombre = String(d.nombre ?? '').trim();
  if (!nombre) return { ok: false, mensaje: '¿Cómo se llama el local?' };
  if (!(await esDelHub('clientes'))) return enLaApp('Dar de alta sitios');
  const parecido = await sedeParecida(nombre);
  if (parecido && !d.forzar) return { ok: false, mensaje: `Ya existe ${parecido.nombre}${parecido.cliente ? ` de ${parecido.cliente}` : ''}. ¿Es ese, o creo uno nuevo igualmente?` };
  // El cliente es opcional: una sede suelta se enlaza después.
  let cliente: { id: string; nombre: string } | null = null;
  if (d.cliente) {
    const t = limpiarTexto(d.cliente);
    const cs = (await API.get<any[]>('clientes', { select: 'id,nombre', nombre: `ilike.*${t}*`, activo: 'eq.true', limit: '2' })).data ?? [];
    if (cs.length > 1) return { ok: false, mensaje: `Hay varios clientes que se llaman parecido: ${cs.map(c => c.nombre).join(' y ')}. ¿Cuál es?` };
    if (!cs.length) return { ok: false, mensaje: `No he encontrado el cliente «${d.cliente}». ¿Lo creo también, o dejo el local sin cliente?` };
    cliente = cs[0];
  }
  const direccion = String(d.direccion ?? '').trim() || null;
  const { mapaDeDireccion } = await import('../modulos/sitios/formulario');
  const r = await API.post<{ id: string }[]>('locales', { cliente_id: cliente?.id ?? null, nombre, tipo: 'Local', direccion, maps_url: direccion ? mapaDeDireccion(direccion) : null, activo: true });
  const id = r.data?.[0]?.id;
  if (r.error || !id) return { ok: false, mensaje: 'No pude crear el local. Inténtalo de nuevo.' };
  olvidarSedes(); (await import('../modulos/sitios/vista')).olvidarSitios(); refrescar();
  return { ok: true, resultados: [{ tipo: 'local', id, ruta: `#/sitios/${id}`, titulo: nombre, sub: cliente?.nombre ?? 'Sin cliente' }],
    mensaje: `Local creado: ${nombre}${cliente ? ` de ${cliente.nombre}` : ' (sin cliente asignado)'}.`, contexto: `Local ${nombre} creado${cliente ? ` para el cliente ${cliente.nombre}` : ' sin cliente'}.` };
}

// ── Alta desde Google Maps (cliente Y su sede de una vez) ───────────────────
let _lugares: { placeId: string; nombre: string; direccion: string }[] = [];

async function buscarEnMaps(d: Datos): Promise<Respuesta> {
  const texto = String(d.texto ?? d.nombre ?? '').trim();
  if (!texto) return { ok: false, mensaje: '¿Qué negocio busco en Google Maps?' };
  const { buscarLugares } = await import('./maps');
  try { _lugares = await buscarLugares(texto); }
  catch { return { ok: false, mensaje: 'No he podido conectar con Google Maps. Inténtalo en un momento.' }; }
  if (!_lugares.length) return { ok: true, mensaje: `No encuentro «${texto}» en Tenerife. Prueba con el nombre tal cual sale en el cartel, o añade el pueblo.`, contexto: 'Búsqueda en Google Maps sin resultados en Tenerife.' };
  const rs: Resultado[] = _lugares.map(l => ({ tipo: 'lugar', id: l.placeId, titulo: l.nombre, sub: l.direccion }));
  return {
    ok: true, resultados: rs,
    mensaje: _lugares.length === 1 ? `He encontrado ${_lugares[0].nombre}, en ${_lugares[0].direccion || 'Tenerife'}. ¿Lo doy de alta?` : `He encontrado ${_lugares.length} en Tenerife. Te los pongo en pantalla: dime cuál doy de alta o tócalo.`,
    contexto: `Resultados de Google Maps (solo Tenerife), por orden:\n${lista(rs)}\nPara darlo de alta usa crear_desde_maps con el número de la lista.`,
  };
}

async function crearDesdeMaps(d: Datos): Promise<Respuesta> {
  if (!_lugares.length && !d.place_id) return { ok: false, mensaje: 'Primero busco el negocio en Maps: dime cómo se llama.' };
  if (!(await esDelHub('clientes'))) return enLaApp('Dar de alta clientes');
  const i = parseInt(String(d.indice ?? ''), 10);
  const elegido = d.place_id ? { placeId: String(d.place_id) }
    : (i > 0 ? _lugares[i - 1] : null) ?? (d.texto ? _lugares.find(l => norm(l.nombre).includes(norm(d.texto))) : null) ?? (_lugares.length === 1 ? _lugares[0] : null);
  if (!elegido) return { ok: false, mensaje: '¿Cuál de ellos? Dime el número de la lista.' };
  const { detalleLugar } = await import('./maps');
  const lugar = await detalleLugar(elegido.placeId).catch(() => null);
  if (!lugar) return { ok: false, mensaje: 'No he podido traer la ficha de Google Maps. Inténtalo otra vez.' };
  // `confirmable`: solo espera un sí (por voz lo da el modelo con forzar; al tocar la tarjeta, la pantalla).
  if (lugar.fueraDeTenerife && !d.forzar) return { ok: false, confirmable: true, mensaje: `${lugar.nombre} no está en Tenerife, está en ${lugar.direccion}. ¿Lo doy de alta igualmente?` };
  if (!d.forzar) {
    const ya = await sedeParecida(lugar.nombre);
    if (ya) return { ok: false, confirmable: true, mensaje: `Ya tienes ${ya.nombre}${ya.cliente ? ` de ${ya.cliente}` : ''} en la base. ¿Lo creo de todas formas?` };
  }
  const tel = (lugar.telefono || '').replace(/\s/g, '') || null;
  const { crearCliente } = await import('../modulos/clientes/formulario');
  const c = await crearCliente({ tipo: 'empresa', nombre: lugar.nombre, telefono: tel, direccion: lugar.direccion || null });
  if (!c.id) return { ok: false, mensaje: c.duplicado ? `Ese cliente ya existe: ${c.duplicado.nombre}.` : 'No pude crear el cliente. Inténtalo de nuevo.' };
  const { mapaDeDireccion } = await import('../modulos/sitios/formulario');
  const l = await API.post<{ id: string }[]>('locales', {
    cliente_id: c.id, nombre: lugar.nombre, tipo: 'Local', direccion: lugar.direccion || null, activo: true,
    maps_url: lugar.mapsUrl || (lugar.direccion ? mapaDeDireccion(lugar.direccion) : null), horario: lugar.horario || null, lat: lugar.lat ?? null, lng: lugar.lng ?? null,
  });
  const localId = l.data?.[0]?.id;
  if (localId && tel) await API.post('local_telefonos', { local_id: localId, nombre: 'Principal', numero: tel, rol: 'otro' });
  _lugares = [];
  olvidarSedes(); (await import('../modulos/sitios/vista')).olvidarSitios(); refrescar();
  return {
    ok: true, resultados: [{ tipo: 'cliente', id: c.id, ruta: `#/clientes/${c.id}`, titulo: lugar.nombre, sub: lugar.direccion || '' }],
    mensaje: `Alta hecha: ${lugar.nombre}, en ${lugar.direccion || 'Tenerife'}${tel ? ', con su teléfono' : ''}.${c.zoho ? ` En Zoho: ${c.zoho}.` : ''}${localId ? '' : ' Ojo: el cliente sí, pero el sitio no se ha podido crear.'}`,
    contexto: `Creado el cliente ${lugar.nombre} y su local desde Google Maps. Dirección: ${lugar.direccion}. Teléfono: ${tel || 'ninguno'}.`,
  };
}

/** La tarjeta de un lugar tocada en la ventana: sin conversación, lo que solo pide un sí se pregunta aquí. */
export async function altaDesdeLugar(placeId: string): Promise<Respuesta> {
  let r = await crearDesdeMaps({ place_id: placeId });
  if (r.confirmable && confirm(r.mensaje)) r = await crearDesdeMaps({ place_id: placeId, forzar: true });
  return r;
}

registrarAccionesVoz({
  crear_trabajo: crearTrabajo, crear_tarea: crearTarea, crear_ticket: crearTicket, crear_presupuesto: crearPresupuesto, anadir_lineas: anadirLineas,
  crear_cliente: crearClienteVoz, crear_local: crearLocal, buscar_en_maps: buscarEnMaps, crear_desde_maps: crearDesdeMaps,
});
