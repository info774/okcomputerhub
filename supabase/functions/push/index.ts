// push — avisos en el dispositivo (paridad bloque 6: send-push-notifications y
// send-chat-push de la app, en una). Acciones:
//   { accion: 'registrar', endpoint, p256dh, auth }  guarda el navegador a nombre de
//        quien tiene la sesión (si el endpoint era de otra persona, cambia de dueño:
//        por eso lo hace la función y no la RLS, como en la app)
//   { accion: 'quitar', endpoint }                   deja de avisar en ese navegador
//   { accion: 'probar' }                             un aviso de prueba a los míos
//   { accion: 'chat', mensaje_id }                   el mensaje de chat que acabo de
//        escribir, a los demás del canal (directo / ficha: sus miembros; grupo: todos)
//   { accion: 'proximos' }                           pg_cron cada 15 min: trabajos que
//        empiezan en ~1 h, a sus técnicos. NO hace nada mientras la agenda sea de la
//        app (avisa la app; desde los dos llegaría dos veces).
// SIN_JWT: la autoriza la sesión de una persona del hub o el token del cron.
import { makeCorsHeaders, json, getAuthedUser, unauthorized, forbidden, mismoToken } from '../_shared/http.ts'
import { hubDb, esUuid, type Db } from '../_shared/hub-db.ts'
import { avisarPush, pushConfigurado } from '../_shared/push.ts'
import { esDe } from '../_shared/informes.ts'

interface Persona { id: string; nombre: string; email: string; rol: string }

async function personaPorEmail(db: Db, email: string): Promise<Persona | null> {
  const f = await db.get(`usuarios?select=id,nombre,email,rol&activo=eq.true&email=ilike.${encodeURIComponent(email.replace(/[\\%_*]/g, ''))}&limit=1`)
  return (f[0] as unknown as Persona) ?? null
}

const delHub = async (db: Db, tabla: string) => {
  const a = await db.get(`areas?select=dueno&tablas=cs.{${tabla}}&limit=1`)
  return ((a[0]?.dueno as string | undefined) ?? 'hub') === 'hub'
}

async function proximos(db: Db) {
  if (!(await delHub(db, 'agenda'))) return { omitido: 'La agenda es todavía de la app: avisa la app.' }
  const desde = new Date(Date.now() + 45 * 60_000).toISOString(), hasta = new Date(Date.now() + 75 * 60_000).toISOString()
  const bloques = await db.get(`agenda?select=trabajo_id,tecnicos,inicio&trabajo_id=not.is.null&inicio=gte.${desde}&inicio=lte.${hasta}`)
  if (!bloques.length) return { enviados: 0 }
  const ids = [...new Set(bloques.map(b => b.trabajo_id as string))]
  const [trabajos, personas] = await Promise.all([
    db.get(`trabajos?select=id,numero,titulo,estado,tecnicos,local_id,cliente_id&id=in.(${ids.join(',')})&estado=in.(Pendiente,"En progreso")`),
    db.get('usuarios?select=id,nombre,email,rol&activo=eq.true') as unknown as Promise<Persona[]>,
  ])
  const locIds = [...new Set(trabajos.map(t => t.local_id).filter(Boolean))]
  const locales = locIds.length ? await db.get(`locales?select=id,nombre&id=in.(${locIds.join(',')})`) : []
  let enviados = 0
  for (const b of bloques) {
    const t = trabajos.find(x => x.id === b.trabajo_id)
    if (!t) continue
    // Los técnicos del DÍA mandan sobre los del trabajo (cada jornada puede llevar otros).
    const nombres = ((b.tecnicos as string[] | null)?.length ? b.tecnicos : t.tecnicos) as string[] | null ?? []
    const para = nombres.length ? personas.filter(p => nombres.some(n => esDe(n, p))) : personas
    const hora = new Date(b.inicio as string).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Atlantic/Canary' })
    const sitio = locales.find(l => l.id === t.local_id)?.nombre
    const r = await avisarPush(para.map(p => p.id), { title: `A las ${hora}: #${t.numero ?? ''} ${t.titulo ?? ''}`.trim(),
      body: sitio ? `En ${sitio}` : 'Empieza en una hora', tag: `trabajo-${t.id}`, url: `/#/trabajos/${t.numero ?? t.id}` })
    enviados += r.enviados
  }
  return { enviados }
}

