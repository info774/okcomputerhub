// deno-lint-ignore-file no-explicit-any
// Portado de okcomputerclaude (_shared/whatsapp-adjuntos.ts). En el hub, el cubo
// `whatsapp-adjuntos` y hub.ticket_adjuntos (20261028_whatsapp.sql).
// Fotos, vídeos y documentos que manda un CLIENTE por WhatsApp.
//
// Meta solo guarda el fichero unas semanas y la bandeja lo pedía a Meta cada vez
// (whatsapp-api `media`), así que el ticket se quedaba con «📷 Foto» y sin foto.
// Aquí se copia a Storage (bucket `whatsapp-adjuntos`, 20261003b_whatsapp_adjuntos.sql),
// se apunta la URL en `wa_mensajes.media_url` y, al abrir el ticket o si ya
// hay uno abierto, se cuelga de `ticket_adjuntos` (la misma lista «Adjuntos» de
// la ficha, que abre `drive_url` en una pestaña: vale una URL de Storage).
// Las fotos además las describe la IA de visión (Groq, `groqVision`), y esa
// descripción entra en el texto del mensaje: así el ticket dice qué se ve aunque
// el cliente no haya escrito nada.

// supabase-js sobre el esquema `hub` (dbHub de sb-hub.ts); `any` como en el resto del código portado.
type SupabaseClient = any
import { descargarMedia } from "./whatsapp.ts"
import { groqVision } from "./groq.ts"

const BUCKET = 'whatsapp-adjuntos'
const TIPOS_GUARDADOS = new Set(['image', 'video', 'document'])
// Groq no acepta imágenes en base64 mucho mayores; una foto de WhatsApp ronda
// 100-500 KB, así que solo se salta la descripción en casos raros.
const MAX_IMG_VISION = 3_000_000

export interface MediaGuardada { url: string; descripcion: string }

function extension(mime: string, nombre?: string | null): string {
  const deNombre = nombre?.match(/\.([a-z0-9]{2,5})$/i)?.[1]
  if (deNombre) return deNombre.toLowerCase()
  const mapa: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/3gpp': '3gp',
    'application/pdf': 'pdf',
  }
  return mapa[mime.split(';')[0]] ?? 'bin'
}

function base64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

async function describirFoto(bytes: Uint8Array, mime: string, pie: string): Promise<string> {
  const apiKey = Deno.env.get('GROQ_API_KEY') ?? ''
  if (!apiKey || bytes.length > MAX_IMG_VISION) return ''
  const r = await groqVision(apiKey, {
    messages: [
      {
        role: 'system',
        content: 'Eres técnico de una empresa de informática y TPV. Un cliente manda una foto de un problema. ' +
          'Describe en español, en UNA o DOS frases cortas y sin saludos, qué equipo se ve y qué fallo o mensaje ' +
          'de error se aprecia (copia el texto de los errores si se lee). Si no se ve nada técnico, dilo en una frase.',
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: pie ? `Texto que acompaña la foto: «${pie}»` : 'Foto sin texto.' },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${base64(bytes)}` } },
        ],
      },
    ],
    temperature: 0.2,
    max_tokens: 200,
  }, 'whatsapp-adjuntos/vision')
  if (!r.ok) { console.warn('[whatsapp-adjuntos] visión', r.status, r.detalle ?? ''); return '' }
  return (r.contenido ?? '').replace(/\s+/g, ' ').trim().slice(0, 400)
}

/** Copia a Storage el fichero de un mensaje del cliente y, si es foto, lo describe. */
export async function guardarMediaCliente(
  db: SupabaseClient, convId: string, mensajeId: string,
  m: { tipo: string; mediaId?: string | null; mime?: string | null; nombre?: string | null; pie?: string },
): Promise<MediaGuardada | null> {
  if (!m.mediaId || !TIPOS_GUARDADOS.has(m.tipo)) return null
  const f = await descargarMedia(m.mediaId)
  if (!f.bytes) { console.warn('[whatsapp-adjuntos] descarga', f.error); return null }
  const mime = (f.mime || m.mime || 'application/octet-stream').split(';')[0]
  const fecha = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const ruta = `${convId}/${fecha}_${crypto.randomUUID()}.${extension(mime, m.nombre)}`
  const { error } = await db.storage.from(BUCKET).upload(ruta, f.bytes, { contentType: mime })
  if (error) { console.error('[whatsapp-adjuntos] storage', error.message); return null }
  const url = db.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl
  const descripcion = m.tipo === 'image' ? await describirFoto(f.bytes, mime, m.pie ?? '') : ''
  await db.from('wa_mensajes').update({ media_url: url, media_descripcion: descripcion || null }).eq('id', mensajeId)
  return { url, descripcion }
}

/** Cuelga del ticket los ficheros guardados de esos mensajes (sin repetir). */
export async function adjuntarAlTicket(db: SupabaseClient, ticketId: string, mensajeIds: string[], autor: string) {
  if (!mensajeIds.length) return
  const { data: msgs } = await db.from('wa_mensajes')
    .select('id, tipo, media_url, media_mime, media_nombre, media_descripcion, created_at')
    .in('id', mensajeIds).not('media_url', 'is', null)
  if (!msgs?.length) return
  const { data: ya } = await db.from('ticket_adjuntos').select('drive_url').eq('ticket_id', ticketId)
  const vistas = new Set((ya ?? []).map((a: any) => a.drive_url))
  const filas = msgs.filter((x: any) => !vistas.has(x.media_url)).map((x: any) => ({
    ticket_id: ticketId,
    nombre: x.media_nombre || `${x.tipo === 'image' ? 'Foto' : x.tipo === 'video' ? 'Vídeo' : 'Documento'} WhatsApp ` +
      new Date(x.created_at).toLocaleString('es-ES', { timeZone: 'Atlantic/Canary', dateStyle: 'short', timeStyle: 'short' }),
    drive_url: x.media_url,
    mime_type: x.media_mime,
    usuario: autor,
  }))
  if (!filas.length) return
  const { error } = await db.from('ticket_adjuntos').insert(filas)
  if (error) console.error('[whatsapp-adjuntos] ticket_adjuntos', error.message)
}
