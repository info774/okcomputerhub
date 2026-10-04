// WhatsApp Business Cloud API (Meta) — portado de okcomputerclaude
// (supabase/functions/_shared/whatsapp.ts). Lo que hace falta para CONTESTAR
// desde el hub (texto, plantillas, documentos de Zoho y ver lo que mandó el
// cliente), y lo que usa el webhook del hub (`whatsapp-webhook`, preparado y
// sin conectar: botones, listas, firma de Meta y texto de cada tipo de mensaje).
//
// Secrets del hub (panel de Supabase del hub → Edge Functions → Secrets), los
// MISMOS valores que tiene la app:
//  - WHATSAPP_TOKEN            token permanente del usuario del sistema de Meta.
//  - WHATSAPP_PHONE_NUMBER_ID  id del número (no el número).
//  - WHATSAPP_API_VERSION      opcional (v23.0).
//  - WHATSAPP_PLANTILLA_TEXTO  opcional: plantilla de Meta (categoría Utilidad)
//    para RETOMAR una conversación pasadas las 24 h, con UNA variable en el
//    cuerpo, {{1}} = nombre del cliente. Sin ella, fuera de las 24 h no se
//    puede escribir desde el hub. WHATSAPP_PLANTILLA_IDIOMA (por defecto es).
//  - WHATSAPP_PLANTILLA_DOCUMENTO  opcional, la MISMA de la app: plantilla con
//    un documento en la cabecera para mandar una factura o presupuesto fuera
//    de las 24 h (una variable en el cuerpo: «factura F26-0001»).

const VERSION = () => Deno.env.get('WHATSAPP_API_VERSION') || 'v23.0'
const GRAPH = () => `https://graph.facebook.com/${VERSION()}`

export function waConfigurado(): boolean {
  return !!(Deno.env.get('WHATSAPP_TOKEN') && Deno.env.get('WHATSAPP_PHONE_NUMBER_ID'))
}

// Solo dígitos y con prefijo de país (igual que la app).
export function normalizaTelefono(tel: string): string {
  let d = String(tel || '').replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.length === 9 && /^[6789]/.test(d)) d = '34' + d
  return d
}

// Meta deja mandar texto libre solo dentro de las 24 h desde el último mensaje
// DEL CLIENTE (con el mismo minuto de margen que la app).
export function dentroDeVentana(ultimoEntranteAt: string | null | undefined): boolean {
  if (!ultimoEntranteAt) return false
  return Date.now() - new Date(ultimoEntranteAt).getTime() < 24 * 60 * 60 * 1000 - 60_000
}

export interface EnvioWa { ok: boolean; id?: string; error?: string; codigo?: number }

// deno-lint-ignore no-explicit-any
function traduceError(e: any): string {
  const code = Number(e?.code)
  if (code === 131047)
    return 'Han pasado más de 24 h desde el último mensaje del cliente: Meta solo deja mandar una plantilla aprobada.'
  if (code === 131026) return 'Ese número no puede recibir el mensaje (no tiene WhatsApp o no ha aceptado las condiciones).'
  if (code === 190) return 'El token de WhatsApp ha caducado o no es válido (secret WHATSAPP_TOKEN del hub).'
  if (code === 131051) return 'Meta no admite ese tipo de mensaje.'
  if (code === 132001) return 'Meta no encuentra esa plantilla (WHATSAPP_PLANTILLA_TEXTO): revisa el nombre y que esté aprobada en ese idioma.'
  if (code === 132000) return 'La plantilla de Meta no tiene una sola variable {{1}} para el nombre del cliente.'
  if (code === 130429 || code === 131056) return 'Demasiados mensajes seguidos: Meta ha puesto un límite, prueba en un rato.'
  return e?.error_user_msg || e?.message || 'WhatsApp rechazó el mensaje.'
}

export const plantillaTexto = () => Deno.env.get('WHATSAPP_PLANTILLA_TEXTO') ?? ''

export function enviarTexto(para: string, texto: string): Promise<EnvioWa> {
  return postMensaje({ to: normalizaTelefono(para), type: 'text', text: { body: texto.slice(0, 4096), preview_url: true } })
}

// La plantilla de retomar la conversación (WHATSAPP_PLANTILLA_TEXTO), con el
// nombre del cliente en {{1}}.
export function enviarPlantillaTexto(para: string, nombre: string): Promise<EnvioWa> {
  return postMensaje({
    to: normalizaTelefono(para), type: 'template',
    template: {
      name: plantillaTexto(), language: { code: Deno.env.get('WHATSAPP_PLANTILLA_IDIOMA') || 'es' },
      components: [{ type: 'body', parameters: [{ type: 'text', text: nombre.slice(0, 60) || 'cliente' }] }],
    },
  })
}

