// Catálogo ÚNICO de lo que se puede leer y escribir desde fuera del front: lo
// usa el conector MCP y lo usarán la voz y el bot. Reglas:
//   · nada de SQL libre: cada herramienta tiene sus campos en lista blanca;
//   · `alcance`: lectura < escritura < admin (el del token tiene que llegar);
//   · una escritura sobre una tabla cuya área tenga dueño 'app' (hub.areas) NO
//     se ofrece ni se ejecuta: esa área la manda todavía la app actual.
import { crearComanda } from './comandas.ts'
import { type Db, type Fila, limpio, esUuid, esFecha } from './hub-db.ts'
import { ejecutarAccionRmm, COMANDOS, type AccionRmm } from './rmm-acciones.ts'
import { construirInforme, TIPOS } from './informes.ts'
import { preguntar } from './rag.ts'

export type Alcance = 'lectura' | 'escritura' | 'admin'
export const NIVEL: Record<Alcance, number> = { lectura: 1, escritura: 2, admin: 3 }

export interface Contexto { db: Db; usuarioId: string; email: string; nombre: string; alcance: Alcance }

export interface Herramienta {
  name: string
  description: string
  alcance: Alcance
  tabla?: string                      // si escribe: la tabla (para comprobar su área)
  inputSchema: Record<string, unknown>
  ejecutar(args: Fila, ctx: Contexto): Promise<unknown>
}

// ── Utilidades ──────────────────────────────────────────────────────────────
const txt = (v: unknown, max = 500) => (v == null ? undefined : String(v).trim().slice(0, max) || undefined)
const lim = (v: unknown, def = 20, max = 100) => Math.min(Math.max(Number(v) || def, 1), max)
const ESTADOS_TICKET = ['Abierto', 'En curso', 'Pendiente', 'Cerrado']
// Las prioridades de los tickets van con mayúscula, como en la app.
const prioridadTicket = (v: unknown) => { const p = String(v ?? 'media').toLowerCase(); return ['baja', 'media', 'alta', 'urgente'].includes(p) ? p[0].toUpperCase() + p.slice(1) : 'Media' }
const obj = (props: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties: props, required })
const S = (description: string, extra: Record<string, unknown> = {}) => ({ type: 'string', description, ...extra })
const N = (description: string) => ({ type: 'number', description })
const B = (description: string) => ({ type: 'boolean', description })

function soloDefinidos(o: Fila): Fila {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))
}
function fecha(v: unknown, campo: string) {
  if (v == null || v === '') return undefined
  if (!esFecha(v)) throw new Error(`${campo} tiene que ir en AAAA-MM-DD`)
  return v as string
}
function uno<T>(filas: T[], que: string): T {
  if (!filas.length) throw new Error(`No existe ${que}`)
  return filas[0]
}

async function proyectoPorNumero(db: Db, numero: unknown) {
  const n = Number(numero)
  if (!Number.isInteger(n) || n <= 0) throw new Error('Falta el número del proyecto')
  return uno(await db.get(`proyectos?select=id,numero,titulo,estado&numero=eq.${n}`), `el proyecto #${n}`)
}

async function usuarioPorEmail(db: Db, email: unknown): Promise<string | null | undefined> {
  if (email === undefined) return undefined
  if (email === null || email === '') return null
  return uno(await db.get(`usuarios?select=id&activo=eq.true&email=ilike.${encodeURIComponent(limpio(email, 120))}`), `la persona ${email}`).id as string
}

const FASES = ['idea', 'definicion', 'investigacion', 'roadmap', 'desarrollo', 'cerrado']
const ESTADOS_TAREA = ['pendiente', 'en_curso', 'hecho']

