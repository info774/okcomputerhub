// parse-whatsapp — convierte un mensaje de WhatsApp en un ticket/trabajo.
//
// El frontend envía POST { texto } con lo que el cliente ha escrito por WhatsApp
// (uno o varios mensajes copiados/compartidos), o POST { imagen } con una
// CAPTURA DE PANTALLA de la conversación en data URL — desde el móvil hacer la
// captura es más rápido que seleccionar y copiar el texto, y el nombre del
// contacto solo sale en la cabecera de la pantalla, no en el texto copiado.
// Devuelve un JSON estructurado listo para rellenar el formulario de nuevo
// ticket o trabajo:
//   { tipo, titulo, descripcion, prioridad, remitente, telefono, cliente,
//     fecha, hora, texto }
// La clave GROQ_API_KEY vive como secret de Supabase (en el hub, la misma que
// usa `comandas` para las notas de voz). Solo personas del hub con sesión.
//
// Portada LITERAL de okcomputerclaude (supabase/functions/parse-whatsapp): el
// prompt vive en _shared/whatsapp-clasificar.ts, compartido con el webhook. Si
// cambia allí, cambiarlo aquí. La pantalla es #/tickets/whatsapp.
//
// Si Groq falla, el frontend tiene un análisis de reserva local: esta función
// nunca debe ser un cuello de botella para crear el ticket.

import { makeCorsHeaders, getAuthedUser, unauthorized, forbidden } from "../_shared/http.ts"
import { hubDb } from "../_shared/hub-db.ts"
import { personaPorEmail } from "../_shared/personas.ts"
import { groqChat, groqVision } from "../_shared/groq.ts"
import { SYSTEM_PROMPT } from "../_shared/whatsapp-clasificar.ts"

// El modelo lo elige _shared/groq.ts entre los disponibles en Groq (los retiran
// cada pocos meses); el secret GROQ_MODEL fija uno concreto si hace falta.
const MAX_CHARS  = 6000
// Una captura de móvil ronda 200-600 KB; el frontend la reescala antes de
// mandarla. El tope evita que un pantallazo enorme reviente la petición.
const MAX_IMG_B64 = 4_000_000

// Lo que cambia cuando en vez de texto llega una captura de pantalla: hay que
// LEER la imagen antes de resumirla. El nombre del contacto está arriba del
// todo (la cabecera del chat), que es justo el dato que no aparece al copiar
// los mensajes.
const SYSTEM_PROMPT_IMAGEN = `${SYSTEM_PROMPT}

ADEMÁS: lo que recibes es una CAPTURA DE PANTALLA de un chat de WhatsApp. Antes
de resumir, léela entera:
- El nombre o el número que aparece en la BARRA SUPERIOR de la captura es el
  contacto: ponlo en "remitente" (y en "telefono" si lo que se ve es un número).
- Los mensajes del cliente son los de la izquierda (fondo blanco/gris); los de
  la derecha (fondo verde) los escribimos nosotros. El aviso está en los del
  cliente; los nuestros solo sirven de contexto.
- Si en algún mensaje se nombra el negocio, el local o la dirección, ponlo en
  "cliente".
- Añade una clave más, "texto": la transcripción literal de los mensajes que se
  leen en la captura, uno por línea y en orden, sin la hora ni los tics de
  entrega. Si algo no se lee con seguridad, déjalo fuera en vez de adivinarlo.
- No inventes nada que no se vea en la imagen.`