async function postMensaje(cuerpo: Record<string, unknown>): Promise<EnvioWa> {
  const res = await fetch(`${GRAPH()}/${Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('WHATSAPP_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...cuerpo }),
    signal: AbortSignal.timeout(20000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const e = data?.error || {}
    console.error('[whatsapp] envío rechazado', res.status, JSON.stringify(e).slice(0, 400))
    return { ok: false, error: traduceError(e), codigo: e.code }
  }
  return { ok: true, id: data?.messages?.[0]?.id }
}

export const plantillaDocumento = () => Deno.env.get('WHATSAPP_PLANTILLA_DOCUMENTO') ?? ''

export function enviarDocumento(para: string, mediaId: string, nombre: string, pie?: string): Promise<EnvioWa> {
  return postMensaje({
    to: normalizaTelefono(para), type: 'document',
    document: { id: mediaId, filename: nombre, ...(pie ? { caption: pie.slice(0, 1024) } : {}) },
  })
}

// Plantilla con un documento en la cabecera y variables de texto en el cuerpo
// (para mandar una factura a alguien que no ha escrito en las últimas 24 h).
export function enviarPlantillaDocumento(
  para: string, plantilla: string, idioma: string, mediaId: string, nombre: string, variables: string[],
): Promise<EnvioWa> {
  const componentes: unknown[] = [
    { type: 'header', parameters: [{ type: 'document', document: { id: mediaId, filename: nombre } }] },
  ]
  if (variables.length) componentes.push({ type: 'body', parameters: variables.map(v => ({ type: 'text', text: v })) })
  return postMensaje({ to: normalizaTelefono(para), type: 'template', template: { name: plantilla, language: { code: idioma }, components: componentes } })
}

// Sube un fichero a Meta y devuelve su media_id (vale 30 días para enviarlo).
export async function subirMedia(bytes: Uint8Array, mime: string, nombre: string): Promise<{ id?: string; error?: string }> {
  const fd = new FormData()
  fd.append('messaging_product', 'whatsapp')
  fd.append('type', mime)
  fd.append('file', new Blob([bytes as BlobPart], { type: mime }), nombre)
  const res = await fetch(`${GRAPH()}/${Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')}/media`, {
    method: 'POST', headers: { Authorization: `Bearer ${Deno.env.get('WHATSAPP_TOKEN')}` }, body: fd, signal: AbortSignal.timeout(30000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data?.id) {
    console.error('[whatsapp] subida de media rechazada', res.status, JSON.stringify(data).slice(0, 300))
    return { error: traduceError(data?.error) }
  }
  return { id: data.id }
}

// Descarga un fichero que ha mandado el cliente. La URL que da Meta caduca a
// los 5 minutos y exige el token, así que no se guarda: se pide cada vez.
export async function descargarMedia(mediaId: string): Promise<{ bytes?: Uint8Array; mime?: string; error?: string }> {
  const tk = Deno.env.get('WHATSAPP_TOKEN')
  const meta = await fetch(`${GRAPH()}/${mediaId}`, { headers: { Authorization: `Bearer ${tk}` }, signal: AbortSignal.timeout(20000) })
  const info = await meta.json().catch(() => ({}))
  if (!meta.ok || !info?.url) return { error: traduceError(info?.error) }
  const bin = await fetch(info.url, { headers: { Authorization: `Bearer ${tk}` }, signal: AbortSignal.timeout(30000) })
  if (!bin.ok) return { error: `Meta no entregó el fichero (${bin.status}).` }
  return { bytes: new Uint8Array(await bin.arrayBuffer()), mime: info.mime_type || bin.headers.get('content-type') || '' }
}

// ── Para el webhook (portado literal de la app) ──────────────────────────
const token = () => Deno.env.get('WHATSAPP_TOKEN') ?? ''
const phoneId = () => Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') ?? ''

// Mensaje con hasta 3 botones de respuesta (título de botón ≤ 20 caracteres).
export function enviarBotones(para: string, texto: string, botones: { id: string; titulo: string }[]): Promise<EnvioWa> {
  return postMensaje({
    to: normalizaTelefono(para),
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: texto.slice(0, 1024) },
      action: {
        buttons: botones.slice(0, 3).map(b => ({ type: 'reply', reply: { id: b.id.slice(0, 256), title: b.titulo.slice(0, 20) } })),
      },
    },
  })
}

