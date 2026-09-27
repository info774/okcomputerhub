// telegram-bot — el bot del hub en Telegram.
//
// Va en SIN_JWT: lo llama Telegram (webhook), autorizado por la cabecera
// X-Telegram-Bot-Api-Secret-Token = TELEGRAM_WEBHOOK_SECRET (se le da a
// Telegram al configurar el webhook). Solo contesta a chats VINCULADOS a una
// persona del hub (hub.telegram_vinculos): el bot no enseña nada a un extraño.
//
// Comandos: /start <código> (vincular), /avisos, /repaso, /cierre, /rmm,
// /proyectos, /cobros y /ventas (solo admins), /baja (desvincular), /ayuda.
//
// Desde el hub, con sesión: { accion: 'estado' } (cualquiera: el nombre del bot
// para el enlace de vincular) y { accion: 'configurar' } (admin: webhook y
// menú de comandos en Telegram).
import { makeCorsHeaders, json, getAuthedUser, isAdminUser, unauthorized, forbidden, mismoToken } from '../_shared/http.ts'
import { hubDb, type Db } from '../_shared/hub-db.ts'
import { construirInforme, TIPOS } from '../_shared/informes.ts'
import { telegram, enviarTelegram, telegramConfigurado, h } from '../_shared/mensajeria.ts'
import { personaPorEmail, personaPorId } from '../_shared/personas.ts'
import { preguntar } from '../_shared/rag.ts'

const secreto = () => Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? ''
const URL_WEBHOOK = `${Deno.env.get('SUPABASE_URL')}/functions/v1/telegram-bot`
const HUB = 'https://okhub-tenerife.web.app/#/informes'

const COMANDOS = Object.fromEntries(Object.entries(TIPOS).map(([tipo, t]) => [t.comando, tipo]))
const AYUDA = (admin: boolean) => ['<b>Ok Computer Hub</b> — lo que te puedo mandar:',
  ...Object.values(TIPOS).filter(t => admin || !t.dinero).map(t => `/${t.comando} — ${h(t.nombre)}`),
  '/pregunta <lo que quieras saber> — busca en la wiki y los documentos', '/baja — desvincular este chat', '', `Los informes automáticos se programan en <a href="${HUB}">Informes</a>.`].join('\n')