// ── Lectura ─────────────────────────────────────────────────────────────────
const lectura: Herramienta[] = [
  {
    name: 'buscar', alcance: 'lectura',
    description: 'Busca a la vez en clientes, sedes (locales), contactos, trabajos, tickets, presupuestos y proyectos. Un número busca por número de trabajo/ticket/proyecto.',
    inputSchema: obj({ q: S('Texto o número') }, ['q']),
    async ejecutar(a, { db }) {
      const q = limpio(a.q)
      if (q.length < 2) throw new Error('Escribe al menos 2 caracteres')
      const num = /^\d+$/.test(q) ? `numero.eq.${q},` : ''
      const e = encodeURIComponent
      const [clientes, locales, contactos, trabajos, tickets, presupuestos, proyectos] = await Promise.all([
        db.get(`clientes?select=id,nombre,nif,telefono,email&activo=eq.true&or=${e(`(nombre.ilike.*${q}*,nif.ilike.*${q}*,telefono.ilike.*${q}*,email.ilike.*${q}*)`)}&limit=8`),
        db.get(`locales?select=id,nombre,cliente_id,direccion&activo=eq.true&or=${e(`(nombre.ilike.*${q}*,direccion.ilike.*${q}*)`)}&limit=8`),
        db.get(`contactos?select=id,nombre,telefono,email,cliente_id&activo=eq.true&or=${e(`(nombre.ilike.*${q}*,telefono.ilike.*${q}*,email.ilike.*${q}*)`)}&limit=8`),
        db.get(`trabajos?select=id,numero,titulo,estado,fecha_programada,cliente_id&or=${e(`(${num}titulo.ilike.*${q}*,descripcion.ilike.*${q}*)`)}&order=created_at.desc&limit=8`),
        db.get(`tickets?select=id,numero,titulo,estado,cliente_id&or=${e(`(${num}titulo.ilike.*${q}*,descripcion.ilike.*${q}*)`)}&order=created_at.desc&limit=8`),
        db.get(`presupuestos?select=id,numero_presupuesto,titulo,estado,total,cliente_id&or=${e(`(titulo.ilike.*${q}*,numero_presupuesto.ilike.*${q}*)`)}&order=created_at.desc&limit=8`),
        db.get(`proyectos?select=id,numero,titulo,estado,tipo&or=${e(`(${num}titulo.ilike.*${q}*,descripcion.ilike.*${q}*)`)}&limit=8`),
      ])
      return { clientes, locales, contactos, trabajos, tickets, presupuestos, proyectos }
    },
  },
  {
    name: 'esquema', alcance: 'lectura',
    description: 'Qué datos hay en el hub y quién manda en cada área (app actual = solo lectura aquí; hub = se puede escribir). Úsalo para orientarte antes de escribir.',
    inputSchema: obj({}),
    async ejecutar(_a, { db }) {
      const areas = await db.get('areas?select=area,dueno,tablas,notas&order=area')
      return {
        areas,
        propias_del_hub: ['proyectos', 'proyecto_objetivos', 'proyecto_hitos', 'proyecto_paginas', 'proyecto_tareas', 'proyecto_vinculos', 'claude_peticiones', 'rmm_sitios', 'rmm_acciones', 'oportunidades', 'pipelines', 'actividades', 'clientes_crm', 'paginas'],
        notas: [
          'Las tablas de áreas con dueño "app" son una copia de la app actual (se refresca cada 15 min): se leen, no se escriben.',
          'Estados de trabajos: Pendiente, En progreso, Completado, Para facturar, Facturado, Cancelado. Tickets: Abierto, En curso, Cerrado. Tareas (app): pendiente, en_progreso, completada.',
          `Fases de proyecto: ${FASES.join(' → ')}.`,
          'Monitorización (Breeze): herramientas rmm_*; se lee de Breeze y las acciones (acusar, comandos, scripts) van por su API.',
          'Fechas en AAAA-MM-DD, hora de Canarias.',
        ],
      }
    },
  },
  {
    name: 'cliente_detalle', alcance: 'lectura',
    description: 'Ficha de un cliente: datos, sedes, contactos, últimos trabajos, tickets abiertos y proyectos.',
    inputSchema: obj({ id: S('UUID del cliente (sale de buscar)') }, ['id']),
    async ejecutar(a, { db }) {
      if (!esUuid(a.id)) throw new Error('id no válido')
      const [c] = await db.get(`clientes?select=*&id=eq.${a.id}`)
      if (!c) throw new Error('No existe ese cliente')
      const [locales, contactos, trabajos, tickets, proyectos] = await Promise.all([
        db.get(`locales?select=id,nombre,direccion,plan,estado_pago,programa_tpv,activo&cliente_id=eq.${a.id}`),
        db.get(`contactos?select=id,nombre,cargo,telefono,email&cliente_id=eq.${a.id}&activo=eq.true`),
        db.get(`trabajos?select=id,numero,titulo,estado,fecha_programada&cliente_id=eq.${a.id}&order=created_at.desc&limit=15`),
        db.get(`tickets?select=id,numero,titulo,estado,prioridad&cliente_id=eq.${a.id}&estado=in.(Abierto,"En curso")`),
        db.get(`proyectos?select=numero,titulo,estado&cliente_id=eq.${a.id}`),
      ])
      return { cliente: c, locales, contactos, trabajos, tickets_abiertos: tickets, proyectos }
    },
  },
  {
    name: 'trabajos_listar', alcance: 'lectura',
    description: 'Lista trabajos con filtros. Estados: Pendiente, En progreso, Completado, Para facturar, Facturado, Cancelado.',
    inputSchema: obj({ estado: S('Estado exacto'), desde: S('Fecha programada desde (AAAA-MM-DD)'), hasta: S('Hasta (AAAA-MM-DD)'),
      tecnico: S('Nombre del técnico'), cliente_id: S('UUID del cliente'), limite: N('Máximo (20 por defecto, 100 como mucho)') }),
    async ejecutar(a, { db }) {
      const f: string[] = ['select=id,numero,titulo,descripcion,estado,fecha_programada,tecnicos,cliente_id,local_id']
      if (a.estado) f.push(`estado=eq.${encodeURIComponent(limpio(a.estado))}`)
      if (a.desde) f.push(`fecha_programada=gte.${fecha(a.desde, 'desde')}`)
      if (a.hasta) f.push(`fecha_programada=lte.${fecha(a.hasta, 'hasta')}`)
      if (a.tecnico) f.push(`tecnicos=cs.${encodeURIComponent(`{"${limpio(a.tecnico)}"}`)}`)
      if (a.cliente_id && esUuid(a.cliente_id)) f.push(`cliente_id=eq.${a.cliente_id}`)
      return db.get(`trabajos?${f.join('&')}&order=fecha_programada.desc.nullslast&limit=${lim(a.limite)}`)
    },
  },
  {
    name: 'trabajo_detalle', alcance: 'lectura',
    description: 'Ficha completa de un trabajo: datos, cliente y sede, días de agenda, fichajes, líneas (material) y proyectos que lo enlazan.',
    inputSchema: obj({ id: S('UUID del trabajo'), numero: N('O su número') }),
    async ejecutar(a, { db }) {
      const filtro = esUuid(a.id) ? `id=eq.${a.id}` : Number.isInteger(Number(a.numero)) ? `numero=eq.${Number(a.numero)}` : null
      if (!filtro) throw new Error('Falta id o numero')
      const t = uno(await db.get(`trabajos?select=*&${filtro}`), 'ese trabajo')
      const [cliente, local, agenda, sesiones, lineas, vinculos] = await Promise.all([
        t.cliente_id ? db.get(`clientes?select=id,nombre,telefono&id=eq.${t.cliente_id}`) : [],
        t.local_id ? db.get(`locales?select=id,nombre,direccion&id=eq.${t.local_id}`) : [],
        db.get(`agenda?select=inicio,fin,tecnicos,estado&trabajo_id=eq.${t.id}&order=inicio`),
        db.get(`sesiones?select=tecnico_nombre,traslado,inicio,fin,duracion_min&entidad_id=eq.${t.id}&order=inicio`),
        db.get(`documento_lineas?select=nombre,cantidad,precio,subtotal&trabajo_id=eq.${t.id}&order=orden`),
        db.get(`proyecto_vinculos?select=proyecto_id&tabla=eq.trabajos&registro_id=eq.${t.id}`),
      ])
      return { trabajo: t, cliente: cliente[0] ?? null, local: local[0] ?? null, agenda, sesiones, lineas, proyectos: vinculos.length }
    },
  },
  {
    name: 'tickets_listar', alcance: 'lectura',
    description: 'Tickets (por defecto los abiertos: Abierto o En curso).',
    inputSchema: obj({ estado: S('Estado exacto (vacío = abiertos)'), limite: N('Máximo') }),
    async ejecutar(a, { db }) {
      const est = a.estado ? `eq.${encodeURIComponent(limpio(a.estado))}` : 'in.(Abierto,"En curso")'
      return db.get(`tickets?select=id,numero,titulo,descripcion,estado,prioridad,tecnico_id,cliente_id,created_at&estado=${est}&order=created_at.desc&limit=${lim(a.limite)}`)
    },
  },
  {
    name: 'tareas_app_listar', alcance: 'lectura',
    description: 'Tareas de la app actual (no las de proyectos). Por defecto pendientes y en progreso.',
    inputSchema: obj({ estado: S('pendiente | en_progreso | completada'), tecnico: S('Nombre del técnico'), limite: N('Máximo') }),
    async ejecutar(a, { db }) {
      const f = [`estado=${a.estado ? `eq.${encodeURIComponent(limpio(a.estado))}` : 'in.(pendiente,en_progreso)'}`]
      if (a.tecnico) f.push(`tecnico_id=eq.${encodeURIComponent(limpio(a.tecnico))}`)
      return db.get(`tareas?select=id,numero,titulo,estado,prioridad,fecha_vencimiento,tecnico_id,cliente_id&${f.join('&')}&order=fecha_vencimiento.nullslast&limit=${lim(a.limite)}`)
    },
  },
  {
    name: 'agenda_dia', alcance: 'lectura',
    description: 'Bloques de agenda de un día (trabajos, tareas, citas) con horas y técnicos.',
    inputSchema: obj({ fecha: S('AAAA-MM-DD (hoy por defecto)') }),
    async ejecutar(a, { db }) {
      const dia = fecha(a.fecha, 'fecha') ?? new Date().toLocaleDateString('sv-SE', { timeZone: 'Atlantic/Canary' })
      return db.get(`agenda?select=id,titulo,inicio,fin,tecnicos,estado,trabajo_id,tarea_id,ticket_id&inicio=lt.${dia}T23:59:59&fin=gt.${dia}T00:00:00&order=inicio`)
    },
  },
  {
    name: 'presupuestos_listar', alcance: 'lectura',
    description: 'Presupuestos con filtros (Borrador, Enviado, Aceptado, Rechazado…).',
    inputSchema: obj({ estado: S('Estado exacto'), cliente_id: S('UUID del cliente'), limite: N('Máximo') }),
    async ejecutar(a, { db }) {
      const f: string[] = []
      if (a.estado) f.push(`estado=eq.${encodeURIComponent(limpio(a.estado))}`)
      if (a.cliente_id && esUuid(a.cliente_id)) f.push(`cliente_id=eq.${a.cliente_id}`)
      return db.get(`presupuestos?select=id,numero_presupuesto,titulo,estado,total,fecha,cliente_id${f.length ? '&' + f.join('&') : ''}&order=created_at.desc&limit=${lim(a.limite)}`)
    },
  },
  {
    name: 'proyectos_listar', alcance: 'lectura',
    description: `Proyectos del hub. Fases: ${FASES.join(', ')}. Por defecto los no cerrados.`,
    inputSchema: obj({ estado: S('Fase exacta'), tipo: S('interno | cliente'), limite: N('Máximo') }),
    async ejecutar(a, { db }) {
      const f = [a.estado ? `estado=eq.${limpio(a.estado)}` : 'estado=neq.cerrado']
      if (a.tipo) f.push(`tipo=eq.${limpio(a.tipo)}`)
      return db.get(`proyectos?select=id,numero,titulo,tipo,estado,prioridad,responsable_id,fecha_objetivo,presupuesto,cliente_id&${f.join('&')}&order=numero.desc&limit=${lim(a.limite, 50)}`)
    },
  },
  {
    name: 'proyecto_detalle', alcance: 'lectura',
    description: 'Proyecto completo: datos, objetivos, hitos, tareas, páginas (sin el texto: léelas con proyecto_pagina_leer) y vínculos.',
    inputSchema: obj({ numero: N('Número del proyecto') }, ['numero']),
    async ejecutar(a, { db }) {
      const p = await proyectoPorNumero(db, a.numero)
      const f = `proyecto_id=eq.${p.id}`
      const [proyecto, objetivos, hitos, tareas, paginas, vinculos] = await Promise.all([
        db.get(`proyectos?select=*&id=eq.${p.id}`),
        db.get(`proyecto_objetivos?select=id,texto,metrica,hecho&${f}&order=orden`),
        db.get(`proyecto_hitos?select=id,nombre,descripcion,fecha_inicio,fecha_objetivo,estado&${f}&order=orden`),
        db.get(`proyecto_tareas?select=id,titulo,descripcion,estado,responsable_id,hito_id,fecha_limite,horas_previstas&${f}&order=orden`),
        db.get(`proyecto_paginas?select=id,titulo,tipo,autor,updated_at&${f}&order=orden`),
        db.get(`proyecto_vinculos?select=id,tabla,registro_id,nota&${f}`),
      ])
      const peticiones = await db.get(`claude_peticiones?select=id,created_at,tipo,fase,instrucciones,estado,resultado&${f}&order=created_at.desc&limit=10`)
      return { proyecto: proyecto[0], objetivos, hitos, tareas, paginas, vinculos, peticiones_a_claude: peticiones }
    },
  },
  {
    name: 'proyecto_pagina_leer', alcance: 'lectura',
    description: 'Texto completo (markdown) y fuentes de una página de proyecto.',
    inputSchema: obj({ id: S('UUID de la página') }, ['id']),
    async ejecutar(a, { db }) {
      if (!esUuid(a.id)) throw new Error('id no válido')
      return uno(await db.get(`proyecto_paginas?select=*&id=eq.${a.id}`), 'esa página')
    },
  },
  {
    name: 'equipo', alcance: 'lectura',
    description: 'Personas del equipo (nombre, correo, rol) para asignar responsables.',
    inputSchema: obj({}),
    ejecutar: (_a, { db }) => db.get('usuarios?select=id,nombre,email,rol&activo=eq.true&order=nombre'),
  },
  {
    name: 'sync_estado', alcance: 'lectura',
    description: 'Cómo de fresca está la copia de la app actual en el hub.',
    inputSchema: obj({}),
    ejecutar: (_a, { db }) => db.get('sync_estado?select=clave,ultima_ok,ultimo_error,ultimo_error_at,filas'),
  },
]