// Mensaje con una lista desplegable (hasta 10 filas; título de fila ≤ 24).
export function enviarLista(
  para: string, texto: string, boton: string, filas: { id: string; titulo: string; descripcion?: string }[],
): Promise<EnvioWa> {
  return postMensaje({
    to: normalizaTelefono(para),
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: texto.slice(0, 1024) },
      action: {
        button: boton.slice(0, 20),
        sections: [{
          title: 'Opciones',
          rows: filas.slice(0, 10).map(f => ({
            id: f.id.slice(0, 200), title: f.titulo.slice(0, 24),
            ...(f.descripcion ? { description: f.descripcion.slice(0, 72) } : {}),
          })),
        }],
      },
    },
  })
}

// Id del botón o fila que ha pulsado el cliente (null si escribió texto).
export function respuestaInteractiva(m: any): string | null {
  if (m?.type === 'interactive') return m.interactive?.button_reply?.id || m.interactive?.list_reply?.id || null
  if (m?.type === 'button') return m.button?.payload || null
  return null
}

export async function marcarLeido(waMessageId: string): Promise<void> {
  await fetch(`${GRAPH()}/${phoneId()}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: waMessageId }),
  }).catch(() => {})
}

// Firma del webhook: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(cuerpo, app secret).
// Sin comprobarla, cualquiera que conozca la URL podría abrir tickets y hacer
// que la app mande autorrespuestas a números arbitrarios.
export async function firmaValida(cuerpo: string, cabecera: string | null): Promise<boolean> {
  // Sin espacios ni saltos: es un secret pegado a mano, y un salto de línea al
  // final hace que NINGUNA firma cuadre sin que se note a simple vista.
  const secreto = (Deno.env.get('WHATSAPP_APP_SECRET') ?? '').trim()
  if (!secreto || !cabecera?.startsWith('sha256=')) return false
  const clave = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const firma = new Uint8Array(await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(cuerpo)))
  const hex = [...firma].map(b => b.toString(16).padStart(2, '0')).join('')
  const recibida = cabecera.slice(7).toLowerCase()
  if (recibida.length !== hex.length) return false
  let dif = 0
  for (let i = 0; i < hex.length; i++) dif |= hex.charCodeAt(i) ^ recibida.charCodeAt(i)
  return dif === 0
}

// Texto legible de un mensaje entrante de cualquier tipo (para la bandeja, el
// ticket y la IA).
export function textoDeMensaje(m: any): string {
  switch (m?.type) {
    case 'text': return m.text?.body || ''
    case 'image': return m.image?.caption || ''
    case 'video': return m.video?.caption || ''
    case 'document': return m.document?.caption || m.document?.filename || ''
    case 'button': return m.button?.text || ''
    case 'interactive':
      return m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || ''
    case 'location': {
      const l = m.location || {}
      return [l.name, l.address, l.latitude && `https://maps.google.com/?q=${l.latitude},${l.longitude}`]
        .filter(Boolean).join(' · ')
    }
    case 'contacts':
      return (m.contacts || []).map((c: any) =>
        `${c.name?.formatted_name || ''} ${(c.phones || []).map((p: any) => p.phone).join(', ')}`.trim()).join('\n')
    default: return ''
  }
}

export function mediaDeMensaje(m: any): { id?: string; mime?: string; nombre?: string } {
  const bloque = m?.[m?.type]
  if (!bloque?.id) return {}
  return { id: bloque.id, mime: bloque.mime_type, nombre: bloque.filename }
}

// Por qué se rechaza una firma, para el log (sin revelar el secret): no es lo
// mismo que falte, que tenga una forma rara o que sea de otra app.
export function motivoFirma(cabecera: string | null): string {
  const bruto = Deno.env.get('WHATSAPP_APP_SECRET') ?? ''
  const secreto = bruto.trim()
  if (!secreto) return 'falta el secret WHATSAPP_APP_SECRET'
  if (!cabecera) return 'la petición no trae X-Hub-Signature-256'
  if (!cabecera.startsWith('sha256=')) return 'X-Hub-Signature-256 sin el prefijo sha256='
  const forma = /^[0-9a-f]{32}$/i.test(secreto)
    ? '32 hex, forma correcta'
    : `${secreto.length} caracteres, no parece una clave secreta de app (32 hex)`
  return `no coincide: ¿WHATSAPP_APP_SECRET es de otra app? (secret: ${forma}${bruto !== secreto ? ', tenía espacios' : ''})`
}

