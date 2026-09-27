// informes-enviar — manda los informes del hub por Telegram.
//
// Va en SIN_JWT porque la llama pg_cron cada 15 min (hub.lanzar_funcion,
// cabecera x-sync-token = hub_sync_token): { accion: 'programados' } manda los
// que tocan (día de la semana y hora de Canarias ya pasada, y no enviados hoy).
// Desde el hub, con la sesión de la persona:
//   { accion: 'vista_previa', tipo }   → el texto, sin mandar nada
//   { accion: 'enviar_ahora', id }     → uno de sus informes programados (o
//                                         cualquiera, si es admin)
//   { accion: 'enviar_tipo', tipo }    → ese informe a su propio Telegram
// Los de dinero solo a admins. Cada envío queda en hub.informes_envios.
import { makeCorsHeaders, json, getAuthedUser, unauthorized, forbidden, mismoToken } from '../_shared/http.ts'
import { hubDb, type Db, esUuid } from '../_shared/hub-db.ts'
import { construirInforme, TIPOS, type Persona } from '../_shared/informes.ts'
import { enviarTelegram, telegramConfigurado } from '../_shared/mensajeria.ts'
import { personaPorEmail, personaPorId, chatDe } from '../_shared/personas.ts'

async function mandar(db: Db, p: Persona, tipo: string, origen: 'programado' | 'manual', informeId: string | null) {
  let texto = '', error: string | null = null
  try {
    texto = await construirInforme(db, tipo, p)
    const chat = await chatDe(db, p.id)
    if (!chat) throw new Error('No tiene Telegram vinculado (Informes → Vincular mi Telegram)')
    await enviarTelegram(chat, texto)
  } catch (e) { error = (e as Error).message }
  await db.post('informes_envios', { informe_id: informeId, tipo, usuario_id: p.id, origen, ok: !error, error, texto: texto.slice(0, 8000) })
    .catch(e => console.error('[informes] no se pudo apuntar el envío:', e))
  return { ok: !error, error }
}

// Día de la semana (1 = lunes) y hora «HH:MM» de ahora en Canarias.
function ahoraCanarias() {
  const d = new Date()
  const dia = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(d.toLocaleDateString('en-US', { timeZone: 'Atlantic/Canary', weekday: 'short' })) + 1
  const hora = d.toLocaleTimeString('en-GB', { timeZone: 'Atlantic/Canary', hour: '2-digit', minute: '2-digit', hour12: false })
  const hoy = d.toLocaleDateString('sv-SE', { timeZone: 'Atlantic/Canary' })
  return { dia, hora, hoy }
}

async function programados(db: Db) {
  const { dia, hora, hoy } = ahoraCanarias()
  const filas = await db.get(`informes_programados?select=id,tipo,usuario_id,hora,dias,ultimo_envio_at&activo=eq.true&dias=cs.{${dia}}&hora=lte.${hora}`)
  const pendientes = filas.filter(f => !f.ultimo_envio_at ||
    new Date(f.ultimo_envio_at as string).toLocaleDateString('sv-SE', { timeZone: 'Atlantic/Canary' }) !== hoy)
  const resultado = []
  for (const f of pendientes) {
    // Se apunta el intento antes de mandar: un informe roto no reintenta cada 15 min.
    await db.patch(`informes_programados?id=eq.${f.id}`, { ultimo_envio_at: new Date().toISOString() })
    const p = await personaPorId(db, f.usuario_id as string)
    if (!p) continue
    resultado.push({ id: f.id, tipo: f.tipo, ...(await mandar(db, p, f.tipo as string, 'programado', f.id as string)) })
  }
  return { hora, dia, revisados: filas.length, enviados: resultado }
}

Deno.serve(async req => {
  const cors = makeCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405, cors)
  const db = hubDb({ origen: 'informes' })
  const cuerpo = await req.json().catch(() => ({}))

  const tokenCron = ((await db.rpc('secreto', { p_nombre: 'hub_sync_token' }).catch(() => '')) as string) || ''
  if (mismoToken(req.headers.get('x-sync-token') ?? '', tokenCron)) {
    if (!telegramConfigurado()) return json({ ok: false, motivo: 'Falta TELEGRAM_BOT_TOKEN' }, 200, cors)
    return json({ ok: true, ...(await programados(db)) }, 200, cors)
  }

  const user = await getAuthedUser(req)
  if (!user?.email) return unauthorized(cors)
  const p = await personaPorEmail(db, user.email)
  if (!p) return forbidden(cors, 'No estás dado de alta en el hub.')
  try {
    if (cuerpo.accion === 'vista_previa') {
      if (!TIPOS[cuerpo.tipo]) return json({ error: 'Informe desconocido' }, 400, cors)
      return json({ texto: await construirInforme(db, cuerpo.tipo, p) }, 200, cors)
    }
    if (!telegramConfigurado()) return json({ error: 'El bot de Telegram aún no está puesto (ver docs/FASE3.md)' }, 503, cors)
    if (cuerpo.accion === 'enviar_tipo') {
      if (!TIPOS[cuerpo.tipo]) return json({ error: 'Informe desconocido' }, 400, cors)
      return json(await mandar(db, p, cuerpo.tipo, 'manual', null), 200, cors)
    }
    if (cuerpo.accion === 'enviar_ahora') {
      if (!esUuid(cuerpo.id)) return json({ error: 'id no válido' }, 400, cors)
      const [inf] = await db.get(`informes_programados?select=id,tipo,usuario_id&id=eq.${cuerpo.id}`)
      if (!inf) return json({ error: 'No existe ese informe' }, 404, cors)
      if (inf.usuario_id !== p.id && p.rol !== 'admin') return forbidden(cors, 'Ese informe no es tuyo.')
      const destino = inf.usuario_id === p.id ? p : await personaPorId(db, inf.usuario_id as string)
      if (!destino) return json({ error: 'La persona de ese informe ya no está activa' }, 409, cors)
      return json(await mandar(db, destino, inf.tipo as string, 'manual', inf.id as string), 200, cors)
    }
    return json({ error: 'Acción desconocida (vista_previa, enviar_tipo, enviar_ahora)' }, 400, cors)
  } catch (e) {
    return json({ error: (e as Error).message }, 400, cors)
  }
})