// ── Escritura (solo tablas cuyo área manda el hub) ─────────────────────────
const CAMPOS_PROYECTO = {
  titulo: S('Título'), descripcion: S('La idea, en markdown'), tipo: S('interno | cliente'),
  estado: S(`Fase: ${FASES.join(' | ')}`), prioridad: S('baja | media | alta | urgente'),
  cliente_id: S('UUID del cliente (proyectos de cliente)'), responsable_email: S('Correo del responsable'),
  fecha_inicio: S('AAAA-MM-DD'), fecha_objetivo: S('AAAA-MM-DD'), presupuesto: N('Dinero previsto (€)'),
  resultado: S('Al cerrar: qué salió'),
}

async function datosProyecto(a: Fila, db: Db): Promise<Fila> {
  if (a.estado != null && !FASES.includes(String(a.estado))) throw new Error(`Fase no válida. Usa: ${FASES.join(', ')}`)
  if (a.tipo != null && !['interno', 'cliente'].includes(String(a.tipo))) throw new Error('tipo: interno o cliente')
  if (a.prioridad != null && !['baja', 'media', 'alta', 'urgente'].includes(String(a.prioridad))) throw new Error('prioridad no válida')
  if (a.cliente_id != null && a.cliente_id !== '' && !esUuid(a.cliente_id)) throw new Error('cliente_id no válido')
  return soloDefinidos({
    titulo: txt(a.titulo, 200), descripcion: a.descripcion === undefined ? undefined : String(a.descripcion ?? '').slice(0, 50000),
    tipo: a.tipo, estado: a.estado, prioridad: a.prioridad,
    cliente_id: a.cliente_id === undefined ? undefined : (a.cliente_id || null),
    responsable_id: await usuarioPorEmail(db, a.responsable_email),
    fecha_inicio: fecha(a.fecha_inicio, 'fecha_inicio'), fecha_objetivo: fecha(a.fecha_objetivo, 'fecha_objetivo'),
    presupuesto: a.presupuesto === undefined ? undefined : (a.presupuesto === null ? null : Number(a.presupuesto)),
    resultado: txt(a.resultado, 5000),
  })
}