Deno.serve(async req => {
  const cors = makeCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405, cors)
  const b = await req.json().catch(() => ({})) as Record<string, unknown>
  const db = hubDb({ origen: 'push' })

  const cabecera = req.headers.get('x-sync-token') ?? ''
  if (cabecera) {
    const token = Deno.env.get('HUB_SYNC_TOKEN') ?? ((await db.rpc('secreto', { p_nombre: 'hub_sync_token' }).catch(() => null)) as string | null) ?? ''
    if (!mismoToken(cabecera, token)) return unauthorized(cors)
    if (b.accion !== 'proximos') return json({ error: 'Acción no válida para el cron' }, 400, cors)
    try { return json(await proximos(db), 200, cors) } catch (e) { return json({ error: (e as Error).message }, 502, cors) }
  }

  const user = await getAuthedUser(req)
  if (!user?.email) return unauthorized(cors)
  const yo = await personaPorEmail(db, user.email)
  if (!yo) return forbidden(cors, 'No estás dado de alta en el hub.')

  try {
    switch (b.accion) {
      case 'registrar': {
        const endpoint = String(b.endpoint ?? '')
        if (!/^https:\/\/\S+$/.test(endpoint) || endpoint.length > 2000) return json({ error: 'Ese navegador no ha dado una dirección de avisos válida' }, 400, cors)
        if (!b.p256dh || !b.auth) return json({ error: 'Faltan las claves del navegador' }, 400, cors)
        await db.upsert('push_suscripciones', 'endpoint', [{ endpoint, usuario_id: yo.id, p256dh: String(b.p256dh).slice(0, 300), auth: String(b.auth).slice(0, 300),
          dispositivo: String(req.headers.get('user-agent') ?? '').slice(0, 200), ultimo_error: null }])
        return json({ ok: true, configurado: pushConfigurado() }, 200, cors)
      }
      case 'quitar': {
        const endpoint = String(b.endpoint ?? '')
        if (endpoint) await db.del(`push_suscripciones?endpoint=eq.${encodeURIComponent(endpoint)}&usuario_id=eq.${yo.id}`)
        return json({ ok: true }, 200, cors)
      }
      case 'probar': {
        if (!pushConfigurado()) return json({ error: 'Faltan las claves VAPID del hub (docs/PENDIENTE_FRAN.md)' }, 503, cors)
        const r = await avisarPush([yo.id], { title: 'Prueba del hub', body: `Así te llegarán los avisos, ${yo.nombre.split(/\s+/)[0]}.`, tag: 'hub-prueba', url: '/#/configuracion' })
        return json(r, 200, cors)
      }
      case 'chat': {
        if (!esUuid(b.mensaje_id)) return json({ error: 'mensaje_id no válido' }, 400, cors)
        const [m] = await db.get(`chat_mensajes?select=id,canal_id,autor_id,texto&id=eq.${b.mensaje_id}`)
        if (!m) return json({ error: 'No existe ese mensaje' }, 404, cors)
        if (m.autor_id !== yo.id) return forbidden(cors, 'Solo quien escribe el mensaje avisa de él.')
        const [c] = await db.get(`chat_canales?select=id,nombre,tipo,miembros&id=eq.${m.canal_id}`)
        if (!c) return json({ error: 'No existe ese canal' }, 404, cors)
        const para = c.tipo === 'grupo'
          ? (await db.get('usuarios?select=id&activo=eq.true')).map(u => u.id as string)
          : ((c.miembros as string[] | null) ?? [])
        const titulo = c.tipo === 'directo' ? yo.nombre : `${yo.nombre} en ${c.nombre ?? 'el chat'}`
        const r = await avisarPush(para.filter(id => id !== yo.id), { title: titulo, body: String(m.texto), tag: `chat-${c.id}`, url: `/#/chat/${c.id}`, chat: c.id as string })
        return json(r, 200, cors)
      }
      default:
        return json({ error: 'Acción desconocida' }, 400, cors)
    }
  } catch (e) {
    console.error('[push]', e)
    return json({ error: (e as Error).message }, 502, cors)
  }
})
