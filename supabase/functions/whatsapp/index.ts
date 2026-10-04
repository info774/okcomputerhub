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
//   plantilla {conversacion_id}: fuera de las 24 h, la plantilla de retomar la
//   conversación (WHATSAPP_PLANTILLA_TEXTO); se apunta como la app apunta las
//   suyas (tipo `template`).
//   media {conversacion_id, mensaje_id}: la foto o el fichero que mandó el
//   cliente, pedido a Meta cuando la app no guardó copia (media_url).
//   documentos {conversacion_id}: las facturas y presupuestos de Zoho del
//   cliente (del espejo del hub). enviar_documento {conversacion_id, tipo,
//   zoho_id}: baja el PDF de Zoho Books y lo manda (suelto en las 24 h, con
//   WHATSAPP_PLANTILLA_DOCUMENTO fuera), como enviarDocumentoZoho de la app;
//   solo documentos de ESE cliente.
import { makeCorsHeaders, json, getAuthedUser, unauthorized, forbidden } from '../_shared/http.ts'
import { hubDb } from '../_shared/hub-db.ts'
import { personaPorEmail } from '../_shared/personas.ts'
import { claudeConfigurado, preguntarClaude } from '../_shared/claude.ts'
import {
  dentroDeVentana, enviarPlantillaTexto, enviarTexto, plantillaTexto, waConfigurado,
  plantillaDocumento, enviarDocumento, enviarPlantillaDocumento, subirMedia, descargarMedia,
} from '../_shared/whatsapp.ts'
import { zohoCtx, zohoAccessToken } from '../_shared/zoho-ctx.ts'

const MAX_MEDIA = 12 * 1024 * 1024

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
const CONV_COLS = 'id,telefono,nombre,cliente_id,local_id,contacto_id,ticket_id,ultimo_mensaje,ultimo_mensaje_at,ultimo_entrante_at,sin_leer,'
  + 'clientes!cliente_id(nombre),contactos!contacto_id(nombre),locales!local_id(nombre),tickets!ticket_id(numero,estado)'
const MSG_COLS = 'id,created_at,direccion,tipo,texto,media_id,media_url,media_nombre,media_mime,media_descripcion,estado,error,usuario,automatico'

// deno-lint-ignore no-explicit-any
type Fila = Record<string, any>

function convVista(c: Fila) {
  const pendiente = (c.sin_leer ?? 0) > 0
    || (!!c.ultimo_entrante_at && (!c.ultimo_mensaje_at || c.ultimo_entrante_at >= c.ultimo_mensaje_at))
  return {
    id: c.id, telefono: c.telefono, cliente_id: c.cliente_id ?? null, local_id: c.local_id ?? null, contacto_id: c.contacto_id ?? null,
    nombre: c.clientes?.nombre || c.contactos?.nombre || c.nombre || `+${c.telefono}`,
    perfil: c.nombre ?? null,
    sede: c.locales?.nombre ?? null,
    ticket: c.tickets?.numero ? { id: c.ticket_id, numero: c.tickets.numero, estado: c.tickets.estado } : null,
    ultimo: c.ultimo_mensaje ?? '', ultimo_at: c.ultimo_mensaje_at, ultimo_entrante_at: c.ultimo_entrante_at,
    sin_leer: c.sin_leer ?? 0, pendiente, ventana: dentroDeVentana(c.ultimo_entrante_at),
  }
}

// Lo mandado al cliente queda también en el ticket abierto (Desk del hub), para quien lo lleve.
async function comentarTicket(c: Fila, texto: string, ahora: string, yo: { id: string; nombre: string }, email: string) {
  if (!c.ticket_id) return
  const db = hubDb({ origen: 'whatsapp', email })
  const [t] = await db.get(`tickets?select=id&id=eq.${c.ticket_id}`)
  if (!t) return
  await db.post('ticket_comentarios', {
    ticket_id: c.ticket_id, autor_id: yo.id, autor_nombre: `${yo.nombre} (WhatsApp)`, texto,
    tipo: 'respuesta', canal: 'whatsapp', enviado_at: ahora,
  }).catch(e => console.error('[whatsapp] comentario del ticket', e))
}

async function conversacion(id: string): Promise<Fila> {
  if (!UUID.test(id)) throw Object.assign(new Error('Conversación no válida'), { status: 400 })
  const [c] = await appReq('GET', `wa_conversaciones?select=${CONV_COLS}&id=eq.${id}`)
  if (!c) throw Object.assign(new Error('Conversación no encontrada'), { status: 404 })
  return c
}