// deno-lint-ignore no-explicit-any
async function atender(db: Db, msg: any) {
  const chat = msg?.chat?.id
  const texto: string = (msg?.text ?? '').trim()
  if (!chat || !texto || msg.chat.type !== 'private') return
  const [cmd, arg] = texto.split(/\s+/, 2)
  const comando = cmd.replace(/^\//, '').replace(/@.*$/, '').toLowerCase()

  if (comando === 'start' && arg) {
    const [v] = await db.get(`telegram_vinculos?select=usuario_id,codigo_caduca&codigo=eq.${encodeURIComponent(arg)}`)
    if (!v || new Date(v.codigo_caduca as string) < new Date()) {
      return enviarTelegram(chat, `Ese código no vale o ya caducó. Pide otro en <a href="${HUB}">Informes → Vincular mi Telegram</a>.`)
    }
    // Un chat, una persona: si este chat estaba con otra, se suelta.
    await db.patch(`telegram_vinculos?chat_id=eq.${chat}&usuario_id=neq.${v.usuario_id}`, { chat_id: null, vinculado_at: null })
    await db.patch(`telegram_vinculos?usuario_id=eq.${v.usuario_id}`, {
      chat_id: chat, nombre_tg: [msg.from?.first_name, msg.from?.username && `@${msg.from.username}`].filter(Boolean).join(' '),
      vinculado_at: new Date().toISOString(), codigo: null, codigo_caduca: null, activo: true })
    const p = await personaPorId(db, v.usuario_id as string)
    return enviarTelegram(chat, `✅ Hola, ${h(p?.nombre ?? '')}. Este chat ya está vinculado al hub.\n\n${AYUDA(p?.rol === 'admin')}`)
  }

  const [v] = await db.get(`telegram_vinculos?select=usuario_id&chat_id=eq.${chat}&activo=eq.true`)
  const p = v ? await personaPorId(db, v.usuario_id as string) : null
  if (!p) return enviarTelegram(chat, `No te conozco todavía. Entra en <a href="${HUB}">el hub → Informes</a> y pulsa «Vincular mi Telegram».`)

  if (comando === 'baja') {
    await db.patch(`telegram_vinculos?usuario_id=eq.${p.id}`, { chat_id: null, vinculado_at: null })
    return enviarTelegram(chat, 'Hecho: este chat ya no está vinculado. Puedes volver a vincularlo desde el hub.')
  }
  if (comando === 'pregunta' || comando === 'p') {
    const q = texto.replace(/^\/\S+\s*/, '')
    if (!q) return enviarTelegram(chat, 'Escribe la pregunta detrás: /pregunta ¿qué router tiene el Hotel Playa?')
    try {
      const r = await preguntar(hubDb({ origen: 'telegram', email: p.email }), q)
      const fuentes = r.fuentes.slice(0, 5).map(f => `[${f.n}] ${f.url ? `<a href="${h(f.url.startsWith('#') ? 'https://okhub-tenerife.web.app/' + f.url : f.url)}">${h(f.titulo)}</a>` : h(f.titulo)}`).join('\n')
      return enviarTelegram(chat, `${h(r.respuesta ?? 'Esto es lo que he encontrado:')}\n\n<b>Fuentes</b>\n${fuentes || '—'}`)
    } catch (e) { return enviarTelegram(chat, `⚠️ ${h((e as Error).message)}`) }
  }
  const tipo = COMANDOS[comando]
  if (!tipo) return enviarTelegram(chat, AYUDA(p.rol === 'admin'))
  let salida = ''
  let error: string | null = null
  try { salida = await construirInforme(db, tipo, p) } catch (e) { error = (e as Error).message; salida = `⚠️ ${h(error)}` }
  await enviarTelegram(chat, salida)
  await db.post('informes_envios', { tipo, usuario_id: p.id, origen: 'bot', ok: !error, error, texto: salida.slice(0, 8000) })
    .catch(e => console.error('[telegram-bot] no se pudo apuntar:', e))
}

Deno.serve(async req => {
  const cors = makeCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405, cors)
  const db = hubDb({ origen: 'telegram' })

  // ── Telegram ────────────────────────────────────────────────────────────
  const firma = req.headers.get('X-Telegram-Bot-Api-Secret-Token')
  if (firma !== null) {
    if (!secreto() || !mismoToken(firma, secreto())) return json({ error: 'No autorizado' }, 401)
    const update = await req.json().catch(() => null)
    // Siempre 200: Telegram reintenta lo que no conteste bien y se repetirían respuestas.
    try { await atender(db, update?.message) } catch (e) { console.error('[telegram-bot]', e) }
    return json({ ok: true })
  }

  // ── Desde el hub ────────────────────────────────────────────────────────
  const user = await getAuthedUser(req)
  if (!user?.email) return unauthorized(cors)
  if (!(await personaPorEmail(db, user.email))) return forbidden(cors, 'No estás dado de alta en el hub.')
  const cuerpo = await req.json().catch(() => ({}))
  try {
    if (cuerpo.accion === 'estado') {
      if (!telegramConfigurado()) return json({ configurado: false }, 200, cors)
      const yo = await telegram('getMe')
      const admin = await isAdminUser(user)
      const hook = admin ? await telegram('getWebhookInfo') : null
      return json({ configurado: true, usuario: yo.username, nombre: yo.first_name,
        webhook: hook ? { puesto: hook.url === URL_WEBHOOK, pendientes: hook.pending_update_count, ultimo_error: hook.last_error_message ?? null } : undefined },
      200, cors)
    }
    if (cuerpo.accion === 'configurar') {
      if (!(await isAdminUser(user))) return forbidden(cors)
      if (!telegramConfigurado() || !secreto()) return json({ error: 'Faltan TELEGRAM_BOT_TOKEN / TELEGRAM_WEBHOOK_SECRET' }, 503, cors)
      await telegram('setWebhook', { url: URL_WEBHOOK, secret_token: secreto(), allowed_updates: ['message'], drop_pending_updates: true })
      await telegram('setMyCommands', { commands: [
        ...Object.values(TIPOS).map(t => ({ command: t.comando, description: t.nombre + (t.dinero ? ' (admins)' : '') })),
        { command: 'pregunta', description: 'Preguntar a la wiki y los documentos' },
        { command: 'baja', description: 'Desvincular este chat' }, { command: 'ayuda', description: 'Qué te puedo mandar' }] })
      return json({ ok: true }, 200, cors)
    }
    return json({ error: 'Acción desconocida (estado, configurar)' }, 400, cors)
  } catch (e) {
    return json({ error: (e as Error).message }, 502, cors)
  }
})
