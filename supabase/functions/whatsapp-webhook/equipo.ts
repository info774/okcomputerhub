// deno-lint-ignore-file no-explicit-any
// Portado de okcomputerclaude (whatsapp-webhook/equipo.ts) sobre las tablas del
// hub. Cambios: lo que escribe en un área que aún lleva la app (trabajos,
// tareas, fichajes…) NO se escribe: se contesta que se haga allí (tablaDelHub);
// el fichaje va por hub.reloj_fichar → la MISMA hub.fichar del reloj y de #/hoy;
// la foto del trabajo queda en trabajo_fotos.drive_url (el espejo no lleva `foto`).
//
// WhatsApp del EQUIPO: cuando escribe al número de la empresa un teléfono que
// es de un usuario de la app (usuarios.telefono), no sale el menú de clientes:
// la IA (Groq, la misma de la voz) entiende el mensaje y la app actúa.
//
//  · «151: cambiado el router»          → comentario en el trabajo nº 151
//  · foto con «151» en el texto         → foto en la ficha del trabajo 151
//  · «¿y el 151?»                        → estado del trabajo
//  · «¿qué tengo hoy?» / «¿qué tiene Jorge mañana?» → agenda del día
//  · «¿qué hizo Christian hoy?»          → sus fichajes y comentarios del día
//  · «¿quién está fichado?» / «¿qué tickets hay abiertos?»
//  · «salgo para el 151» / «empiezo el 151» / «termino» → fichaje
//  · «crea un trabajo / ticket / tarea…» → alta (pide confirmación)
//
// Lo de otras personas solo lo ve un admin; un técnico, lo suyo.
// Todo lo que se contesta va dentro de la ventana de 24 h que abre el propio
// mensaje del técnico: para Meta es conversación de servicio, gratis.
// Ver docs/WHATSAPP_CLOUD.md («WhatsApp del equipo»).

import { tablaDelHub } from "../_shared/sb-hub.ts"

type SupabaseClient = any
import { groqChat } from "../_shared/groq.ts"
import { ahoraCanarias } from "../_shared/soporte-horario.ts"
import { descargarMedia } from "../_shared/whatsapp.ts"

export interface UsuarioEquipo { id: string; nombre: string; rol: string }

type Botones = { id: string; titulo: string }[]
type Lista = { boton: string; filas: { id: string; titulo: string; descripcion?: string }[] }
export type Decir = (texto: string, extra?: { botones?: Botones; lista?: Lista }) => Promise<void>

// La confirmación pendiente caduca: un «sí» de mañana no crea lo de hoy.
const CADUCA_CONFIRMAR_MIN = 30
// Fotos del trabajo enviadas por WhatsApp: el navegador no está para subirlas a
// Drive, así que van a Storage y `trabajo_fotos.foto` guarda la URL (la ficha
// la pinta igual que el base64 antiguo, sin tocar el front).
const BUCKET_FOTOS = 'trabajo-fotos'

// Tabla de cada tipo de ficha (las reglas del fichaje viven en hub.fichar).
const TABLA: Record<Tipo, string> = { trabajo: 'trabajos', tarea: 'tareas', ticket: 'tickets' }
type Tipo = 'trabajo' | 'tarea' | 'ticket'

// ¿Es este teléfono de alguien del equipo? Se compara por los últimos 9
// dígitos, como wa_buscar_por_telefono: en la ficha se escribe de cualquier manera.
export async function usuarioDeTelefono(db: SupabaseClient, telefono: string): Promise<UsuarioEquipo | null> {
  const fin = telefono.replace(/\D/g, '').slice(-9)
  if (fin.length < 9) return null
  const { data, error } = await db.from('usuarios').select('id, nombre, rol, telefono')
    .eq('activo', true).not('telefono', 'is', null)
  if (error) { console.warn('[whatsapp-equipo] usuarios', error.message); return null }
  const u = (data ?? []).find((x: any) => String(x.telefono).replace(/\D/g, '').slice(-9) === fin)
  return u ? { id: u.id, nombre: u.nombre, rol: u.rol } : null
}

const ACCIONES = [
  'nota_trabajo', 'estado_trabajo', 'agenda', 'actividad', 'fichados', 'tickets_abiertos',
  'fichar_traslado', 'fichar_inicio', 'fichar_fin',
  'crear_trabajo', 'crear_ticket', 'crear_tarea', 'ayuda',
] as const

interface Orden {
  accion: typeof ACCIONES[number]
  numero: number | null
  tipo_ficha: Tipo
  texto: string
  cliente: string
  titulo: string
  descripcion: string
  fecha: string
  hora: string
  prioridad: 'alta' | 'media' | 'baja'
  tipo: string
  persona: string
  para_mi: boolean
  todos: boolean
}

