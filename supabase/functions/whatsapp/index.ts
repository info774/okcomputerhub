// whatsapp — el chat de WhatsApp del hub (la ventana fija de abajo a la
// derecha, shell/whatsapp.ts). Las conversaciones siguen siendo de la APP
// ACTUAL: su webhook recibe lo que escriben los clientes en wa_conversaciones /
// wa_mensajes, y esta función las LEE allí (service key de la app, del Vault).
//
// Contestar (acordado con Fran el 2026-10-02): se manda a Meta desde aquí con
// los mismos secrets que la app (WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID) y se
// APUNTA en las tablas de la app igual que su `guardarSaliente`
// (okcomputerclaude/supabase/functions/_shared/whatsapp-app.ts), para que su
// bandeja lo vea. Son las ÚNICAS escrituras del hub en la base de la app:
// wa_mensajes (insert), wa_conversaciones (ultimo_mensaje*, sin_leer). El
// comentario del ticket va al Desk del hub, que es quien lleva los tickets.
//
// Acciones (con sesión de una persona del hub):
//   estado · conversaciones · mensajes {conversacion_id} · leida {conversacion_id}
//   enviar {conversacion_id, texto} · proponer {conversacion_id}
import { makeCorsHeaders, json, getAuthedUser, unauthorized, forbidden } from '../_shared/http.ts'
import { hubDb } from '../_shared/hub-db.ts'
import { personaPorEmail } from '../_shared/personas.ts'
import { claudeConfigurado, preguntarClaude } from '../_shared/claude.ts'
import { dentroDeVentana, enviarTexto, waConfigurado } from '../_shared/whatsapp.ts'

const HUB_URL = Deno.env.get('SUPABASE_URL') ?? ''
const HUB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Variable de entorno o, si falta, el Vault del hub (como sync-app).
async function config(env: string, vault: string): Promise<string> {
  const v = Deno.env.get(env)
  if (v) return v
  const res = await fetch(`${HUB_URL}/rest/v1/rpc/secreto`, {
    method: 'POST',
    headers: { apikey: HUB_KEY, Authorization: `Bearer ${HUB_KEY}`, 'Content-Profile': 'hub', 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_nombre: vault }),
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`No se pudo leer ${vault} del Vault: ${res.status}`)
  return (await res.json()) ?? ''
}

let _app: { url: string; key: string } | null = null
async function app() {
  if (!_app) {
    _app = {
      url: (await config('APP_SUPABASE_URL', 'app_supabase_url')).replace(/\/$/, ''),
      key: await config('APP_SERVICE_ROLE_KEY', 'app_service_role_key'),
    }
  }
  return _app
}