Deno.serve(async (req) => {
  const corsHeaders = makeCorsHeaders(req)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  if (req.method !== 'POST') {
    return json({ error: 'Método no permitido.' }, 405)
  }

  try {
    const user = await getAuthedUser(req)
    if (!user?.email) return unauthorized(corsHeaders)
    if (!(await personaPorEmail(hubDb({ origen: 'parse-whatsapp' }), user.email))) return forbidden(corsHeaders, 'No estás dado de alta en el hub.')

    const apiKey = Deno.env.get('GROQ_API_KEY')
    if (!apiKey) {
      console.error('[parse-whatsapp] Falta el secret GROQ_API_KEY')
      return json({ error: 'El análisis automático no está configurado todavía (falta GROQ_API_KEY en el hub, ver docs/PENDIENTE_FRAN.md).' }, 503)
    }

    const body   = await req.json().catch(() => null)
    const texto  = ((body as Record<string, unknown>)?.texto ?? '').toString().trim().slice(0, MAX_CHARS)
    const imagen = ((body as Record<string, unknown>)?.imagen ?? '').toString().trim()

    if (imagen && !/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(imagen)) {
      return json({ error: 'La captura no tiene un formato de imagen válido.' }, 400)
    }
    if (imagen.length > MAX_IMG_B64) {
      return json({ error: 'La captura es demasiado grande.' }, 413)
    }
    if (!texto && !imagen) return json({ error: 'No hay texto ni captura que analizar.' }, 400)

    // Fecha de hoy en Canarias, para resolver "mañana", "el viernes", etc.
    const ahora     = new Date()
    const ymd       = new Intl.DateTimeFormat('en-CA', { timeZone: 'Atlantic/Canary' }).format(ahora)
    const diaSemana = new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', weekday: 'long' }).format(ahora)

    const hoy = `\n\nFECHA DE HOY: ${diaSemana} ${ymd} (hora de Canarias).`

    // Con captura manda el modelo que ve imágenes (otro juego de modelos, ver
    // _shared/groq.ts); el texto escrito a mano, si lo hay, viaja al lado como
    // contexto en vez de sustituirla.
    const groqRes = imagen
      ? await groqVision(apiKey, {
          messages: [
            { role: 'system', content: SYSTEM_PROMPT_IMAGEN + hoy },
            { role: 'user', content: [
              { type: 'text', text: texto
                ? `Captura de un chat de WhatsApp. Notas de quien la manda:\n"""\n${texto}\n"""`
                : 'Captura de un chat de WhatsApp.' },
              { type: 'image_url', image_url: { url: imagen } },
            ] },
          ],
          temperature: 0.2,
          max_tokens: 900,
          response_format: { type: 'json_object' },
        }, 'parse-whatsapp/imagen')
      : await groqChat(apiKey, {
          messages: [
            { role: 'system', content: SYSTEM_PROMPT + hoy },
            { role: 'user',   content: `Mensaje de WhatsApp:\n"""\n${texto}\n"""` },
          ],
          temperature: 0.2,
          max_tokens: 700,
          response_format: { type: 'json_object' },
        }, 'parse-whatsapp')

    if (!groqRes.ok) {
      console.error('[parse-whatsapp] Groq error', groqRes.status, groqRes.detalle ?? '')
      return json({ error: groqRes.error }, groqRes.status)
    }

    const raw = (groqRes.contenido ?? '').trim()
    let parsed: Record<string, unknown> | null = null
    try { parsed = JSON.parse(raw) } catch { parsed = null }
    if (!parsed || typeof parsed !== 'object') {
      console.error('[parse-whatsapp] Respuesta no-JSON de Groq:', raw.slice(0, 300))
      return json({ error: 'La IA no devolvió un análisis válido.' }, 502)
    }

    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
    const tipo      = str(parsed.tipo).toLowerCase() === 'trabajo' ? 'trabajo' : 'ticket'
    const prioridad = ['Alta', 'Media', 'Baja'].find(p => p.toLowerCase() === str(parsed.prioridad).toLowerCase()) ?? 'Media'
    const fecha     = /^\d{4}-\d{2}-\d{2}$/.test(str(parsed.fecha)) ? str(parsed.fecha) : ''
    const hora      = /^\d{2}:\d{2}$/.test(str(parsed.hora)) ? str(parsed.hora) : ''

    return json({
      tipo,
      titulo:      str(parsed.titulo).slice(0, 120) || 'Aviso por WhatsApp',
      descripcion: str(parsed.descripcion),
      prioridad,
      remitente:   str(parsed.remitente).slice(0, 80),
      telefono:    str(parsed.telefono).slice(0, 30),
      cliente:     str(parsed.cliente).slice(0, 120),
      fecha,
      hora,
      // Solo con captura: lo que la IA leyó en la imagen, para poder revisarlo
      // y para que se guarde como mensaje original del ticket.
      texto:       imagen ? str(parsed.texto).slice(0, MAX_CHARS) : '',
    })
  } catch (e) {
    console.error('[parse-whatsapp]', e)
    return json({ error: 'Error inesperado al analizar el mensaje.' }, 500)
  }
})