const PROMPT = `Eres el asistente interno de Ok Computer Tenerife (servicios informáticos).
Un TÉCNICO o administrador de la empresa te escribe por WhatsApp (o con nota de voz transcrita).
Devuelve SOLO un objeto JSON válido, sin texto alrededor, con esta forma:
{"accion": "...", "numero": 151 | null, "tipo_ficha": "trabajo" | "ticket" | "tarea", "texto": "", "cliente": "",
 "titulo": "", "descripcion": "", "fecha": "AAAA-MM-DD" | "", "hora": "HH:MM" | "", "prioridad": "alta" | "media" | "baja",
 "tipo": "", "persona": "", "para_mi": true | false, "todos": true | false}

Acciones:
- "nota_trabajo": apunta algo en un trabajo que ya existe, indicado por su número ("151: cambiado el router",
  "en el 151 falta el cable"). "numero" = el número; "texto" = lo que hay que apuntar, limpio, sin el número.
- "estado_trabajo": pregunta cómo va un trabajo ("¿y el 151?", "estado del 203"). "numero" obligatorio.
- "agenda": qué hay programado un día ("¿qué tengo hoy?", "¿qué tiene Jorge mañana?"). "fecha" del día
  (hoy si no dice); "persona" si pregunta por otro; "todos" true si pregunta por todo el equipo.
- "actividad": qué HIZO alguien un día ("¿qué hizo Christian hoy?", "¿qué he hecho hoy?"). "persona" (vacío si
  es él mismo) y "fecha".
- "fichados": quién está trabajando ahora mismo ("¿quién está fichado?", "¿dónde está el equipo?").
- "tickets_abiertos": tickets sin cerrar ("¿qué tickets hay abiertos?"). "persona" si pregunta por los de alguien.
- "fichar_traslado": sale hacia un sitio, va de camino ("salgo", "voy para el 151", "en camino").
- "fichar_inicio": empieza a trabajar en algo ("empiezo el 151", "llego al 151", "inicio ticket 53").
  "numero" y "tipo_ficha" (trabajo por defecto). Sin número si no lo dice.
- "fichar_fin": termina lo que estaba haciendo ("termino", "fin", "acabé el 151").
- "crear_trabajo": pide un trabajo nuevo (visita, instalación, asistencia). "cliente" = nombre del cliente,
  local o negocio tal cual lo dice; "titulo" corto (máx. 60 caracteres); "descripcion" lo demás;
  "tipo" = "Asistencia" | "Instalación" | "Mantenimiento" | "Visita comercial" (por defecto Asistencia);
  "fecha" y "hora" si las dice; "para_mi" true si es para él; "persona" si es para otro técnico.
- "crear_ticket": avisa de una incidencia de un cliente para abrir ticket. Mismos campos que crear_trabajo.
- "crear_tarea": una tarea interna, reunión o recordatorio ("tarea: llamar a Z mañana", "mañana a las 9 reunión
  con Mauricio", "recuérdame pedir tóner"). "titulo" = qué hay que hacer; "cliente" solo si menciona uno;
  "fecha" y "hora" si las dice; "persona" si es para otro.
- "ayuda": un saludo, una pregunta sobre qué puedes hacer o algo que no encaja en lo anterior.

Si el mensaje empieza por un número seguido de texto ("151 ..."), casi siempre es "nota_trabajo".
Las fechas relativas (hoy, mañana, el lunes) se resuelven con la FECHA DE HOY que se da abajo.
"prioridad": "alta" si dice urgente; si no, "media".`