// PostgREST de la app (esquema public). Lanza con el mensaje de PostgREST.
async function appReq(method: string, ruta: string, cuerpo?: unknown) {
  const { url, key } = await app()
  const res = await fetch(`${url}/rest/v1/${ruta}`, {
    method,
    headers: {
      apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
      ...(method === 'GET' ? {} : { Prefer: 'return=representation' }),
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(20000),
  })
  const texto = await res.text()
  if (!res.ok) throw new Error(`app ${method} ${ruta.split('?')[0]}: ${texto.slice(0, 200)}`)
  return texto ? JSON.parse(texto) : null
}

// Con el enlace indicado: wa_conversaciones tiene DOS claves hacia locales
// (local_id y verificado_local_id) y sin indicarlo PostgREST contesta PGRST201.
const CONV_COLS = 'id,telefono,nombre,cliente_id,local_id,ticket_id,ultimo_mensaje,ultimo_mensaje_at,ultimo_entrante_at,sin_leer,'
  + 'clientes!cliente_id(nombre),contactos!contacto_id(nombre),locales!local_id(nombre),tickets!ticket_id(numero,estado)'
const MSG_COLS = 'id,created_at,direccion,tipo,texto,media_url,media_nombre,media_mime,media_descripcion,estado,error,usuario,automatico'

// deno-lint-ignore no-explicit-any
type Fila = Record<string, any>

function convVista(c: Fila) {
  const pendiente = (c.sin_leer ?? 0) > 0
    || (!!c.ultimo_entrante_at && (!c.ultimo_mensaje_at || c.ultimo_entrante_at >= c.ultimo_mensaje_at))
  return {
    id: c.id, telefono: c.telefono,
    nombre: c.clientes?.nombre || c.contactos?.nombre || c.nombre || `+${c.telefono}`,
    perfil: c.nombre ?? null,
    sede: c.locales?.nombre ?? null,
    ticket: c.tickets?.numero ? { id: c.ticket_id, numero: c.tickets.numero, estado: c.tickets.estado } : null,
    ultimo: c.ultimo_mensaje ?? '', ultimo_at: c.ultimo_mensaje_at, ultimo_entrante_at: c.ultimo_entrante_at,
    sin_leer: c.sin_leer ?? 0, pendiente, ventana: dentroDeVentana(c.ultimo_entrante_at),
  }
}

async function conversacion(id: string): Promise<Fila> {
  if (!UUID.test(id)) throw Object.assign(new Error('Conversación no válida'), { status: 400 })
  const [c] = await appReq('GET', `wa_conversaciones?select=${CONV_COLS}&id=eq.${id}`)
  if (!c) throw Object.assign(new Error('Conversación no encontrada'), { status: 404 })
  return c
}

Deno.serve(async req => {
  const cors = makeCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405, cors)
  const user = await getAuthedUser(req)
  if (!user?.email) return unauthorized(cors)
  const yo = await personaPorEmail(hubDb({ origen: 'whatsapp' }), user.email)
  if (!yo) return forbidden(cors, 'No estás dado de alta en el hub.')
  const b = await req.json().catch(() => ({}))
  try {
    if (b.accion === 'estado') return json({ envio: waConfigurado(), claude: claudeConfigurado() }, 200, cors)

    if (b.accion === 'conversaciones') {
      const filas: Fila[] = await appReq('GET', `wa_conversaciones?select=${CONV_COLS}&order=ultimo_mensaje_at.desc.nullslast&limit=40`)
      return json({ conversaciones: filas.map(convVista), envio: waConfigurado() }, 200, cors)
    }

    if (b.accion === 'mensajes') {
      const c = await conversacion(String(b.conversacion_id ?? ''))
      const msgs: Fila[] = await appReq('GET', `wa_mensajes?select=${MSG_COLS}&conversacion_id=eq.${c.id}&order=created_at.desc&limit=80`)
      return json({ conversacion: convVista(c), mensajes: msgs.reverse() }, 200, cors)
    }

    if (b.accion === 'leida') {
      const c = await conversacion(String(b.conversacion_id ?? ''))
      if ((c.sin_leer ?? 0) > 0) await appReq('PATCH', `wa_conversaciones?id=eq.${c.id}`, { sin_leer: 0 })
      return json({ ok: true }, 200, cors)
    }

    if (b.accion === 'enviar') {
      const texto = String(b.texto ?? '').trim()
      if (!texto) return json({ error: 'El mensaje está vacío.' }, 400, cors)
      if (!waConfigurado()) return json({ error: 'Falta poner las claves de WhatsApp en el hub (ver docs/PENDIENTE_FRAN.md).' }, 503, cors)
      const c = await conversacion(String(b.conversacion_id ?? ''))
      if (!dentroDeVentana(c.ultimo_entrante_at)) {
        return json({ error: 'Han pasado más de 24 h desde el último mensaje del cliente: WhatsApp no deja escribirle texto libre hasta que vuelva a escribir.' }, 409, cors)
      }
      const r = await enviarTexto(c.telefono, texto)
      const ahora = new Date().toISOString()
      // Como guardarSaliente de la app: el fallido también se apunta.
      const [msg] = await appReq('POST', 'wa_mensajes', {
        conversacion_id: c.id, direccion: 'saliente', usuario: yo.nombre, created_at: ahora, texto,
        wa_message_id: r.id ?? null, tipo: 'text', estado: r.ok ? 'enviado' : 'fallido', error: r.error ?? null,
      })
      await appReq('PATCH', `wa_conversaciones?id=eq.${c.id}`, { ultimo_mensaje: texto.slice(0, 200), ultimo_mensaje_at: ahora, sin_leer: 0 })
      if (r.ok && c.ticket_id) {
        const db = hubDb({ origen: 'whatsapp', email: user.email })
        const [t] = await db.get(`tickets?select=id&id=eq.${c.ticket_id}`)
        if (t) {
          await db.post('ticket_comentarios', {
            ticket_id: c.ticket_id, autor_id: yo.id, autor_nombre: `${yo.nombre} (WhatsApp)`, texto,
            tipo: 'respuesta', canal: 'whatsapp', enviado_at: ahora,
          }).catch(e => console.error('[whatsapp] comentario del ticket', e))
        }
      }
      return r.ok ? json({ ok: true, mensaje: msg }, 200, cors) : json({ error: r.error, mensaje: msg }, 502, cors)
    }

    if (b.accion === 'proponer') {
      if (!claudeConfigurado()) return json({ propuesta: null, motivo: 'Oki necesita la clave de Claude (ANTHROPIC_API_KEY) para proponer respuestas.' }, 200, cors)
      const c = await conversacion(String(b.conversacion_id ?? ''))
      const msgs: Fila[] = (await appReq('GET', `wa_mensajes?select=direccion,texto,media_descripcion,created_at,usuario&conversacion_id=eq.${c.id}&order=created_at.desc&limit=14`)).reverse()
      const v = convVista(c)
      const hilo = msgs.map(m => `${m.direccion === 'entrante' ? 'CLIENTE' : `NOSOTROS (${m.usuario ?? 'bot'})`}: ${m.texto ?? m.media_descripcion ?? '[adjunto]'}`).join('\n')
      const propuesta = await preguntarClaude({
        sistema: 'Eres Oki, el asistente de OK Computer (servicios informáticos, TPV, alarmas y cámaras en Tenerife). '
          + 'Redacta la PRÓXIMA respuesta de WhatsApp de la empresa al cliente. Tutea, frases cortas, tono cercano y profesional, '
          + 'sin emojis, en español. No prometas horas, precios ni visitas concretas que no salgan de la conversación: si hace falta, '
          + 'di que lo miramos y le decimos. Devuelve SOLO el texto del mensaje, sin comillas ni firma.',
        contenido: `Cliente: ${v.nombre}${v.sede ? ` (sede ${v.sede})` : ''}${v.ticket ? `, ticket #${v.ticket.numero} (${v.ticket.estado})` : ''}\n\nConversación:\n${hilo}`,
        maxTokens: 600, esfuerzo: 'low',
      })
      return json({ propuesta: propuesta.trim() || null }, 200, cors)
    }

    return json({ error: 'Acción desconocida (estado, conversaciones, mensajes, leida, enviar, proponer)' }, 400, cors)
  } catch (e) {
    const status = (e as { status?: number }).status ?? 502
    console.error('[whatsapp]', e)
    return json({ error: (e as Error).message }, status, cors)
  }
})
