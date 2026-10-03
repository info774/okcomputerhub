// reloj — el hub en la muñeca (Galaxy Watch, Wear OS; app en `reloj/`).
//
// Autorización: token propio `okr_…` (hub.reloj_dispositivos) en
// `Authorization: Bearer`. Va en SIN_JWT: el reloj no tiene sesión de Supabase.
// Vinculación como una tele: `vincular` (sin token) devuelve token + código;
// la persona teclea el código en #/reloj y desde ese momento el token vale.
//
// Acciones (POST, cuerpo JSON { accion, … }):
//   vincular                → { token, codigo, caduca }
//   estado                  → { estado: 'pendiente' | 'ok', persona }
//   resumen                 → todo lo que pinta el reloj (avisos, día, RMM, cifras)
//   fichar { que, trabajo_id? } → traslado | inicio | fin (hub.fichar, mismas reglas)
//   comanda { texto }       → crearComanda (lo dictado al reloj)
// Lo que escribe queda en hub.auditoria a nombre de la persona, origen 'reloj'.
import { hubDb, esUuid, type Db, type Fila } from '../_shared/hub-db.ts'
import { esDe, hoyCanarias, limitesHoy, type Persona } from '../_shared/informes.ts'
import { crearComanda } from '../_shared/comandas.ts'

const HUB = 'https://okhub-tenerife.web.app/'
const CAB = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: CAB })
const enlace = (e: unknown) => (typeof e === 'string' && e ? (e.startsWith('#') ? HUB + e : e) : null)
const CERRADOS = ['Completado', 'Para facturar', 'Facturado', 'Cancelado', 'No facturar']
const PESO: Record<string, number> = { mal: 0, aviso: 1 }

interface Sesion { db: Db; persona: Persona; dispositivo: string }

async function validar(db: Db, req: Request) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token.startsWith('okr_')) return null
  const [v] = (await db.rpc('reloj_validar', { p_token: token })) as Fila[] ?? []
  return v ?? null
}