function fuentes(v: unknown) {
  if (v == null) return undefined
  if (!Array.isArray(v)) throw new Error('fuentes tiene que ser una lista de {titulo, url}')
  return v.slice(0, 50).map(f => ({ titulo: txt((f as Fila)?.titulo, 200), url: String((f as Fila)?.url ?? '') }))
    .filter(f => /^https?:\/\//.test(f.url))
}

const escritura: Herramienta[] = [
  {
    name: 'proyecto_crear', alcance: 'escritura', tabla: 'proyectos',
    description: 'Crea un proyecto (por defecto en fase idea, responsable: el dueño del token).',
    inputSchema: obj(CAMPOS_PROYECTO, ['titulo']),
    async ejecutar(a, { db, usuarioId }) {
      const d = await datosProyecto(a, db)
      if (!d.titulo) throw new Error('Falta el título')
      const [p] = await db.post('proyectos', { responsable_id: usuarioId, creado_por: usuarioId, ...d })
      return { numero: p.numero, id: p.id, estado: p.estado }
    },
  },
  {
    name: 'proyecto_actualizar', alcance: 'escritura', tabla: 'proyectos',
    description: 'Cambia campos de un proyecto (solo los que se pasen), incluida la fase.',
    inputSchema: obj({ numero: N('Número del proyecto'), ...CAMPOS_PROYECTO }, ['numero']),
    async ejecutar(a, { db }) {
      const p = await proyectoPorNumero(db, a.numero)
      const d = await datosProyecto(a, db)
      if (!Object.keys(d).length) throw new Error('No hay nada que cambiar')
      const [r] = await db.patch(`proyectos?id=eq.${p.id}`, d)
      return { numero: r.numero, estado: r.estado, cambiado: Object.keys(d) }
    },
  },
  {
    name: 'proyecto_objetivo_crear', alcance: 'escritura', tabla: 'proyecto_objetivos',
    description: 'Añade un objetivo a un proyecto, con su métrica (cómo se sabe que se cumple).',
    inputSchema: obj({ numero: N('Número del proyecto'), texto: S('Objetivo'), metrica: S('Cómo se mide') }, ['numero', 'texto']),
    async ejecutar(a, { db }) {
      const p = await proyectoPorNumero(db, a.numero)
      const texto = txt(a.texto, 300)
      if (!texto) throw new Error('Falta el texto')
      const [o] = await db.post('proyecto_objetivos', { proyecto_id: p.id, texto, metrica: txt(a.metrica, 200) ?? null, orden: Date.now() / 1e12 })
      return { id: o.id }
    },
  },
  {
    name: 'proyecto_objetivo_actualizar', alcance: 'escritura', tabla: 'proyecto_objetivos',
    description: 'Cambia un objetivo o lo marca como cumplido.',
    inputSchema: obj({ id: S('UUID del objetivo'), texto: S('Texto'), metrica: S('Métrica'), hecho: B('¿Cumplido?') }, ['id']),
    async ejecutar(a, { db }) {
      if (!esUuid(a.id)) throw new Error('id no válido')
      const d = soloDefinidos({ texto: txt(a.texto, 300), metrica: txt(a.metrica, 200), hecho: typeof a.hecho === 'boolean' ? a.hecho : undefined })
      uno(await db.patch(`proyecto_objetivos?id=eq.${a.id}`, d), 'ese objetivo')
      return { ok: true }
    },
  },
  {
    name: 'proyecto_hito_crear', alcance: 'escritura', tabla: 'proyecto_hitos',
    description: 'Añade un hito al roadmap de un proyecto.',
    inputSchema: obj({ numero: N('Número del proyecto'), nombre: S('Hito'), descripcion: S('Detalle'),
      fecha_inicio: S('AAAA-MM-DD'), fecha_objetivo: S('AAAA-MM-DD') }, ['numero', 'nombre']),
    async ejecutar(a, { db }) {
      const p = await proyectoPorNumero(db, a.numero)
      const nombre = txt(a.nombre, 200)
      if (!nombre) throw new Error('Falta el nombre')
      const [h] = await db.post('proyecto_hitos', soloDefinidos({ proyecto_id: p.id, nombre, descripcion: txt(a.descripcion, 2000),
        fecha_inicio: fecha(a.fecha_inicio, 'fecha_inicio'), fecha_objetivo: fecha(a.fecha_objetivo, 'fecha_objetivo'), orden: Date.now() / 1e12 }))
      return { id: h.id }
    },
  },
  {
    name: 'proyecto_hito_actualizar', alcance: 'escritura', tabla: 'proyecto_hitos',
    description: 'Cambia un hito (fechas, estado pendiente | en_curso | hecho…).',
    inputSchema: obj({ id: S('UUID del hito'), nombre: S('Nombre'), descripcion: S('Detalle'), fecha_inicio: S('AAAA-MM-DD'),
      fecha_objetivo: S('AAAA-MM-DD'), estado: S('pendiente | en_curso | hecho') }, ['id']),
    async ejecutar(a, { db }) {
      if (!esUuid(a.id)) throw new Error('id no válido')
      if (a.estado != null && !ESTADOS_TAREA.includes(String(a.estado))) throw new Error('estado no válido')
      const d = soloDefinidos({ nombre: txt(a.nombre, 200), descripcion: txt(a.descripcion, 2000), estado: a.estado,
        fecha_inicio: fecha(a.fecha_inicio, 'fecha_inicio'), fecha_objetivo: fecha(a.fecha_objetivo, 'fecha_objetivo') })
      uno(await db.patch(`proyecto_hitos?id=eq.${a.id}`, d), 'ese hito')
      return { ok: true }
    },
  },
  {
    name: 'proyecto_tarea_crear', alcance: 'escritura', tabla: 'proyecto_tareas',
    description: 'Añade una tarea a un proyecto (tablero Pendiente / En curso / Hecho).',
    inputSchema: obj({ numero: N('Número del proyecto'), titulo: S('Tarea'), descripcion: S('Detalle'),
      responsable_email: S('Correo del responsable'), hito_id: S('UUID del hito'), fecha_limite: S('AAAA-MM-DD'),
      horas_previstas: N('Horas previstas') }, ['numero', 'titulo']),
    async ejecutar(a, { db }) {
      const p = await proyectoPorNumero(db, a.numero)
      const titulo = txt(a.titulo, 200)
      if (!titulo) throw new Error('Falta el título')
      if (a.hito_id != null && !esUuid(a.hito_id)) throw new Error('hito_id no válido')
      const [t] = await db.post('proyecto_tareas', soloDefinidos({ proyecto_id: p.id, titulo, descripcion: txt(a.descripcion, 5000),
        responsable_id: await usuarioPorEmail(db, a.responsable_email), hito_id: a.hito_id ?? undefined,
        fecha_limite: fecha(a.fecha_limite, 'fecha_limite'), horas_previstas: a.horas_previstas == null ? undefined : Number(a.horas_previstas),
        orden: Date.now() / 1e12 }))
      return { id: t.id }
    },
  },
  {
    name: 'proyecto_tarea_actualizar', alcance: 'escritura', tabla: 'proyecto_tareas',
    description: 'Cambia una tarea de proyecto: estado (pendiente | en_curso | hecho), responsable, fecha…',
    inputSchema: obj({ id: S('UUID de la tarea'), titulo: S('Título'), descripcion: S('Detalle'), estado: S('pendiente | en_curso | hecho'),
      responsable_email: S('Correo del responsable'), fecha_limite: S('AAAA-MM-DD'), horas_previstas: N('Horas previstas') }, ['id']),
    async ejecutar(a, { db }) {
      if (!esUuid(a.id)) throw new Error('id no válido')
      if (a.estado != null && !ESTADOS_TAREA.includes(String(a.estado))) throw new Error('estado no válido')
      const d = soloDefinidos({ titulo: txt(a.titulo, 200), descripcion: txt(a.descripcion, 5000), estado: a.estado,
        responsable_id: await usuarioPorEmail(db, a.responsable_email), fecha_limite: fecha(a.fecha_limite, 'fecha_limite'),
        horas_previstas: a.horas_previstas == null ? undefined : Number(a.horas_previstas) })
      uno(await db.patch(`proyecto_tareas?id=eq.${a.id}`, d), 'esa tarea')
      return { ok: true }
    },
  },
  {
    name: 'proyecto_pagina_crear', alcance: 'escritura', tabla: 'proyecto_paginas',
    description: 'Escribe una página en un proyecto (investigación, nota o decisión) en markdown, con sus fuentes. Queda firmada como Claude.',
    inputSchema: obj({ numero: N('Número del proyecto'), titulo: S('Título'), contenido: S('Markdown'),
      tipo: S('investigacion | nota | decision'),
      fuentes: { type: 'array', items: obj({ titulo: S('Título'), url: S('https://…') }, ['url']), description: 'Fuentes consultadas' } },
      ['numero', 'titulo', 'contenido']),
    async ejecutar(a, { db }) {
      const p = await proyectoPorNumero(db, a.numero)
      const titulo = txt(a.titulo, 200)
      if (!titulo) throw new Error('Falta el título')
      if (a.tipo != null && !['investigacion', 'nota', 'decision'].includes(String(a.tipo))) throw new Error('tipo no válido')
      const [pg] = await db.post('proyecto_paginas', { proyecto_id: p.id, titulo, tipo: a.tipo ?? 'investigacion',
        contenido: String(a.contenido ?? '').slice(0, 100000), fuentes: fuentes(a.fuentes) ?? [], autor: 'claude', orden: Date.now() / 1e12 })
      return { id: pg.id }
    },
  },
  {
    name: 'proyecto_pagina_actualizar', alcance: 'escritura', tabla: 'proyecto_paginas',
    description: 'Reescribe una página de proyecto (título, contenido, fuentes).',
    inputSchema: obj({ id: S('UUID de la página'), titulo: S('Título'), contenido: S('Markdown'),
      fuentes: { type: 'array', items: obj({ titulo: S('Título'), url: S('https://…') }, ['url']) } }, ['id']),
    async ejecutar(a, { db }) {
      if (!esUuid(a.id)) throw new Error('id no válido')
      const d = soloDefinidos({ titulo: txt(a.titulo, 200), contenido: a.contenido === undefined ? undefined : String(a.contenido).slice(0, 100000),
        fuentes: fuentes(a.fuentes) })
      uno(await db.patch(`proyecto_paginas?id=eq.${a.id}`, d), 'esa página')
      return { ok: true }
    },
  },
  {
    name: 'proyecto_vincular', alcance: 'escritura', tabla: 'proyecto_vinculos',
    description: 'Enlaza a un proyecto un registro de la app (trabajos, tickets, presupuestos, gastos, agenda o tareas) sin tocarlo.',
    inputSchema: obj({ numero: N('Número del proyecto'), tabla: S('trabajos | tickets | presupuestos | gastos | agenda | tareas'),
      registro_id: S('UUID del registro'), nota: S('Por qué') }, ['numero', 'tabla', 'registro_id']),
    async ejecutar(a, { db }) {
      const p = await proyectoPorNumero(db, a.numero)
      const tabla = String(a.tabla)
      if (!['trabajos', 'tickets', 'presupuestos', 'gastos', 'agenda', 'tareas'].includes(tabla)) throw new Error('tabla no enlazable')
      if (!esUuid(a.registro_id)) throw new Error('registro_id no válido')
      uno(await db.get(`${tabla}?select=id&id=eq.${a.registro_id}`), 'ese registro en la copia')
      const [v] = await db.post('proyecto_vinculos', { proyecto_id: p.id, tabla, registro_id: a.registro_id, nota: txt(a.nota, 300) ?? null })
      return { id: v.id }
    },
  },
  // ── Trabajador de Claude: peticiones hechas desde la ficha del proyecto ──
  {
    name: 'claude_peticiones_pendientes', alcance: 'escritura', tabla: 'claude_peticiones',
    description: 'Peticiones de trabajo que el equipo ha dejado para Claude desde las fichas de proyecto (Investigar / Desarrollar esta fase), las más antiguas primero. Incluye las «en curso» atascadas más de 2 horas.',
    inputSchema: obj({ limite: N('Máximo (5 por defecto)') }),
    async ejecutar(a, { db }) {
      const atascada = new Date(Date.now() - 2 * 3600_000).toISOString()
      const filas = await db.get(`claude_peticiones?select=id,created_at,tipo,fase,instrucciones,estado,tomada_at,pedido_por,proyecto_id` +
        `&or=${encodeURIComponent(`(estado.eq.pendiente,and(estado.eq.en_curso,tomada_at.lt.${atascada}))`)}&order=created_at&limit=${lim(a.limite, 5, 20)}`)
      if (!filas.length) return { pendientes: [], nota: 'No hay nada pendiente.' }
      const ids = [...new Set(filas.map(f => f.proyecto_id))].join(',')
      const pers = [...new Set(filas.map(f => f.pedido_por).filter(Boolean))].join(',')
      const [proys, gente] = await Promise.all([
        db.get(`proyectos?select=id,numero,titulo,estado&id=in.(${ids})`),
        pers ? db.get(`usuarios?select=id,nombre,email&id=in.(${pers})`) : [],
      ])
      return { pendientes: filas.map(f => ({ ...f, proyecto: proys.find(p => p.id === f.proyecto_id), pedido_por: gente.find(g => g.id === f.pedido_por) ?? null })),
        como_trabajar: 'Toma la petición (claude_peticion_tomar), lee el proyecto (proyecto_detalle), haz el trabajo con las herramientas proyecto_* y ciérrala (claude_peticion_terminar) con un resumen.' }
    },
  },
  {
    name: 'claude_peticion_tomar', alcance: 'escritura', tabla: 'claude_peticiones',
    description: 'Marca una petición como «en curso» (la toma el trabajador). Falla si otro ya la tomó.',
    inputSchema: obj({ id: S('UUID de la petición') }, ['id']),
    async ejecutar(a, { db }) {
      if (!esUuid(a.id)) throw new Error('id no válido')
      const atascada = new Date(Date.now() - 2 * 3600_000).toISOString()
      const filas = await db.patch(`claude_peticiones?id=eq.${a.id}&or=${encodeURIComponent(`(estado.eq.pendiente,and(estado.eq.en_curso,tomada_at.lt.${atascada}))`)}`,
        { estado: 'en_curso', tomada_at: new Date().toISOString() })
      if (!filas.length) throw new Error('Esa petición ya no está pendiente (la tomó otro, se canceló o se terminó)')
      return { ok: true, tipo: filas[0].tipo, proyecto_id: filas[0].proyecto_id }
    },
  },
  {
    name: 'claude_peticion_terminar', alcance: 'escritura', tabla: 'claude_peticiones',
    description: 'Cierra una petición en curso con un resumen en markdown de lo hecho (qué páginas, objetivos, hitos o tareas se crearon y qué falta). Estado «hecha», o «error» si no se pudo.',
    inputSchema: obj({ id: S('UUID de la petición'), resultado: S('Resumen en markdown'), estado: S('hecha | error'),
      error: S('Si estado = error: qué pasó') }, ['id', 'resultado']),
    async ejecutar(a, { db }) {
      if (!esUuid(a.id)) throw new Error('id no válido')
      const estado = a.estado === 'error' ? 'error' : 'hecha'
      const filas = await db.patch(`claude_peticiones?id=eq.${a.id}&estado=eq.en_curso`, {
        estado, resultado: String(a.resultado ?? '').slice(0, 20000), error: estado === 'error' ? txt(a.error, 2000) ?? 'sin detalle' : null,
        terminada_at: new Date().toISOString() })
      if (!filas.length) throw new Error('Esa petición no está en curso: tómala antes con claude_peticion_tomar')
      return { ok: true, estado }
    },
  },
  // Escrituras sobre áreas que hoy manda la app: se ofrecen solas el día que el
  // área se corte (hub.areas.dueno = 'hub'). Mismas columnas que la app.
  {
    name: 'ticket_crear', alcance: 'escritura', tabla: 'tickets',
    description: 'Crea un ticket de soporte en el Desk del hub (el SLA se calcula solo por la prioridad).',
    inputSchema: obj({ titulo: S('Título'), descripcion: S('Detalle'), cliente_id: S('UUID del cliente'), local_id: S('UUID de la sede'),
      prioridad: S('Baja | Media | Alta | Urgente'), tecnico: S('Nombre del técnico asignado'), canal: S('email | whatsapp | telefono | portal | hub') }, ['titulo']),
    async ejecutar(a, { db }) {
      const [t] = await db.post('tickets', soloDefinidos({ titulo: txt(a.titulo, 200), descripcion: txt(a.descripcion, 5000),
        cliente_id: esUuid(a.cliente_id) ? a.cliente_id : undefined, local_id: esUuid(a.local_id) ? a.local_id : undefined,
        prioridad: prioridadTicket(a.prioridad), tecnico_id: txt(a.tecnico, 80), canal: txt(a.canal, 20) ?? 'hub', estado: 'Abierto' }))
      return { id: t.id, numero: t.numero, sla_respuesta: t.sla_respuesta_at, sla_resolucion: t.sla_resolucion_at }
    },
  },
  {
    name: 'ticket_detalle', alcance: 'lectura',
    description: 'Un ticket por su número: datos, SLA, valoración y la conversación (notas internas, respuestas y mensajes del cliente).',
    inputSchema: obj({ numero: N('Número del ticket') }, ['numero']),
    async ejecutar(a, { db }) {
      const [t] = await db.get(`tickets?select=*&numero=eq.${Number(a.numero) || 0}`)
      if (!t) throw new Error('No existe ese ticket')
      const comentarios = await db.get(`ticket_comentarios?select=created_at,tipo,canal,autor_nombre,texto,enviado_at&ticket_id=eq.${t.id}&order=created_at`)
      delete t.valoracion_token
      return { ...t, comentarios }
    },
  },
  {
    name: 'ticket_actualizar', alcance: 'escritura', tabla: 'tickets',
    description: 'Cambia estado (Abierto | En curso | Pendiente | Cerrado), prioridad, técnico o resolución de un ticket.',
    inputSchema: obj({ numero: N('Número del ticket'), estado: S('Abierto | En curso | Pendiente | Cerrado'), prioridad: S('Baja | Media | Alta | Urgente'),
      tecnico: S('Nombre del técnico'), resolucion: S('Qué se hizo (al cerrar)') }, ['numero']),
    async ejecutar(a, { db }) {
      const estado = a.estado ? ESTADOS_TICKET.find(e => e.toLowerCase() === String(a.estado).toLowerCase()) : undefined
      if (a.estado && !estado) throw new Error(`Estado no válido (${ESTADOS_TICKET.join(', ')})`)
      const r = await db.patch(`tickets?numero=eq.${Number(a.numero) || 0}`, soloDefinidos({ estado, prioridad: a.prioridad ? prioridadTicket(a.prioridad) : undefined,
        tecnico_id: txt(a.tecnico, 80), resolucion: txt(a.resolucion, 5000) }))
      if (!r.length) throw new Error('No existe ese ticket')
      return { numero: r[0].numero, estado: r[0].estado, prioridad: r[0].prioridad, tecnico: r[0].tecnico_id }
    },
  },
  {
    name: 'ticket_comentar', alcance: 'escritura', tabla: 'ticket_comentarios',
    description: 'Apunta una NOTA INTERNA en un ticket (no le llega al cliente; las respuestas al cliente se mandan desde el Desk).',
    inputSchema: obj({ numero: N('Número del ticket'), texto: S('La nota') }, ['numero', 'texto']),
    async ejecutar(a, { db, usuarioId, nombre }) {
      const [t] = await db.get(`tickets?select=id&numero=eq.${Number(a.numero) || 0}`)
      if (!t) throw new Error('No existe ese ticket')
      const [c] = await db.post('ticket_comentarios', { ticket_id: t.id, texto: txt(a.texto, 5000), tipo: 'nota', autor_id: usuarioId, autor_nombre: nombre })
      return { id: c.id }
    },
  },
]

// ── Monitorización (Breeze) ────────────────────────────────────────────────
// Lecturas de las vistas hub.rmm_*; las acciones van por la API de Breeze
// (_shared/rmm-acciones.ts, el mismo catálogo que la pantalla) y quedan en
// hub.rmm_acciones a nombre del dueño del token.
const rmm: Herramienta[] = [
  {
    name: 'rmm_resumen', alcance: 'lectura',
    description: 'Monitorización: sedes con equipos Breeze y su semáforo (ok, alerta, parcial, caido), equipos sin conexión y alertas abiertas.',
    inputSchema: obj({}),
    async ejecutar(_a, { db }) {
      const [estados, desconectados, alertas] = await Promise.all([
        db.get('rmm_estado_local?select=*&order=estado'),
        db.get('rmm_equipos?select=id,hostname,sitio,local_id,visto_ultimo&conectado=eq.false&order=visto_ultimo.desc'),
        db.get('rmm_alertas?select=id,hostname,sitio,severidad,estado,titulo,disparada&estado=in.(active,acknowledged)&order=disparada.desc&limit=50'),
      ])
      const ids = [...new Set(estados.map(e => e.local_id))].join(',')
      const locales = ids ? await db.get(`locales?select=id,nombre&id=in.(${ids})`) : []
      return {
        sedes: estados.map(e => ({ ...e, sede: locales.find(l => l.id === e.local_id)?.nombre ?? null })),
        equipos_sin_conexion: desconectados, alertas_abiertas: alertas,
      }
    },
  },
  {
    name: 'rmm_equipos', alcance: 'lectura',
    description: 'Equipos monitorizados (Breeze): hardware, SO, antivirus, discos, parches pendientes, versión del TPV. Filtra por sede (local_id) o por nombre.',
    inputSchema: obj({ local_id: S('UUID de la sede'), q: S('Parte del nombre del equipo o del Site') }),
    async ejecutar(a, { db }) {
      const f = esUuid(a.local_id) ? `&local_id=eq.${a.local_id}` : ''
      const q = limpio(a.q)
      const b = q ? `&or=${encodeURIComponent(`(hostname.ilike.*${q}*,nombre.ilike.*${q}*,sitio.ilike.*${q}*)`)}` : ''
      return db.get(`rmm_equipos?select=*${f}${b}&order=sitio,hostname&limit=100`)
    },
  },
  {
    name: 'rmm_equipo_detalle', alcance: 'lectura',
    description: 'Un equipo: ficha, parches pendientes, software, alertas y comandos/scripts recientes y su resultado.',
    inputSchema: obj({ id: S('UUID del equipo (sale de rmm_equipos)') }, ['id']),
    async ejecutar(a, { db }) {
      if (!esUuid(a.id)) throw new Error('id no válido')
      const [e] = await db.get(`rmm_equipos?select=*&id=eq.${a.id}`)
      if (!e) throw new Error('No existe ese equipo')
      const [parches, software, alertas, comandos, scripts] = await Promise.all([
        db.get(`rmm_parches?select=titulo,severidad,estado,referencia&device_id=eq.${a.id}&estado=in.(pending,missing,failed)`),
        db.get(`rmm_software?select=nombre,version,fabricante&device_id=eq.${a.id}&order=nombre&limit=300`),
        db.get(`rmm_alertas?select=id,titulo,severidad,estado,disparada&device_id=eq.${a.id}&order=disparada.desc&limit=20`),
        db.get(`rmm_comandos?select=tipo,estado,pedido,terminado&device_id=eq.${a.id}&order=pedido.desc&limit=10`),
        db.get(`rmm_scripts_ejecuciones?select=id,script,estado,pedido,codigo_salida,salida,errores&device_id=eq.${a.id}&order=pedido.desc&limit=10`),
      ])
      return { equipo: e, parches_pendientes: parches, software, alertas, comandos, scripts }
    },
  },
  {
    name: 'rmm_scripts', alcance: 'lectura',
    description: 'Catálogo de scripts de Breeze que se pueden lanzar en los equipos (sin su código).',
    inputSchema: obj({ q: S('Parte del nombre') }),
    async ejecutar(a, { db }) {
      const q = limpio(a.q)
      return db.get(`rmm_scripts?select=id,nombre,descripcion,categoria,sistemas,lenguaje,parametros${q ? `&nombre=ilike.*${encodeURIComponent(q)}*` : ''}&order=nombre&limit=100`)
    },
  },
  {
    name: 'rmm_acusar_alerta', alcance: 'escritura',
    description: 'Acusa recibo de una alerta activa en Breeze (queda «acknowledged»). Resolverla se hace en el panel de Breeze.',
    inputSchema: obj({ alerta_id: S('UUID de la alerta (sale de rmm_resumen)') }, ['alerta_id']),
    ejecutar: (a, ctx) => ejecutarAccionRmm(ctx.db, { usuarioId: ctx.usuarioId, email: ctx.email }, { accion: 'acusar_alerta', alerta_id: a.alerta_id } as AccionRmm),
  },
  {
    name: 'rmm_comando', alcance: 'escritura',
    description: `Manda un comando a un equipo por Breeze. Tipos: ${Object.entries(COMANDOS).map(([k, v]) => `${k} (${v})`).join(', ')}. Reiniciar o apagar el PC de un cliente corta su trabajo: confírmalo antes con la persona.`,
    inputSchema: obj({ device_id: S('UUID del equipo'), tipo: S('Tipo de comando', { enum: Object.keys(COMANDOS) }) }, ['device_id', 'tipo']),
    ejecutar: (a, ctx) => ejecutarAccionRmm(ctx.db, { usuarioId: ctx.usuarioId, email: ctx.email }, { accion: 'comando', device_id: a.device_id, tipo: a.tipo } as AccionRmm),
  },
  {
    name: 'rmm_script', alcance: 'escritura',
    description: 'Lanza un script del catálogo de Breeze en uno o varios equipos. El resultado (salida y código) sale después en rmm_equipo_detalle.',
    inputSchema: obj({ script_id: S('UUID del script (rmm_scripts)'), device_ids: { type: 'array', items: { type: 'string' }, description: 'UUIDs de los equipos (1-50)' },
      parametros: { type: 'object', description: 'Parámetros del script, si los pide' } }, ['script_id', 'device_ids']),
    ejecutar: (a, ctx) => ejecutarAccionRmm(ctx.db, { usuarioId: ctx.usuarioId, email: ctx.email },
      { accion: 'script', script_id: a.script_id, device_ids: a.device_ids, parametros: a.parametros } as AccionRmm),
  },
]

// ── Puesto de mando ─────────────────────────────────────────────────────────
// El mismo motor de avisos y los mismos informes que el panel y el bot; lo de
// dinero solo si el dueño del token es admin.
async function persona(ctx: Contexto) {
  const [u] = await ctx.db.get(`usuarios?select=id,nombre,email,rol&id=eq.${ctx.usuarioId}`)
  if (!u) throw new Error('El dueño del token ya no está en el hub')
  return u as unknown as { id: string; nombre: string; email: string; rol: string }
}
const mando: Herramienta[] = [
  {
    name: 'avisos', alcance: 'lectura',
    description: 'Avisos accionables del puesto de mando: presupuestos sin respuesta, trabajos por facturar, tickets sin asignar o con el SLA vencido, correos por revisar, alertas RMM, hitos vencidos y, si el dueño del token es admin, facturas vencidas, cobros de mantenimiento torcidos, clientes importantes sin comprar y cierre de mes.',
    inputSchema: obj({ tipo: S('Filtrar por tipo (p. ej. factura_vencida, alerta_rmm)') }),
    async ejecutar(a, ctx) {
      const filas = (await ctx.db.rpc('panorama_direccion', { p_para: ctx.usuarioId })) as Fila[] ?? []
      return a.tipo ? filas.filter(f => f.tipo === a.tipo) : filas
    },
  },
  {
    name: 'informe', alcance: 'lectura',
    description: `Genera un informe del hub (el mismo texto que llega por Telegram, en HTML sencillo). Tipos: ${Object.entries(TIPOS).map(([k, t]) => `${k} (${t.nombre}${t.dinero ? ', solo admins' : ''})`).join(', ')}.`,
    inputSchema: obj({ tipo: S('Tipo de informe', { enum: Object.keys(TIPOS) }) }, ['tipo']),
    async ejecutar(a, ctx) { return { texto: await construirInforme(ctx.db, String(a.tipo), await persona(ctx)) } },
  },
]

// ── Ventas (fase 4) ─────────────────────────────────────────────────────────
// Clientes, sedes y contactos son de la app (solo se leen); lo del CRM es del
// hub: actividades, «lo siguiente» (clientes_crm) y oportunidades.
const TIPOS_ACT = ['nota', 'llamada', 'visita', 'email', 'whatsapp', 'reunion']
const ventas: Herramienta[] = [
  {
    name: 'cliente_linea_tiempo', alcance: 'lectura',
    description: 'Todo lo que ha pasado con un cliente, lo último primero: actividades apuntadas, trabajos, tickets, presupuestos, oportunidades y (si el dueño del token es admin) facturas y cobros. Incluye su clase A/B/C y «lo siguiente».',
    inputSchema: obj({ cliente_id: S('UUID del cliente (sale de buscar)'), limite: N('Máximo de eventos (por defecto 50)') }, ['cliente_id']),
    async ejecutar(a, { db }) {
      if (!esUuid(a.cliente_id)) throw new Error('cliente_id no válido')
      const [eventos, crm, clases] = await Promise.all([
        db.rpc('linea_tiempo', { p_cliente: a.cliente_id, p_limite: lim(a.limite, 50, 200) }),
        db.get(`clientes_crm?select=clase_manual,siguiente_fecha,siguiente_texto,responsable_id&cliente_id=eq.${a.cliente_id}`),
        db.rpc('clases_clientes', {}) as Promise<Fila[]>,
      ])
      return { clase: clases.find(c => c.cliente_id === a.cliente_id) ?? null, crm: crm[0] ?? null, eventos }
    },
  },
  {
    name: 'oportunidades_listar', alcance: 'lectura',
    description: 'Oportunidades de venta (embudo). Por defecto las abiertas. Etapas del embudo «Ventas»: Detectado, Contactado, Propuesta, Negociando, Ganado, Perdido.',
    inputSchema: obj({ cliente_id: S('UUID del cliente'), estado: S('Etapa'), cerradas: B('Incluir ganadas y perdidas') }),
    async ejecutar(a, { db }) {
      const f = [esUuid(a.cliente_id) ? `cliente_id=eq.${a.cliente_id}` : '', a.estado ? `estado=eq.${encodeURIComponent(limpio(a.estado))}` : '',
        a.cerradas ? '' : 'cerrada_at=is.null'].filter(Boolean).join('&')
      return db.get(`oportunidades?select=id,titulo,cliente_id,estado,valor_estimado,tecnico_id,fecha_seguimiento,origen,created_at${f ? '&' + f : ''}&order=created_at.desc&limit=100`)
    },
  },
  {
    name: 'actividad_apuntar', alcance: 'escritura', tabla: 'actividades',
    description: `Apunta en la línea de tiempo de un cliente (y opcionalmente de una oportunidad) lo que se ha hecho: ${TIPOS_ACT.join(', ')}.`,
    inputSchema: obj({ cliente_id: S('UUID del cliente'), oportunidad_id: S('UUID de la oportunidad'), tipo: S('Tipo', { enum: TIPOS_ACT }), texto: S('Qué pasó') }, ['texto']),
    async ejecutar(a, { db, usuarioId }) {
      if (!esUuid(a.cliente_id) && !esUuid(a.oportunidad_id)) throw new Error('Hace falta cliente_id u oportunidad_id')
      const texto = txt(a.texto, 4000)
      if (!texto) throw new Error('Falta el texto')
      let cliente = esUuid(a.cliente_id) ? a.cliente_id : undefined
      if (!cliente && esUuid(a.oportunidad_id)) cliente = uno(await db.get(`oportunidades?select=cliente_id&id=eq.${a.oportunidad_id}`), 'esa oportunidad').cliente_id ?? undefined
      const [r] = await db.post('actividades', soloDefinidos({ tipo: TIPOS_ACT.includes(String(a.tipo)) ? a.tipo : 'nota', texto, cliente_id: cliente,
        oportunidad_id: esUuid(a.oportunidad_id) ? a.oportunidad_id : undefined, usuario_id: usuarioId }))
      return { id: r.id }
    },
  },
  {
    name: 'cliente_siguiente', alcance: 'escritura', tabla: 'clientes_crm',
    description: 'Pone (o borra, con fecha vacía) «lo siguiente» que toca con un cliente: fecha, qué y quién. Sale como aviso cuando vence.',
    inputSchema: obj({ cliente_id: S('UUID del cliente'), fecha: S('AAAA-MM-DD, o vacío para borrarlo'), texto: S('Qué hay que hacer'),
      responsable_email: S('Email de la persona') }, ['cliente_id']),
    async ejecutar(a, { db }) {
      if (!esUuid(a.cliente_id)) throw new Error('cliente_id no válido')
      const f = fecha(a.fecha, 'fecha') ?? null
      await db.upsert('clientes_crm', 'cliente_id', [soloDefinidos({ cliente_id: a.cliente_id, siguiente_fecha: f, siguiente_texto: f ? txt(a.texto, 300) ?? null : null,
        responsable_id: await usuarioPorEmail(db, a.responsable_email) })])
      return { ok: true }
    },
  },
  {
    name: 'oportunidad_crear', alcance: 'escritura', tabla: 'oportunidades',
    description: 'Crea una oportunidad de venta en el embudo «Ventas» (etapa Detectado).',
    inputSchema: obj({ titulo: S('Qué se quiere vender'), cliente_id: S('UUID del cliente'), valor_estimado: N('€'), fecha_seguimiento: S('AAAA-MM-DD'),
      tecnico: S('Nombre de quien la lleva'), origen: S('web, whatsapp, teléfono, recomendación…'), descripcion: S('Detalle') }, ['titulo']),
    async ejecutar(a, { db }) {
      const [o] = await db.post('oportunidades', soloDefinidos({ titulo: txt(a.titulo, 200), cliente_id: esUuid(a.cliente_id) ? a.cliente_id : undefined,
        valor_estimado: a.valor_estimado == null ? undefined : Number(a.valor_estimado), fecha_seguimiento: fecha(a.fecha_seguimiento, 'fecha_seguimiento'),
        tecnico_id: txt(a.tecnico, 80), origen: txt(a.origen, 40), descripcion: txt(a.descripcion, 5000) }))
      return { id: o.id }
    },
  },
  {
    name: 'oportunidad_actualizar', alcance: 'escritura', tabla: 'oportunidades',
    description: 'Cambia una oportunidad: etapa (estado), valor, seguimiento, quién la lleva, descripción; al perderla, el motivo.',
    inputSchema: obj({ id: S('UUID'), estado: S('Etapa del embudo'), valor_estimado: N('€'), fecha_seguimiento: S('AAAA-MM-DD'), tecnico: S('Nombre'),
      descripcion: S('Detalle'), motivo_perdida: S('Por qué se perdió') }, ['id']),
    async ejecutar(a, { db }) {
      if (!esUuid(a.id)) throw new Error('id no válido')
      const filas = await db.patch(`oportunidades?id=eq.${a.id}`, soloDefinidos({ estado: txt(a.estado, 40), valor_estimado: a.valor_estimado == null ? undefined : Number(a.valor_estimado),
        fecha_seguimiento: fecha(a.fecha_seguimiento, 'fecha_seguimiento'), tecnico_id: txt(a.tecnico, 80), descripcion: txt(a.descripcion, 5000), motivo_perdida: txt(a.motivo_perdida, 500) }))
      if (!filas.length) throw new Error('No existe esa oportunidad')
      return { ok: true, estado: filas[0].estado }
    },
  },
]

// ── Wiki y buscador (fase 5) ────────────────────────────────────────────────
const wiki: Herramienta[] = [
  {
    name: 'preguntar', alcance: 'lectura',
    description: 'Pregunta en lenguaje natural sobre lo que hay en la wiki del hub, la carpeta de Drive indexada y el conocimiento de la app (claves, procedimientos, instalaciones de clientes…). Devuelve la respuesta citando las fuentes [n] y los trozos encontrados.',
    inputSchema: obj({ pregunta: S('La pregunta') }, ['pregunta']),
    ejecutar: (a, { db }) => preguntar(db, String(a.pregunta ?? '')),
  },
  {
    name: 'wiki_buscar', alcance: 'lectura',
    description: 'Busca páginas de la wiki por palabras (título y contenido). Para preguntas abiertas, mejor «preguntar».',
    inputSchema: obj({ q: S('Palabras') }, ['q']),
    async ejecutar(a, { db }) {
      const q = limpio(a.q, 100)
      if (q.length < 2) throw new Error('Escribe al menos 2 caracteres')
      return db.get(`paginas?select=id,titulo,padre_id,updated_at&archivada=eq.false&tsv=wfts(spanish).${encodeURIComponent(q)}&limit=20`)
    },
  },
  {
    name: 'wiki_leer', alcance: 'lectura',
    description: 'Lee una página de la wiki (markdown) y la lista de sus subpáginas.',
    inputSchema: obj({ id: S('UUID de la página') }, ['id']),
    async ejecutar(a, { db }) {
      if (!esUuid(a.id)) throw new Error('id no válido')
      const [p] = await db.get(`paginas?select=id,titulo,contenido,padre_id,proyecto_id,version,updated_at&id=eq.${a.id}`)
      if (!p) throw new Error('No existe esa página')
      return { ...p, subpaginas: await db.get(`paginas?select=id,titulo&padre_id=eq.${a.id}&archivada=eq.false&order=orden,titulo`) }
    },
  },
  {
    name: 'wiki_crear', alcance: 'escritura', tabla: 'paginas',
    description: 'Crea una página de la wiki en markdown, opcionalmente dentro de otra (padre_id) o enlazada a un proyecto (numero).',
    inputSchema: obj({ titulo: S('Título'), contenido: S('Markdown'), padre_id: S('UUID de la página madre'), numero: N('Número de proyecto') }, ['titulo']),
    async ejecutar(a, { db, usuarioId }) {
      const proyecto = a.numero ? (await proyectoPorNumero(db, a.numero)).id : undefined
      const [p] = await db.post('paginas', soloDefinidos({ titulo: txt(a.titulo, 200), contenido: String(a.contenido ?? '').slice(0, 200000),
        padre_id: esUuid(a.padre_id) ? a.padre_id : undefined, proyecto_id: proyecto, creado_por: usuarioId, actualizado_por: usuarioId }))
      return { id: p.id, url: `#/wiki/${p.id}` }
    },
  },
  {
    name: 'wiki_editar', alcance: 'escritura', tabla: 'paginas',
    description: 'Cambia el título o el contenido (markdown completo) de una página; la versión anterior queda en su historial.',
    inputSchema: obj({ id: S('UUID'), titulo: S('Título'), contenido: S('Markdown completo') }, ['id']),
    async ejecutar(a, { db, usuarioId }) {
      if (!esUuid(a.id)) throw new Error('id no válido')
      const filas = await db.patch(`paginas?id=eq.${a.id}`, soloDefinidos({ titulo: txt(a.titulo, 200),
        contenido: a.contenido == null ? undefined : String(a.contenido).slice(0, 200000), actualizado_por: usuarioId }))
      if (!filas.length) throw new Error('No existe esa página')
      return { ok: true, version: filas[0].version }
    },
  },
]

// ── Comandas (fase 8) ───────────────────────────────────────────────────────
const comandas: Herramienta[] = [
  {
    name: 'comanda_crear', alcance: 'escritura', tabla: 'comanda_tareas',
    description: 'Reparte una comanda: un texto con cosas por hacer («Tito, cambia el router del Bar Pepe; Ana, llama al Hotel por la factura») se trocea en tareas del tablero de comandas, cada una a su persona, y se les avisa por Telegram.',
    inputSchema: obj({ texto: S('Lo que hay que hacer, como se diría en voz alta') }, ['texto']),
    async ejecutar(a, { db, usuarioId, nombre }) {
      const r = await crearComanda(db, { texto: String(a.texto ?? ''), origen: 'mcp', autorId: usuarioId, autorNombre: nombre })
      return { comanda_id: r.comanda_id, con_claude: r.con_claude, tareas: r.tareas.map(t => ({ id: t.id, texto: t.texto, persona_id: t.persona_id, prioridad: t.prioridad })) }
    },
  },
  {
    name: 'comandas_listar', alcance: 'lectura',
    description: 'Tablero de comandas: tareas pendientes y en curso (o las hechas), de todos o de una persona.',
    inputSchema: obj({ persona_email: S('Correo de la persona (vacío = todas)'), estado: S('pendiente | en_curso | hecha (vacío = las no hechas)') }),
    async ejecutar(a, { db }) {
      const f = [`estado=${a.estado ? `eq.${encodeURIComponent(limpio(a.estado))}` : 'neq.hecha'}`]
      if (a.persona_email) f.push(`persona_id=eq.${await usuarioPorEmail(db, a.persona_email)}`)
      const [ts, gente] = await Promise.all([db.get(`comanda_tareas?select=id,texto,estado,prioridad,fecha_limite,persona_id,created_at&${f.join('&')}&order=prioridad.desc,created_at&limit=200`),
        db.get('usuarios?select=id,nombre')])
      return ts.map(t => ({ ...t, persona: gente.find(g => g.id === t.persona_id)?.nombre ?? null }))
    },
  },
  {
    name: 'comanda_tarea_actualizar', alcance: 'escritura', tabla: 'comanda_tareas',
    description: 'Mueve una tarea del tablero de comandas (pendiente, en_curso, hecha) o se la pasa a otra persona.',
    inputSchema: obj({ id: S('UUID de la tarea'), estado: S('pendiente | en_curso | hecha'), persona_email: S('Correo de la nueva persona') }, ['id']),
    async ejecutar(a, { db }) {
      if (!esUuid(a.id)) throw new Error('id no válido')
      if (a.estado && !['pendiente', 'en_curso', 'hecha'].includes(String(a.estado))) throw new Error('Estado no válido')
      const r = await db.patch(`comanda_tareas?id=eq.${a.id}`, soloDefinidos({ estado: a.estado, persona_id: a.persona_email ? await usuarioPorEmail(db, a.persona_email) : undefined }))
      if (!r.length) throw new Error('No existe esa tarea')
      return { id: r[0].id, estado: r[0].estado, persona_id: r[0].persona_id }
    },
  },
]

// ── Almacén (fase 9) ────────────────────────────────────────────────────────
const almacen: Herramienta[] = [
  {
    name: 'stock', alcance: 'lectura',
    description: 'Stock de un material en todas las ubicaciones (almacén y furgonetas), con su mínimo, consumo de 90 días, lo pedido en camino y el proveedor. Sin texto: lo que hay que pedir ya.',
    inputSchema: obj({ q: S('Parte del nombre del material (vacío = lo urgente)') }),
    async ejecutar(a, { db }) {
      const filas = (await db.rpc('mrp', {})) as Fila[] ?? []
      const q = limpio(a.q ?? '').toLowerCase()
      return q ? filas.filter(f => String(f.nombre ?? '').toLowerCase().includes(q)).slice(0, 30) : filas.filter(f => f.urgente)
    },
  },
  {
    name: 'compras_sugeridas', alcance: 'lectura',
    description: 'MRP: qué pedir y a quién (cantidad sugerida por material con el consumo, el plazo del proveedor y lo que ya viene), agrupado por proveedor.',
    inputSchema: obj({}),
    async ejecutar(_a, { db }) {
      const filas = ((await db.rpc('mrp', {})) as Fila[] ?? []).filter(f => Number(f.sugerido) > 0)
      const por: Record<string, Fila[]> = {}
      for (const f of filas) (por[String(f.proveedor ?? 'Sin proveedor')] ??= []).push({ nombre: f.nombre, pedir: f.sugerido, stock: f.stock, urgente: f.urgente, precio: f.precio_compra })
      return por
    },
  },
  {
    name: 'envios_listar', alcance: 'lectura',
    description: 'Envíos por agencia (Correos, Correos Express…) que no se han entregado, o los últimos.',
    inputSchema: obj({ todos: B('También los entregados (últimos 50)') }),
    async ejecutar(a, { db }) {
      return db.get(`envios?select=id,sentido,agencia,seguimiento,estado,destinatario,contenido,enviado_at,entregado_at&${a.todos ? '' : 'estado=not.in.(entregado,devuelto)&'}order=created_at.desc&limit=50`)
    },
  },
  {
    name: 'envio_crear', alcance: 'escritura', tabla: 'envios',
    description: 'Apunta un envío con su agencia y número de seguimiento.',
    inputSchema: obj({ agencia: S('Correos | Correos Express | MRW | SEUR | GLS | Otra'), seguimiento: S('Número de seguimiento'), destinatario: S('A quién'),
      contenido: S('Qué va'), sentido: S('salida | entrada'), cliente_id: S('UUID del cliente') }, ['agencia']),
    async ejecutar(a, { db }) {
      const [e] = await db.post('envios', soloDefinidos({ agencia: txt(a.agencia, 40), seguimiento: txt(a.seguimiento, 80), destinatario: txt(a.destinatario, 200),
        contenido: txt(a.contenido, 500), sentido: a.sentido === 'entrada' ? 'entrada' : 'salida', cliente_id: esUuid(a.cliente_id) ? a.cliente_id : undefined,
        estado: a.seguimiento ? 'enviado' : 'preparado' }))
      return { id: e.id, estado: e.estado }
    },
  },
]

export const HERRAMIENTAS: Herramienta[] = [...lectura, ...rmm, ...mando, ...ventas, ...wiki, ...comandas, ...almacen, ...escritura]

// Tablas cuyo dueño es la app (no se escribe en ellas desde el hub).
export async function tablasDeLaApp(db: Db): Promise<Set<string>> {
  const areas = await db.get('areas?select=tablas&dueno=eq.app')
  return new Set(areas.flatMap(a => (a.tablas as string[]) ?? []))
}

export function disponibles(alcance: Alcance, deLaApp: Set<string>): Herramienta[] {
  return HERRAMIENTAS.filter(h => NIVEL[h.alcance] <= NIVEL[alcance] && !(h.tabla && deLaApp.has(h.tabla)))
}

export async function ejecutar(nombre: string, args: Fila, ctx: Contexto): Promise<unknown> {
  const h = HERRAMIENTAS.find(x => x.name === nombre)
  if (!h) throw new Error(`Herramienta desconocida: ${nombre}`)
  if (NIVEL[h.alcance] > NIVEL[ctx.alcance]) throw new Error(`Este token es de ${ctx.alcance}: «${nombre}» necesita ${h.alcance}`)
  if (h.tabla && (await tablasDeLaApp(ctx.db)).has(h.tabla)) {
    throw new Error(`«${h.tabla}» sigue mandándola la app actual: desde el hub solo se lee`)
  }
  return h.ejecutar(args ?? {}, ctx)
}