// Las facturas (trabajos facturados en Zoho, sin repetir, las 10 últimas) y
// los presupuestos de Zoho del cliente, del espejo del hub (waElegirDocumento de la app).
async function documentosDe(clienteId: string) {
  const db = hubDb({ origen: 'whatsapp' })
  const [f, p]: Fila[][] = await Promise.all([
    db.get(`trabajos?select=zoho_invoice_id,zoho_invoice_number&cliente_id=eq.${clienteId}&zoho_invoice_id=not.is.null&order=created_at.desc&limit=30`),
    db.get(`presupuestos?select=zoho_estimate_id,numero_presupuesto&cliente_id=eq.${clienteId}&zoho_estimate_id=not.is.null&order=created_at.desc&limit=15`),
  ])
  const vistas = new Set<string>()
  const facturas = f.filter(t => !vistas.has(t.zoho_invoice_id) && vistas.add(t.zoho_invoice_id)).slice(0, 10)
  return [
    ...facturas.map(t => ({ tipo: 'factura', id: String(t.zoho_invoice_id), numero: t.zoho_invoice_number || String(t.zoho_invoice_id) })),
    ...p.map(x => ({ tipo: 'presupuesto', id: String(x.zoho_estimate_id), numero: x.numero_presupuesto || String(x.zoho_estimate_id) })),
  ]
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
    if (b.accion === 'estado') return json({ envio: waConfigurado(), claude: claudeConfigurado(), plantilla: !!plantillaTexto() }, 200, cors)

    if (b.accion === 'conversaciones') {
      const filas: Fila[] = await appReq('GET', `wa_conversaciones?select=${CONV_COLS}&order=ultimo_mensaje_at.desc.nullslast&limit=40`)
      return json({ conversaciones: filas.map(convVista), envio: waConfigurado(), plantilla: !!plantillaTexto() }, 200, cors)
    }

    if (b.accion === 'mensajes') {
      const c = await conversacion(String(b.conversacion_id ?? ''))
      const msgs: Fila[] = await appReq('GET', `wa_mensajes?select=${MSG_COLS}&conversacion_id=eq.${c.id}&order=created_at.desc&limit=80`)
      // El contrato de la sede (chip del plan de la app), del espejo del hub.
      const [sede] = c.local_id ? await hubDb({ origen: 'whatsapp' }).get(`locales?select=plan,estado_pago&id=eq.${c.local_id}`) : []
      return json({ conversacion: { ...convVista(c), plan: sede?.plan ?? null, estado_pago: sede?.estado_pago ?? null }, mensajes: msgs.reverse() }, 200, cors)
    }

    if (b.accion === 'media') {
      if (!waConfigurado()) return json({ error: 'Falta poner las claves de WhatsApp en el hub (ver docs/PENDIENTE_FRAN.md).' }, 503, cors)
      const c = await conversacion(String(b.conversacion_id ?? ''))
      const mid = String(b.mensaje_id ?? '')
      if (!UUID.test(mid)) return json({ error: 'Mensaje no válido' }, 400, cors)
      const [m] = await appReq('GET', `wa_mensajes?select=media_id,media_mime&id=eq.${mid}&conversacion_id=eq.${c.id}`)
      if (!m?.media_id || !/^\d+$/.test(String(m.media_id))) return json({ error: 'Ese mensaje no lleva ningún fichero.' }, 404, cors)
      const f = await descargarMedia(String(m.media_id))
      if (!f.bytes) return json({ error: f.error }, 502, cors)
      if (f.bytes.length > MAX_MEDIA) return json({ error: 'El fichero es demasiado grande para verlo aquí.' }, 413, cors)
      let bin = ''
      for (let i = 0; i < f.bytes.length; i += 0x8000) bin += String.fromCharCode(...f.bytes.subarray(i, i + 0x8000))
      const mime = f.mime || m.media_mime || 'application/octet-stream'
      return json({ data_url: `data:${mime};base64,${btoa(bin)}`, mime }, 200, cors)
    }

    if (b.accion === 'documentos') {
      const c = await conversacion(String(b.conversacion_id ?? ''))
      if (!c.cliente_id) return json({ documentos: [], motivo: 'El teléfono no está en ninguna ficha: vincula antes el cliente (en la app).' }, 200, cors)
      return json({ documentos: await documentosDe(c.cliente_id), plantilla: !!plantillaDocumento() }, 200, cors)
    }

    if (b.accion === 'enviar_documento') {
      if (!waConfigurado()) return json({ error: 'Falta poner las claves de WhatsApp en el hub (ver docs/PENDIENTE_FRAN.md).' }, 503, cors)
      const c = await conversacion(String(b.conversacion_id ?? ''))
      const tipo = b.tipo === 'presupuesto' ? 'presupuesto' : b.tipo === 'factura' ? 'factura' : ''
      const zohoId = String(b.zoho_id ?? '')
      if (!tipo || !/^\d+$/.test(zohoId)) return json({ error: 'Falta el documento de Zoho.' }, 400, cors)
      // Solo papeles de ESE cliente: nada de mandar la factura de otro a este número.
      const doc = c.cliente_id ? (await documentosDe(c.cliente_id)).find(d => d.tipo === tipo && d.id === zohoId) : undefined
      if (!doc) return json({ error: 'Ese documento no es de este cliente.' }, 403, cors)
      const ventana = dentroDeVentana(c.ultimo_entrante_at)
      const plantilla = plantillaDocumento()
      if (!ventana && !plantilla) {
        return json({ error: 'El cliente no ha escrito en las últimas 24 h, y para escribirle primero Meta exige una plantilla aprobada. Falta poner WHATSAPP_PLANTILLA_DOCUMENTO en el hub (ver docs/PENDIENTE_FRAN.md).' }, 409, cors)
      }
      const ctx = zohoCtx()
      const tokenZoho = await zohoAccessToken(ctx)
      const pdf = await fetch(`https://${ctx.apiDomain}/books/v3/${tipo === 'factura' ? 'invoices' : 'estimates'}/${zohoId}?organization_id=${ctx.ZOHO_ORG_ID}&accept=pdf`,
        { headers: { Authorization: `Zoho-oauthtoken ${tokenZoho}` }, signal: AbortSignal.timeout(30000) })
      if (!pdf.ok || !(pdf.headers.get('content-type') || '').includes('pdf')) {
        console.error('[whatsapp] PDF Zoho', pdf.status, (await pdf.text().catch(() => '')).slice(0, 300))
        return json({ error: `Zoho Books no devolvió el PDF de ${tipo === 'factura' ? 'la factura' : 'el presupuesto'}.` }, 502, cors)
      }
      const bytes = new Uint8Array(await pdf.arrayBuffer())
      const etiqueta = tipo === 'factura' ? 'Factura' : 'Presupuesto'
      const nombreFichero = `${etiqueta}_${String(doc.numero || zohoId).replace(/[^\w.-]+/g, '_')}.pdf`
      const subida = await subirMedia(bytes, 'application/pdf', nombreFichero)
      if (!subida.id) return json({ error: subida.error }, 502, cors)
      const pie = `${etiqueta} ${doc.numero || ''} de Ok Computer Tenerife`.replace(/\s+/g, ' ').trim()
      const r = ventana
        ? await enviarDocumento(c.telefono, subida.id, nombreFichero, pie)
        : await enviarPlantillaDocumento(c.telefono, plantilla, Deno.env.get('WHATSAPP_PLANTILLA_IDIOMA') || 'es',
          subida.id, nombreFichero, [`${etiqueta.toLowerCase()} ${doc.numero || ''}`.trim()])
      const ahora = new Date().toISOString()
      const texto = `📎 ${pie}`
      const [msg] = await appReq('POST', 'wa_mensajes', {
        conversacion_id: c.id, direccion: 'saliente', usuario: yo.nombre, created_at: ahora, texto,
        wa_message_id: r.id ?? null, tipo: ventana ? 'document' : 'template', media_id: subida.id,
        media_mime: 'application/pdf', media_nombre: nombreFichero, estado: r.ok ? 'enviado' : 'fallido', error: r.error ?? null,
      })
      await appReq('PATCH', `wa_conversaciones?id=eq.${c.id}`, { ultimo_mensaje: texto.slice(0, 200), ultimo_mensaje_at: ahora })
      if (r.ok) await comentarTicket(c, texto, ahora, yo, user.email)
      return r.ok ? json({ ok: true, mensaje: msg }, 200, cors) : json({ error: r.error, mensaje: msg }, 502, cors)
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
      if (r.ok) await comentarTicket(c, texto, ahora, yo, user.email)
      return r.ok ? json({ ok: true, mensaje: msg }, 200, cors) : json({ error: r.error, mensaje: msg }, 502, cors)
    }

    if (b.accion === 'plantilla') {
      if (!waConfigurado()) return json({ error: 'Falta poner las claves de WhatsApp en el hub (ver docs/PENDIENTE_FRAN.md).' }, 503, cors)
      if (!plantillaTexto()) return json({ error: 'Falta la plantilla de Meta para retomar conversaciones (WHATSAPP_PLANTILLA_TEXTO, ver docs/PENDIENTE_FRAN.md).' }, 503, cors)
      const c = await conversacion(String(b.conversacion_id ?? ''))
      if (dentroDeVentana(c.ultimo_entrante_at)) return json({ error: 'Dentro de las 24 h se contesta con texto normal.' }, 409, cors)
      const v = convVista(c)
      const nombre = String(c.contactos?.nombre || c.nombre || v.nombre).split(/\s+/)[0]
      const r = await enviarPlantillaTexto(c.telefono, nombre)
      const ahora = new Date().toISOString()
      const texto = `📨 Plantilla «${plantillaTexto()}» para retomar la conversación`
      const [msg] = await appReq('POST', 'wa_mensajes', {
        conversacion_id: c.id, direccion: 'saliente', usuario: yo.nombre, created_at: ahora, texto,
        wa_message_id: r.id ?? null, tipo: 'template', estado: r.ok ? 'enviado' : 'fallido', error: r.error ?? null,
      })
      await appReq('PATCH', `wa_conversaciones?id=eq.${c.id}`, { ultimo_mensaje: texto.slice(0, 200), ultimo_mensaje_at: ahora, sin_leer: 0 })
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

    return json({ error: 'Acción desconocida (estado, conversaciones, mensajes, leida, enviar, plantilla, proponer, media, documentos, enviar_documento)' }, 400, cors)
  } catch (e) {
    const status = (e as { status?: number }).status ?? 502
    console.error('[whatsapp]', e)
    return json({ error: (e as Error).message }, status, cors)
  }
})