// ── Mi día: paradas de hoy (bloques de agenda y trabajos programados que son
// míos), la sesión de fichaje abierta y si se puede fichar desde el hub.
async function miDia(db: Db, p: Persona) {
  const hoy = hoyCanarias()
  const { ini, fin } = limitesHoy()
  const [ses, agenda, programados, areas] = await Promise.all([
    db.get(`sesiones?select=id,traslado,inicio,entidad_tipo,entidad_id&tecnico_id=eq.${p.id}&fin=is.null&order=created_at.desc&limit=1`),
    db.get(`agenda?select=id,trabajo_id,titulo,inicio,fin,tecnicos&inicio=lte.${fin}&fin=gte.${ini}&order=inicio`),
    db.get(`trabajos?select=id,tecnicos&fecha_programada=eq.${hoy}`),
    db.get('areas?select=tablas&dueno=eq.app'),
  ])
  // hora_llegada es hora de Canarias: se cuenta desde la medianoche de allí.
  const aHoraDeHoy = (h: unknown) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(h ?? ''))
    return m ? new Date(Date.parse(ini) + (Number(m[1]) * 60 + Number(m[2])) * 60000).toISOString() : null
  }
  const deLaApp = new Set(areas.flatMap(a => (a.tablas as string[]) ?? []))
  const puedeFichar = !deLaApp.has('sesiones') && !deLaApp.has('trabajos')
  const mio = (t: unknown) => Array.isArray(t) && (t as string[]).some(n => esDe(n, p))
  const bloques = agenda.filter(b => mio(b.tecnicos))
  const sesion = ses[0] ?? null
  const ids = [...new Set([...bloques.map(b => b.trabajo_id), ...programados.filter(t => mio(t.tecnicos)).map(t => t.id),
    sesion?.entidad_tipo === 'trabajo' ? sesion.entidad_id : null].filter(esUuid))] as string[]
  const trabajos = ids.length
    ? await db.get(`trabajos?select=id,numero,titulo,descripcion,estado,cliente_id,local_id,contacto_id,fecha_programada,hora_llegada&id=in.(${ids.join(',')})`)
    : []
  const unicos = (k: string) => [...new Set(trabajos.map(t => t[k]).filter(esUuid))] as string[]
  const [locales, clientes, contactos] = await Promise.all([
    unicos('local_id').length ? db.get(`locales?select=id,nombre,direccion,lat,lng&id=in.(${unicos('local_id').join(',')})`) : [],
    unicos('cliente_id').length ? db.get(`clientes?select=id,nombre,telefono&id=in.(${unicos('cliente_id').join(',')})`) : [],
    unicos('contacto_id').length ? db.get(`contactos?select=id,nombre,telefono&id=in.(${unicos('contacto_id').join(',')})`) : [],
  ])
  const parada = (t: Fila | undefined, inicio: string | null, finB: string | null, tituloBloque: unknown) => {
    const l = locales.find(x => x.id === t?.local_id), c = clientes.find(x => x.id === t?.cliente_id), k = contactos.find(x => x.id === t?.contacto_id)
    const mapa = l?.lat && l?.lng ? `https://www.google.com/maps/dir/?api=1&destination=${l.lat},${l.lng}`
      : l?.direccion ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(String(l.direccion))}` : null
    return {
      trabajo_id: t?.id ?? null, numero: t?.numero ?? null,
      titulo: t ? String(t.titulo ?? String(t.descripcion ?? '').slice(0, 60)) : String(tituloBloque ?? 'Cita'),
      estado: t?.estado ?? null, inicio, fin: finB,
      cliente: c?.nombre ?? null, sede: l?.nombre ?? null, direccion: l?.direccion ?? null,
      telefono: k?.telefono ?? c?.telefono ?? null, mapa, enlace: t ? `${HUB}#/trabajos/${t.numero}` : null,
    }
  }
  const paradas = [
    ...bloques.map(b => parada(trabajos.find(t => t.id === b.trabajo_id), b.inicio as string, b.fin as string, b.titulo)),
    ...trabajos.filter(t => programados.some(x => x.id === t.id && mio(x.tecnicos)) && !bloques.some(b => b.trabajo_id === t.id))
      .map(t => parada(t, aHoraDeHoy(t.hora_llegada), null, null)),
  ].sort((a, b) => (a.inicio ?? '9').localeCompare(b.inicio ?? '9'))
  const pendientes = paradas.filter(x => !CERRADOS.includes(String(x.estado ?? '')))
  const siguiente = pendientes.find(x => !x.fin || new Date(x.fin) > new Date()) ?? pendientes[0] ?? null
  const enCurso = sesion?.entidad_tipo === 'trabajo' ? trabajos.find(t => t.id === sesion.entidad_id) : null
  return {
    puede_fichar: puedeFichar,
    sesion: sesion ? {
      estado: sesion.inicio ? 'trabajando' : 'traslado', desde: sesion.inicio ?? sesion.traslado,
      trabajo: enCurso ? { id: enCurso.id, numero: enCurso.numero, titulo: enCurso.titulo } : null,
    } : null,
    siguiente, paradas,
  }
}

async function rmm(db: Db) {
  const [estados, desconectados, alertas] = await Promise.all([
    db.get('rmm_estado_local?select=local_id,estado,equipos,conectados,alertas'),
    db.get('rmm_equipos?select=id&conectado=eq.false'),
    db.get('rmm_alertas?select=id,hostname,sitio,severidad,titulo,disparada&estado=eq.active&order=disparada.desc&limit=8'),
  ])
  const sedes = { ok: 0, alerta: 0, parcial: 0, caido: 0 } as Record<string, number>
  for (const e of estados) sedes[String(e.estado)] = (sedes[String(e.estado)] ?? 0) + 1
  const orden: Record<string, number> = { caido: 0, alerta: 1, parcial: 2 }
  const peores = estados.filter(e => e.estado !== 'ok').sort((a, b) => orden[String(a.estado)] - orden[String(b.estado)]).slice(0, 8)
  const ids = peores.map(e => e.local_id).filter(esUuid)
  const nombres = ids.length ? await db.get(`locales?select=id,nombre&id=in.(${ids.join(',')})`) : []
  return {
    sedes, equipos_sin_conexion: desconectados.length, alertas_abiertas: alertas.length,
    peores: peores.map(e => ({ sede: nombres.find(l => l.id === e.local_id)?.nombre ?? 'Sede', estado: e.estado,
      conectados: e.conectados, equipos: e.equipos, alertas: e.alertas, enlace: `${HUB}#/monitorizacion/sede/${e.local_id}` })),
    alertas: alertas.map(a => ({ equipo: a.hostname, sitio: a.sitio, severidad: a.severidad, titulo: a.titulo, desde: a.disparada })),
  }
}