async function interpretar(texto: string): Promise<Orden> {
  const apiKey = Deno.env.get('GROQ_API_KEY') ?? ''
  const ahora = ahoraCanarias()
  const dia = new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', weekday: 'long' }).format(new Date())
  if (apiKey) {
    const mensajes = [
      { role: 'system', content: `${PROMPT}\n\nFECHA DE HOY: ${dia} ${ahora.fecha} (hora de Canarias ${ahora.hora}).` },
      { role: 'user', content: texto.slice(0, 3000) },
    ]
    // Primero en modo JSON; si Groq lo rechaza (json_validate_failed, que pasó
    // con notas de voz y dejaba al técnico con la ayuda), otra vez sin él y se
    // saca el objeto del texto.
    for (const modoJson of [true, false]) {
      const r = await groqChat(apiKey, {
        messages: mensajes,
        temperature: 0.1,
        max_tokens: 600,
        ...(modoJson ? { response_format: { type: 'json_object' } } : {}),
      }, 'whatsapp-equipo')
      if (!r.ok) { console.error('[whatsapp-equipo] Groq', modoJson ? 'json' : 'texto', r.status, r.detalle ?? ''); continue }
      const obj = extraerJson(r.contenido ?? '')
      if (obj) return normaliza(obj)
      console.warn('[whatsapp-equipo] respuesta sin JSON', (r.contenido ?? '').slice(0, 200))
    }
  }
  // Sin IA: lo mínimo que se entiende a mano.
  const m = texto.match(/^\s*#?(\d{1,6})\s*[:.\-–]?\s*(.*)$/s)
  if (m && m[2].trim()) return normaliza({ accion: 'nota_trabajo', numero: Number(m[1]), texto: m[2] })
  if (m) return normaliza({ accion: 'estado_trabajo', numero: Number(m[1]) })
  if (/\bhoy\b|\bagenda\b/i.test(texto)) return normaliza({ accion: 'agenda' })
  return normaliza({ accion: 'ayuda' })
}

function extraerJson(s: string): any | null {
  try { return JSON.parse(s) } catch { /* sigue */ }
  const a = s.indexOf('{'), b = s.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  try { return JSON.parse(s.slice(a, b + 1)) } catch { return null }
}

function normaliza(p: any): Orden {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const n = Number(p?.numero)
  const tipos = ['Asistencia', 'Instalación', 'Mantenimiento', 'Visita comercial']
  const tf = str(p?.tipo_ficha).toLowerCase()
  return {
    accion: ((ACCIONES as readonly string[]).includes(str(p?.accion)) ? str(p.accion) : 'ayuda') as Orden['accion'],
    numero: Number.isInteger(n) && n > 0 ? n : null,
    tipo_ficha: (tf === 'ticket' || tf === 'tarea' ? tf : 'trabajo') as Tipo,
    texto: str(p?.texto),
    cliente: str(p?.cliente).slice(0, 120),
    titulo: str(p?.titulo).slice(0, 120),
    descripcion: str(p?.descripcion),
    fecha: /^\d{4}-\d{2}-\d{2}$/.test(str(p?.fecha)) ? str(p.fecha) : '',
    hora: /^\d{1,2}:\d{2}$/.test(str(p?.hora)) ? str(p.hora).padStart(5, '0') : '',
    prioridad: (['alta', 'media', 'baja'].includes(str(p?.prioridad).toLowerCase()) ? str(p.prioridad).toLowerCase() : 'media') as Orden['prioridad'],
    tipo: tipos.find(t => t.toLowerCase() === str(p?.tipo).toLowerCase()) ?? 'Asistencia',
    persona: str(p?.persona).slice(0, 60),
    para_mi: p?.para_mi === true,
    todos: p?.todos === true,
  }
}

interface Ctx { db: SupabaseClient; conv: any; u: UsuarioEquipo; decir: Decir }

export async function atenderEquipo(
  db: SupabaseClient, conv: any, u: UsuarioEquipo,
  entrada: { texto: string; boton: string | null; tipo: string; mediaId?: string | null; mime?: string | null },
  decir: Decir,
) {
  const c: Ctx = { db, conv, u, decir }

  // «¿En qué empiezas?»: elegido de la lista de hoy.
  if (entrada.boton?.startsWith('eqfichar:')) {
    const [, tipo, id] = entrada.boton.split(':')
    return await ficharInicio(c, tipo as Tipo, id)
  }

  // Respuesta a una pregunta de la app (botón o «sí/no» escrito).
  const pendiente = confirmacionVigente(conv)
  if (pendiente) {
    const t = sinAcentos(entrada.texto).trim()
    if (entrada.boton?.startsWith('eqlocal:')) {
      pendiente.local = await localPorId(db, entrada.boton.slice(8))
      return await pedirConfirmacion(c, pendiente)
    }
    if (entrada.boton === 'eq_si' || (!entrada.boton && /^(si|vale|ok|dale|crea|adelante)\b/.test(t))) {
      await guardarPaso(c, null)
      return await crear(c, pendiente)
    }
    if (entrada.boton === 'eq_no' || (!entrada.boton && /^(no|cancela)\b/.test(t))) {
      await guardarPaso(c, null)
      return await decir('Cancelado, no he creado nada.')
    }
    // Ha escrito otra cosa: la pregunta se olvida y se atiende lo nuevo.
    await guardarPaso(c, null)
  }

  const limpio = entrada.texto.replace(/^🎤\s*/, '').trim()
  if (entrada.tipo === 'image' || entrada.tipo === 'document' || entrada.tipo === 'video') {
    const num = limpio.match(/#?(\d{1,6})/)
    if (!num) return await decir('He recibido el archivo. Para guardarlo en un trabajo, mándalo con el número en el texto (por ejemplo «151»).')
    const desc = limpio.replace(num[0], '').replace(/^[\s:.\-–]+/, '').trim()
    if (entrada.tipo === 'image' && entrada.mediaId) return await fotoTrabajo(c, Number(num[1]), entrada.mediaId, entrada.mime, desc)
    return await notaTrabajo(c, Number(num[1]), `📎 Archivo enviado por WhatsApp (en la bandeja)${desc ? `: ${desc}` : ''}`)
  }
  if (!limpio) return await ayuda(c)

  const o = await interpretar(limpio)
  switch (o.accion) {
    case 'nota_trabajo':
      if (!o.numero) return await decir('¿En qué trabajo lo apunto? Escríbelo con el número delante, por ejemplo «151: cambiado el router».')
      return await notaTrabajo(c, o.numero, o.texto || limpio)
    case 'estado_trabajo':
      if (!o.numero) return await decir('¿De qué trabajo? Dime el número, por ejemplo «¿y el 151?».')
      return await estadoTrabajo(c, o.numero)
    case 'agenda': {
      const quien = await personaPedida(c, o.persona)
      if (quien === undefined) return
      return await agenda(c, o.fecha || ahoraCanarias().fecha, o.todos && esAdmin(c), quien)
    }
    case 'actividad': {
      const quien = await personaPedida(c, o.persona)
      if (quien === undefined) return
      return await actividad(c, quien, o.fecha || ahoraCanarias().fecha)
    }
    case 'fichados':
      if (!esAdmin(c)) return await decir('Eso solo lo pueden consultar los administradores.')
      return await fichados(c)
    case 'tickets_abiertos': {
      const quien = o.persona ? await personaPedida(c, o.persona) : null
      if (quien === undefined) return
      return await ticketsAbiertos(c, quien)
    }
    case 'fichar_traslado':
      return await ficharTraslado(c)
    case 'fichar_inicio':
      if (!o.numero) return await elegirQueEmpezar(c)
      return await ficharInicioPorNumero(c, o.tipo_ficha, o.numero)
    case 'fichar_fin':
      return await ficharFin(c)
    case 'crear_trabajo':
    case 'crear_ticket':
    case 'crear_tarea':
      return await prepararAlta(c, o, limpio)
    default:
      return await ayuda(c)
  }
}

const esAdmin = (c: Ctx) => c.u.rol === 'admin'

// ¿Puede escribir el hub ahí? Si el área sigue en la app, se dice y no se toca.
async function delHub(c: Ctx, tabla: string, que: string): Promise<boolean> {
  if (await tablaDelHub(c.db, tabla)) return true
  await c.decir(`${que} todavía se lleva en la app: apúntalo allí, por favor.`)
  return false
}

// La persona por la que pregunta. null = él mismo. undefined = ya se ha
// contestado (no existe, o un técnico preguntando por otro).
async function personaPedida(c: Ctx, texto: string): Promise<UsuarioEquipo | null | undefined> {
  if (!texto) return null
  const t = sinAcentos(texto)
  if (/^(yo|mi|me|el mismo)$/.test(t)) return null
  const { data } = await c.db.from('usuarios').select('id, nombre, rol').eq('activo', true)
  const lista = (data ?? []) as UsuarioEquipo[]
  const cand = lista.filter(u => sinAcentos(u.nombre).split(/\s+/).some(p => p.length >= 3 && t.split(/\s+/).includes(p)))
    .concat(lista.filter(u => sinAcentos(u.nombre).includes(t)))
  const unicos = [...new Map(cand.map(u => [u.id, u])).values()]
  if (!unicos.length) { await c.decir(`No encuentro a nadie del equipo que se llame «${texto}».`); return undefined }
  const p = unicos.find(u => u.id === c.u.id) ?? unicos[0]
  if (p.id === c.u.id) return null
  if (!esAdmin(c)) { await c.decir('Lo de otros compañeros solo lo pueden consultar los administradores.'); return undefined }
  return p
}

// ── Consultas y notas ──────────────────────────────────────────────────────

async function trabajoPorNumero(db: SupabaseClient, numero: number) {
  const { data } = await db.from('trabajos')
    .select('id, numero, titulo, estado, fecha_programada, tecnicos, cliente_id, local_id')
    .eq('numero', numero).maybeSingle()
  return data as any
}

async function nombreSede(db: SupabaseClient, localId: string | null, clienteId: string | null): Promise<string> {
  if (localId) {
    const { data } = await db.from('locales').select('nombre').eq('id', localId).maybeSingle()
    if (data?.nombre) return data.nombre
  }
  if (clienteId) {
    const { data } = await db.from('clientes').select('nombre').eq('id', clienteId).maybeSingle()
    if (data?.nombre) return data.nombre
  }
  return ''
}

async function notaTrabajo(c: Ctx, numero: number, texto: string) {
  const t = await trabajoPorNumero(c.db, numero)
  if (!t) return await c.decir(`No encuentro el trabajo nº ${numero}.`)
  if (!(await delHub(c, 'trabajo_comentarios', 'Lo de los trabajos'))) return
  const { error } = await c.db.from('trabajo_comentarios').insert({
    trabajo_id: t.id, texto, autor_nombre: `${c.u.nombre} (WhatsApp)`,
  })
  if (error) {
    console.error('[whatsapp-equipo] comentario', error.message)
    return await c.decir(`No he podido apuntarlo en el #${numero}: ${error.message}`)
  }
  const sede = await nombreSede(c.db, t.local_id, t.cliente_id)
  await c.decir(`✅ Apuntado en el #${numero}${t.titulo ? ` «${t.titulo}»` : ''}${sede ? ` (${sede})` : ''}.`)
}

async function fotoTrabajo(c: Ctx, numero: number, mediaId: string, mime: string | null | undefined, desc: string) {
  const t = await trabajoPorNumero(c.db, numero)
  if (!t) return await c.decir(`No encuentro el trabajo nº ${numero}.`)
  if (!(await delHub(c, 'trabajo_fotos', 'Lo de los trabajos'))) return
  const f = await descargarMedia(mediaId)
  if (!f.bytes) {
    console.error('[whatsapp-equipo] foto', f.error)
    return await c.decir(`No he podido descargar la foto de WhatsApp: ${f.error ?? 'error desconocido'}`)
  }
  const tipo = f.mime || mime || 'image/jpeg'
  const ext = tipo.includes('png') ? 'png' : tipo.includes('webp') ? 'webp' : 'jpg'
  const ruta = `${t.id}/${ahoraCanarias().fecha.replace(/-/g, '')}_${crypto.randomUUID()}.${ext}`
  const { error: eSub } = await c.db.storage.from(BUCKET_FOTOS).upload(ruta, f.bytes, { contentType: tipo })
  if (eSub) {
    console.error('[whatsapp-equipo] storage', eSub.message)
    return await c.decir(`No he podido guardar la foto: ${eSub.message}`)
  }
  const { data: pub } = c.db.storage.from(BUCKET_FOTOS).getPublicUrl(ruta)
  const { error } = await c.db.from('trabajo_fotos').insert({
    trabajo_id: t.id, drive_url: pub.publicUrl, descripcion: desc || 'Foto por WhatsApp', tecnico_id: c.u.nombre,
  })
  if (error) {
    console.error('[whatsapp-equipo] trabajo_fotos', error.message)
    return await c.decir(`No he podido añadir la foto al #${numero}: ${error.message}`)
  }
  await c.decir(`📷 Foto añadida al #${numero}${t.titulo ? ` «${t.titulo}»` : ''}.`)
}

async function estadoTrabajo(c: Ctx, numero: number) {
  const t = await trabajoPorNumero(c.db, numero)
  if (!t) return await c.decir(`No encuentro el trabajo nº ${numero}.`)
  const sede = await nombreSede(c.db, t.local_id, t.cliente_id)
  const { data: ult } = await c.db.from('trabajo_comentarios').select('texto, autor_nombre, created_at')
    .eq('trabajo_id', t.id).order('created_at', { ascending: false }).limit(1)
  const lineas = [
    `#${t.numero} ${t.titulo || ''}`.trim(),
    sede && `📍 ${sede}`,
    `Estado: ${t.estado || '—'}`,
    t.fecha_programada && `Fecha: ${fechaCorta(t.fecha_programada)}`,
    t.tecnicos?.length && `Técnicos: ${t.tecnicos.join(', ')}`,
    ult?.[0] && `Último comentario: «${String(ult[0].texto).slice(0, 160)}» (${ult[0].autor_nombre || '—'})`,
  ].filter(Boolean)
  await c.decir(lineas.join('\n'))
}

// Filas de un día (hora de Canarias): se pide un margen y se filtra por la
// fecha local, así no hace falta calcular el desfase horario.
function margenDia(fecha: string) {
  const d = new Date(`${fecha}T12:00:00Z`)
  return { desde: new Date(d.getTime() - 36 * 3600_000).toISOString(), hasta: new Date(d.getTime() + 36 * 3600_000).toISOString() }
}
const esDelDia = (iso: string | null, fecha: string) => !!iso && ahoraCanarias(new Date(iso)).fecha === fecha
const hhmm = (iso: string) => ahoraCanarias(new Date(iso)).hora

async function titulosDe(db: SupabaseClient, refs: { tipo: Tipo; id: string }[]) {
  const out = new Map<string, { texto: string; local_id?: string | null }>()
  for (const tipo of ['trabajo', 'tarea', 'ticket'] as Tipo[]) {
    const ids = [...new Set(refs.filter(r => r.tipo === tipo).map(r => r.id))]
    if (!ids.length) continue
    const { data } = await db.from(TABLA[tipo]).select('id, numero, titulo, estado, local_id').in('id', ids)
    for (const x of data ?? []) {
      const pre = tipo === 'trabajo' ? '#' : tipo === 'ticket' ? 'Ticket #' : 'Tarea #'
      out.set(x.id, { texto: `${pre}${x.numero} ${x.titulo || ''}`.trim(), local_id: x.local_id })
    }
  }
  const idsLoc = [...new Set([...out.values()].map(v => v.local_id).filter(Boolean))] as string[]
  if (idsLoc.length) {
    const { data } = await db.from('locales').select('id, nombre').in('id', idsLoc)
    const loc = new Map((data ?? []).map((l: any) => [l.id, l.nombre]))
    for (const v of out.values()) if (v.local_id && loc.get(v.local_id)) v.texto += ` — ${loc.get(v.local_id)}`
  }
  return out
}

async function agenda(c: Ctx, fecha: string, todos: boolean, persona: UsuarioEquipo | null) {
  const quien = persona ?? c.u
  const { desde, hasta } = margenDia(fecha)
  const { data: bloques } = await c.db.from('agenda')
    .select('inicio, fin, todo_el_dia, titulo, tecnicos, trabajo_id, tarea_id, ticket_id')
    .gte('inicio', desde).lte('inicio', hasta).order('inicio')
  const delDia = (bloques ?? []).filter((b: any) => esDelDia(b.inicio, fecha))
    .filter((b: any) => todos || (b.tecnicos ?? []).includes(quien.nombre))

  const refs = delDia.flatMap((b: any) => [
    b.trabajo_id && { tipo: 'trabajo' as Tipo, id: b.trabajo_id },
    b.tarea_id && { tipo: 'tarea' as Tipo, id: b.tarea_id },
    b.ticket_id && { tipo: 'ticket' as Tipo, id: b.ticket_id },
  ].filter(Boolean)) as { tipo: Tipo; id: string }[]
  const titulos = await titulosDe(c.db, refs)

  let q = c.db.from('tareas').select('id, numero, titulo, tecnico_id, hora_inicio')
    .eq('fecha_vencimiento', fecha).not('estado', 'in', '(completada,archivada)')
  if (!todos) q = q.eq('tecnico_id', quien.nombre)
  const { data: tareas } = await q
  const tareasSinBloque = (tareas ?? []).filter((t: any) => !delDia.some((b: any) => b.tarea_id === t.id))

  const cab = `${todos ? 'Equipo' : quien.nombre.split(' ')[0]} · ${fechaLarga(fecha)}`
  if (!delDia.length && !tareasSinBloque.length) return await c.decir(`${cab}\nNo hay nada programado.`)
  const lineas = [cab]
  for (const b of delDia) {
    const ref = b.trabajo_id || b.tarea_id || b.ticket_id
    const hora = b.todo_el_dia ? 'Todo el día' : `${hhmm(b.inicio)}–${hhmm(b.fin)}`
    const que = (ref && titulos.get(ref)?.texto) || b.titulo || 'Cita'
    const quienes = todos && b.tecnicos?.length ? ` [${b.tecnicos.join(', ')}]` : ''
    lineas.push(`• ${hora} ${que}${quienes}`)
  }
  for (const t of tareasSinBloque) {
    lineas.push(`☐ ${t.hora_inicio ? String(t.hora_inicio).slice(0, 5) + ' ' : ''}Tarea #${t.numero} ${t.titulo}${todos && t.tecnico_id ? ` [${t.tecnico_id}]` : ''}`)
  }
  await c.decir(lineas.join('\n'))
}

async function actividad(c: Ctx, persona: UsuarioEquipo | null, fecha: string) {
  const quien = persona ?? c.u
  const { desde, hasta } = margenDia(fecha)
  const { data: ses } = await c.db.from('sesiones')
    .select('entidad_tipo, entidad_id, traslado, inicio, fin, duracion_min, created_at')
    .eq('tecnico_id', quien.id).gte('created_at', desde).lte('created_at', hasta).order('created_at')
  const delDia = (ses ?? []).filter((s: any) => esDelDia(s.inicio || s.traslado || s.created_at, fecha))
  const titulos = await titulosDe(c.db, delDia.filter((s: any) => s.entidad_id)
    .map((s: any) => ({ tipo: s.entidad_tipo as Tipo, id: s.entidad_id })))

  const { data: coms } = await c.db.from('trabajo_comentarios').select('trabajo_id, texto, created_at')
    .ilike('autor_nombre', `${quien.nombre.replace(/[%_]/g, '')}%`).gte('created_at', desde).lte('created_at', hasta)
    .order('created_at')
  const comsDia = (coms ?? []).filter((x: any) => esDelDia(x.created_at, fecha))
  const titCom = await titulosDe(c.db, comsDia.map((x: any) => ({ tipo: 'trabajo' as Tipo, id: x.trabajo_id })))

  const nombre = quien.id === c.u.id ? 'Tú' : quien.nombre.split(' ')[0]
  const cab = `${nombre} · ${fechaLarga(fecha)}`
  if (!delDia.length && !comsDia.length) return await c.decir(`${cab}\nSin fichajes ni comentarios ese día.`)
  const lineas = [cab]
  let total = 0
  for (const s of delDia) {
    const que = (s.entidad_id && titulos.get(s.entidad_id)?.texto) || (s.inicio ? 'Sin ficha' : 'Traslado')
    const ini = s.inicio ? hhmm(s.inicio) : s.traslado ? `🚗 ${hhmm(s.traslado)}` : ''
    const fin = s.fin ? hhmm(s.fin) : 'en curso'
    if (s.duracion_min) total += s.duracion_min
    lineas.push(`• ${ini}–${fin} ${que}${s.duracion_min ? ` (${duracion(s.duracion_min)})` : ''}`)
  }
  if (total) lineas.push(`Total fichado: ${duracion(total)}`)
  if (comsDia.length) {
    lineas.push('Comentarios:')
    for (const x of comsDia.slice(0, 8)) lineas.push(`💬 ${titCom.get(x.trabajo_id)?.texto ?? 'Trabajo'}: «${String(x.texto).slice(0, 120)}»`)
  }
  await c.decir(lineas.join('\n'))
}

async function fichados(c: Ctx) {
  const desde = new Date(Date.now() - 24 * 3600_000).toISOString()
  const { data: ses } = await c.db.from('sesiones')
    .select('tecnico_nombre, entidad_tipo, entidad_id, traslado, inicio, created_at')
    .is('fin', null).gte('created_at', desde).order('created_at')
  const abiertas = ses ?? []
  if (!abiertas.length) return await c.decir('Ahora mismo no hay nadie fichado.')
  const titulos = await titulosDe(c.db, abiertas.filter((s: any) => s.entidad_id)
    .map((s: any) => ({ tipo: s.entidad_tipo as Tipo, id: s.entidad_id })))
  const lineas = ['Fichados ahora:']
  for (const s of abiertas) {
    const que = s.inicio ? ((s.entidad_id && titulos.get(s.entidad_id)?.texto) || 'Sin ficha') : '🚗 en traslado'
    lineas.push(`• ${s.tecnico_nombre || '—'}: ${que} (desde las ${hhmm(s.inicio || s.traslado || s.created_at)})`)
  }
  await c.decir(lineas.join('\n'))
}

async function ticketsAbiertos(c: Ctx, persona: UsuarioEquipo | null) {
  let q = c.db.from('tickets').select('numero, titulo, prioridad, tecnico_id, local_id, cliente_id, created_at')
    .neq('estado', 'Cerrado').order('created_at', { ascending: false }).limit(15)
  if (persona) q = q.eq('tecnico_id', persona.nombre)
  else if (!esAdmin(c)) q = q.eq('tecnico_id', c.u.nombre)
  const { data } = await q
  const lista = data ?? []
  const quien = persona ? ` de ${persona.nombre.split(' ')[0]}` : esAdmin(c) ? '' : ' tuyos'
  if (!lista.length) return await c.decir(`No hay tickets abiertos${quien}.`)
  const idsLoc = [...new Set(lista.map((t: any) => t.local_id).filter(Boolean))]
  const loc = new Map<string, string>()
  if (idsLoc.length) {
    const { data: ls } = await c.db.from('locales').select('id, nombre').in('id', idsLoc)
    for (const l of ls ?? []) loc.set(l.id, l.nombre)
  }
  const lineas = [`Tickets abiertos${quien} (${lista.length}${lista.length === 15 ? '+' : ''}):`]
  for (const t of lista) {
    lineas.push(`• #${t.numero} ${t.titulo}${t.local_id && loc.get(t.local_id) ? ` — ${loc.get(t.local_id)}` : ''}` +
      `${t.prioridad === 'Alta' ? ' 🔴' : ''}${esAdmin(c) && !persona ? ` [${t.tecnico_id || 'sin asignar'}]` : ''}`)
  }
  await c.decir(lineas.join('\n'))
}

// ── Fichaje (mismas reglas que ui/fichaje.js) ──────────────────────────────

async function sesionAbierta(c: Ctx) {
  const { data } = await c.db.from('sesiones').select('*')
    .eq('tecnico_id', c.u.id).is('fin', null).order('created_at', { ascending: false }).limit(1)
  return (data?.[0] ?? null) as any
}

// La MISMA hub.fichar del reloj y de #/hoy (hub.reloj_fichar le pone la persona):
// traslado → inicio → fin, cierra la olvidada, reusa el traslado y pone la ficha
// en curso. Si los fichajes siguen en la app, la base lo dice y se contesta eso.
async function fichar(c: Ctx, accion: 'traslado' | 'inicio' | 'fin', tipo: Tipo | null = null, id: string | null = null) {
  const { data, error } = await c.db.rpc('reloj_fichar', { p_usuario_id: c.u.id, p_accion: accion, p_tipo: tipo, p_id: id })
  if (error) { await c.decir(`No he podido fichar: ${error.message}`); return null }
  return data as { ok: boolean; sesion?: any; cerrada?: any }
}

async function ficharTraslado(c: Ctx) {
  const s = await sesionAbierta(c)
  if (s) return await c.decir(`Ya tienes una sesión abierta${s.inicio ? ` desde las ${hhmm(s.inicio)}` : ' (traslado)'}. Escribe «termino» para cerrarla.`)
  if (!(await fichar(c, 'traslado'))) return
  await c.decir(`🚗 Traslado iniciado a las ${ahoraCanarias().hora}. Cuando llegues escribe «empiezo el 151» (con el número).`)
}

async function ficharInicioPorNumero(c: Ctx, tipo: Tipo, numero: number) {
  const { data } = await c.db.from(TABLA[tipo]).select('id').eq('numero', numero).maybeSingle()
  if (!data) return await c.decir(`No encuentro ${tipo === 'trabajo' ? 'el trabajo' : tipo === 'ticket' ? 'el ticket' : 'la tarea'} nº ${numero}.`)
  await ficharInicio(c, tipo, data.id)
}

async function ficharInicio(c: Ctx, tipo: Tipo, id: string) {
  if (!TABLA[tipo] || !id) return await c.decir('No sé en qué quieres empezar a trabajar.')
  const s = await sesionAbierta(c)
  const r = await fichar(c, 'inicio', tipo, id)
  if (!r) return
  const cerrada = r.cerrada && s?.inicio ? ` (cerrada la anterior: ${duracion(Math.round((Date.now() - Date.parse(s.inicio)) / 60000))})` : ''
  const tit = (await titulosDe(c.db, [{ tipo, id }])).get(id)?.texto ?? ''
  await c.decir(`🟢 Inicio a las ${ahoraCanarias().hora}${tit ? ` en ${tit}` : ''}${cerrada}. Escribe «termino» al acabar.`)
}

async function ficharFin(c: Ctx) {
  const s = await sesionAbierta(c)
  if (!s?.inicio) return await c.decir('No tienes ninguna sesión en curso.')
  const r = await fichar(c, 'fin')
  if (!r) return
  const dur = Number(r.sesion?.duracion_min ?? Math.round((Date.now() - Date.parse(s.inicio)) / 60000))
  const tit = s.entidad_id ? (await titulosDe(c.db, [{ tipo: s.entidad_tipo, id: s.entidad_id }])).get(s.entidad_id)?.texto : ''
  await c.decir(`🔴 Fin a las ${ahoraCanarias().hora}${tit ? ` en ${tit}` : ''}: ${duracion(dur)}.` +
    (s.entidad_tipo === 'trabajo' ? ' El trabajo sigue en curso hasta que lo marques Completado.' : ''))
}

// Sin número: lo que tiene hoy en la agenda, para elegir de una lista.
async function elegirQueEmpezar(c: Ctx) {
  const fecha = ahoraCanarias().fecha
  const { desde, hasta } = margenDia(fecha)
  const { data: bloques } = await c.db.from('agenda')
    .select('inicio, trabajo_id, tarea_id, ticket_id, tecnicos').gte('inicio', desde).lte('inicio', hasta).order('inicio')
  const mios = (bloques ?? []).filter((b: any) => esDelDia(b.inicio, fecha) && (b.tecnicos ?? []).includes(c.u.nombre))
  const refs = mios.map((b: any) => b.trabajo_id ? { tipo: 'trabajo' as Tipo, id: b.trabajo_id }
    : b.tarea_id ? { tipo: 'tarea' as Tipo, id: b.tarea_id } : b.ticket_id ? { tipo: 'ticket' as Tipo, id: b.ticket_id } : null)
    .filter(Boolean) as { tipo: Tipo; id: string }[]
  if (!refs.length) return await c.decir('No tienes nada en la agenda de hoy. Dime el número: «empiezo el 151».')
  const titulos = await titulosDe(c.db, refs)
  const unicos = [...new Map(refs.map(r => [r.id, r])).values()].slice(0, 10)
  await c.decir('¿En qué empiezas?', {
    lista: {
      boton: 'Elegir',
      filas: unicos.map(r => {
        const t = titulos.get(r.id)?.texto ?? r.tipo
        return { id: `eqfichar:${r.tipo}:${r.id}`, titulo: t.slice(0, 24), descripcion: t.slice(24, 96) || undefined }
      }),
    },
  })
}

// ── Altas (con confirmación) ───────────────────────────────────────────────

interface Alta {
  accion: 'crear_trabajo' | 'crear_ticket' | 'crear_tarea'
  titulo: string
  descripcion: string
  fecha: string
  hora: string
  prioridad: string
  tipo: string
  tecnico: string | null
  clienteTexto: string
  local?: LocalEq | null
  pedido_at: string
}

interface LocalEq { id: string; nombre: string; cliente_id: string | null; cliente_nombre?: string }

const NOMBRE_ALTA = { crear_trabajo: 'trabajo', crear_ticket: 'ticket', crear_tarea: 'tarea' }

async function prepararAlta(c: Ctx, o: Orden, original: string) {
  // Para quién: el que se nombra (si existe), él mismo si lo dice; las tareas,
  // de quien las pide salvo que diga otra persona.
  let tecnico: string | null = o.accion === 'crear_tarea' || o.para_mi ? c.u.nombre : null
  if (o.persona) {
    const { data } = await c.db.from('usuarios').select('nombre').eq('activo', true)
    const t = sinAcentos(o.persona)
    const p = (data ?? []).find((u: any) => sinAcentos(u.nombre).split(/\s+/).includes(t) || sinAcentos(u.nombre).includes(t))
    if (p) tecnico = p.nombre
  }
  const alta: Alta = {
    accion: o.accion as Alta['accion'],
    titulo: o.titulo || original.slice(0, 60),
    descripcion: o.descripcion || original,
    fecha: o.fecha || (o.hora ? ahoraCanarias().fecha : ''),
    hora: o.hora,
    prioridad: o.prioridad,
    tipo: o.tipo,
    tecnico,
    clienteTexto: o.cliente,
    local: null,
    pedido_at: new Date().toISOString(),
  }
  if (o.cliente) {
    const cands = await buscarLocales(c.db, o.cliente)
    if (cands.length === 1) alta.local = cands[0]
    else if (cands.length > 1) {
      await guardarPaso(c, alta)
      return await c.decir(`¿Qué sede es «${o.cliente}»?`, {
        lista: {
          boton: 'Elegir sede',
          filas: [...cands.slice(0, 9).map(l => ({ id: `eqlocal:${l.id}`, titulo: l.nombre })), { id: 'eqlocal:ninguna', titulo: 'Sin sede' }],
        },
      })
    }
  }
  await pedirConfirmacion(c, alta)
}

async function pedirConfirmacion(c: Ctx, alta: Alta) {
  const lineas = [
    `¿Creo este ${NOMBRE_ALTA[alta.accion]}?`,
    `• ${alta.titulo}`,
    alta.local ? `• Sede: ${alta.local.nombre}${alta.local.cliente_nombre && alta.local.cliente_nombre !== alta.local.nombre ? ` (${alta.local.cliente_nombre})` : ''}`
      : alta.clienteTexto ? `• Sin sede: no encuentro «${alta.clienteTexto}»` : null,
    alta.accion === 'crear_trabajo' ? `• Tipo: ${alta.tipo}` : null,
    alta.fecha ? `• ${fechaLarga(alta.fecha)}${alta.hora ? ` a las ${alta.hora}` : ''}` : null,
    alta.tecnico ? `• Para: ${alta.tecnico}` : null,
    alta.prioridad === 'alta' ? '• Urgente' : null,
  ].filter(Boolean)
  await guardarPaso(c, alta)
  await c.decir(lineas.join('\n'), { botones: [{ id: 'eq_si', titulo: 'Crear' }, { id: 'eq_no', titulo: 'Cancelar' }] })
}

async function crear(c: Ctx, a: Alta) {
  const tabla = a.accion === 'crear_trabajo' ? 'trabajos' : a.accion === 'crear_ticket' ? 'tickets' : 'tareas'
  if (!(await delHub(c, tabla, a.accion === 'crear_trabajo' ? 'Los trabajos' : a.accion === 'crear_ticket' ? 'Los tickets' : 'Las tareas'))) return
  const cliente_id = a.local?.cliente_id ?? null
  const local_id = a.local?.id ?? null
  const nota = `\n\n— Creado por WhatsApp por ${c.u.nombre}.`
  let res: { data: any; error: any }
  if (a.accion === 'crear_trabajo') {
    // Con fecha y hora, el trigger de agenda crea el bloque del día (20260727_agenda_bloques.sql).
    res = await c.db.from('trabajos').insert({
      titulo: a.titulo, descripcion: a.descripcion + nota, tipo: a.tipo, estado: 'Pendiente',
      prioridad: a.prioridad, cliente_id, local_id, fecha_programada: a.fecha || null,
      hora_llegada: a.fecha && a.hora ? isoCanarias(a.fecha, a.hora) : null,
      tecnicos: a.tecnico ? [a.tecnico] : [],
    }).select('numero').single()
  } else if (a.accion === 'crear_ticket') {
    res = await c.db.from('tickets').insert({
      titulo: a.titulo, descripcion: a.descripcion + nota, estado: 'Abierto',
      prioridad: a.prioridad === 'alta' ? 'Alta' : a.prioridad === 'baja' ? 'Baja' : 'Media',
      via_contacto: 'whatsapp', canal: 'whatsapp', cliente_id, local_id, tecnico_id: a.tecnico,
    }).select('numero').single()
  } else {
    res = await c.db.from('tareas').insert({
      titulo: a.titulo, descripcion: a.descripcion + nota, estado: 'pendiente', prioridad: a.prioridad,
      fecha_vencimiento: a.fecha || null, hora_inicio: a.hora || null,
      tecnico_id: a.tecnico ?? c.u.nombre, cliente_id, local_id,
    }).select('numero').single()
  }
  if (res.error) {
    console.error('[whatsapp-equipo] alta', a.accion, res.error.message)
    return await c.decir(`No he podido crear el ${NOMBRE_ALTA[a.accion]}: ${res.error.message}`)
  }
  await c.decir(`✅ ${NOMBRE_ALTA[a.accion][0].toUpperCase()}${NOMBRE_ALTA[a.accion].slice(1)} #${res.data?.numero ?? ''} creado: «${a.titulo}».`)
}

// ── Utilidades ─────────────────────────────────────────────────────────────

function confirmacionVigente(conv: any): Alta | null {
  if (conv.bot_estado !== 'equipo_confirmar') return null
  const a = conv.bot_datos as Alta | null
  if (!a?.pedido_at) return null
  return Date.now() - new Date(a.pedido_at).getTime() < CADUCA_CONFIRMAR_MIN * 60_000 ? a : null
}

async function guardarPaso(c: Ctx, alta: Alta | null) {
  await c.db.from('wa_conversaciones').update({
    bot_estado: alta ? 'equipo_confirmar' : null, bot_datos: alta ?? {}, bot_estado_at: new Date().toISOString(),
  }).eq('id', c.conv.id)
}

async function localPorId(db: SupabaseClient, id: string): Promise<LocalEq | null> {
  if (!id || id === 'ninguna') return null
  const { data } = await db.from('locales').select('id, nombre, cliente_id').eq('id', id).maybeSingle()
  return data ? await conCliente(db, data as LocalEq) : null
}

async function conCliente(db: SupabaseClient, l: LocalEq): Promise<LocalEq> {
  if (!l.cliente_id) return l
  const { data } = await db.from('clientes').select('nombre').eq('id', l.cliente_id).maybeSingle()
  return { ...l, cliente_nombre: data?.nombre }
}

function sinAcentos(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

// Hora de Canarias → instante UTC, sin tabla de husos: se mira qué hora local
// da una primera estimación y se corrige la diferencia (vale con el cambio de hora).
function isoCanarias(fecha: string, hora: string): string {
  const est = new Date(`${fecha}T${hora}:00Z`)
  const loc = ahoraCanarias(est)
  const desfaseMin = (Date.parse(`${loc.fecha}T${loc.hora}:00Z`) - est.getTime()) / 60000
  return new Date(est.getTime() - desfaseMin * 60000).toISOString()
}

// Sedes cuyo nombre (o el de su cliente) se parece a lo dicho.
async function buscarLocales(db: SupabaseClient, texto: string): Promise<LocalEq[]> {
  const q = sinAcentos(texto).replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim()
  if (q.length < 2) return []
  const vacias = new Set(['el', 'la', 'los', 'las', 'de', 'del', 'bar', 'restaurante', 'cafeteria', 'local', 'en', 'y'])
  const palabras = q.split(' ').filter(p => p.length >= 3 && !vacias.has(p))
  const clave = (palabras.length ? palabras : [q]).sort((a, b) => b.length - a.length)[0].replace(/[%_]/g, '')

  const [{ data: porLocal }, { data: clis }] = await Promise.all([
    db.from('locales').select('id, nombre, cliente_id').eq('activo', true).ilike('nombre', `%${clave}%`).limit(30),
    db.from('clientes').select('id, nombre').eq('activo', true).ilike('nombre', `%${clave}%`).limit(10),
  ])
  const lista = (porLocal ?? []) as LocalEq[]
  if (clis?.length) {
    const { data: deClis } = await db.from('locales').select('id, nombre, cliente_id').eq('activo', true)
      .in('cliente_id', clis.map((x: any) => x.id)).limit(30)
    for (const l of (deClis ?? []) as LocalEq[]) if (!lista.some(x => x.id === l.id)) lista.push(l)
  }
  const nombresCli = new Map<string, string>((clis ?? []).map((x: any) => [x.id, x.nombre]))
  const puntua = (l: LocalEq) => {
    const n = sinAcentos(`${l.nombre} ${nombresCli.get(l.cliente_id ?? '') ?? ''}`)
    if (sinAcentos(l.nombre) === q) return 100
    if (n.includes(q)) return 80
    return palabras.filter(p => n.includes(p)).length * 10
  }
  const orden = lista.map(l => ({ l, p: puntua(l) })).filter(x => x.p > 0).sort((a, b) => b.p - a.p)
  if (!orden.length) return []
  const top = orden[0].p
  const elegidos = (orden.length === 1 || (top >= 80 && orden[1].p < top)) ? [orden[0].l]
    : orden.filter(x => x.p === top).map(x => x.l).slice(0, 9)
  return await Promise.all(elegidos.map(l => conCliente(db, l)))
}

function duracion(min: number) {
  const h = Math.floor(min / 60), m = min % 60
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`
}

function fechaCorta(f: string) {
  const [a, m, d] = f.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

function fechaLarga(f: string) {
  return new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(`${f}T12:00:00Z`))
}

async function ayuda(c: Ctx) {
  const admin = esAdmin(c)
  await c.decir(
    `Hola ${c.u.nombre.split(' ')[0]} 👋 Puedes escribirme o mandar nota de voz:\n` +
    `📝 «151: cambiado el router» · foto con «151» → al trabajo 151\n` +
    `🔎 «¿y el 151?» · «¿qué tengo hoy?» · «¿qué he hecho hoy?»\n` +
    (admin ? `👥 «¿qué hizo Christian hoy?» · «¿qué tiene Jorge mañana?» · «¿quién está fichado?» · «¿qué tickets hay abiertos?»\n` : `🎧 «¿qué tickets tengo?»\n`) +
    `⏱ «salgo para el 151» · «empiezo el 151» · «termino»\n` +
    `➕ «crea un trabajo para el Bar Central…» · «ticket para…» · «mañana a las 9 reunión con Mauricio»\n` +
    `Antes de crear algo te pido confirmación.`,
  )
}