async function cifras(db: Db, p: Persona) {
  if (p.rol !== 'admin') return null
  const [r, tickets, ops] = await Promise.all([
    db.rpc('direccion_resumen', { p_para: p.id }) as Promise<Fila | null>,
    db.get('tickets?select=id,prioridad&estado=in.(Abierto,"En curso",Pendiente)'),
    db.get('oportunidades?select=valor_estimado&cerrada_at=is.null'),
  ])
  return {
    tickets_abiertos: tickets.length,
    tickets_urgentes: tickets.filter(t => ['Urgente', 'Alta'].includes(String(t.prioridad))).length,
    oportunidades_abiertas: ops.length,
    oportunidades_importe: ops.reduce((s, o) => s + Number(o.valor_estimado ?? 0), 0),
    facturado_mes: Number(r?.facturado_mes ?? 0), cobrado_mes: Number(r?.cobrado_mes ?? 0),
    pendiente: Number(r?.pendiente ?? 0), vencido: Number(r?.vencido ?? 0),
    facturas_vencidas: Number(r?.facturas_vencidas ?? 0), para_facturar: Number(r?.para_facturar ?? 0),
  }
}

async function resumen({ db, persona }: Sesion) {
  const [avisos, dia, monitor, numeros] = await Promise.all([
    db.rpc('panorama_direccion', { p_para: persona.id }) as Promise<Fila[] | null>,
    miDia(db, persona), rmm(db), cifras(db, persona),
  ])
  const lista = (avisos ?? []).slice().sort((a, b) => (PESO[String(a.gravedad)] ?? 2) - (PESO[String(b.gravedad)] ?? 2))
  return {
    generado: new Date().toISOString(),
    persona: { nombre: persona.nombre, admin: persona.rol === 'admin' },
    avisos: {
      total: lista.length, urgentes: lista.filter(a => a.gravedad === 'mal').length,
      lista: lista.slice(0, 30).map(a => ({ tipo: a.tipo, gravedad: a.gravedad, titulo: a.titulo, detalle: a.detalle, enlace: enlace(a.enlace) })),
    },
    dia, rmm: monitor, cifras: numeros,
  }
}

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
  const cuerpo = await req.json().catch(() => ({})) as Fila
  const accion = String(cuerpo.accion ?? '')
  const sistema = hubDb({ origen: 'reloj' })
  try {
    if (accion === 'vincular') {
      const [v] = (await sistema.rpc('reloj_iniciar', {})) as Fila[]
      return json({ token: v.token, codigo: v.codigo, caduca: v.caduca, url: `${HUB}#/reloj` })
    }
    const v = await validar(sistema, req)
    if (!v) return json({ error: 'Reloj sin vincular o desvinculado', estado: 'sin_vincular' }, 401)
    if (v.estado === 'pendiente') return json({ estado: 'pendiente' }, accion === 'estado' ? 200 : 409)
    const persona: Persona = { id: v.usuario_id as string, nombre: v.nombre as string, email: v.email as string, rol: v.rol as string }
    const s: Sesion = { db: hubDb({ origen: 'reloj', email: persona.email }), persona, dispositivo: String(v.dispositivo ?? '') }
    switch (accion) {
      case 'estado':
        return json({ estado: 'ok', persona: { nombre: persona.nombre, admin: persona.rol === 'admin' }, dispositivo: s.dispositivo })
      case 'resumen':
        return json(await resumen(s))
      case 'fichar': {
        const que = String(cuerpo.que ?? '')
        if (!['traslado', 'inicio', 'fin'].includes(que)) return json({ error: 'Fichar: traslado, inicio o fin' }, 400)
        if (que === 'inicio' && !esUuid(cuerpo.trabajo_id)) return json({ error: 'Falta el trabajo en el que empiezas' }, 400)
        const r = await sistema.rpc('reloj_fichar', {
          p_usuario_id: persona.id, p_accion: que, p_tipo: que === 'inicio' ? 'trabajo' : null, p_id: que === 'inicio' ? cuerpo.trabajo_id : null })
        return json({ ok: true, resultado: r })
      }
      case 'comanda': {
        const r = await crearComanda(s.db, { texto: String(cuerpo.texto ?? ''), origen: 'reloj', autorId: persona.id, autorNombre: persona.nombre })
        return json({ ok: true, tareas: r.tareas.length, con_claude: r.con_claude })
      }
      default:
        return json({ error: `Acción desconocida: ${accion}` }, 400)
    }
  } catch (e) {
    console.error(`[reloj] ${accion}:`, e)
    // El mensaje de la base es para personas («Ya tienes una sesión abierta»): se enseña en el reloj.
    return json({ error: (e as Error).message.replace(/^POST rpc\/\w+: /, '') }, 422)
  }
})
