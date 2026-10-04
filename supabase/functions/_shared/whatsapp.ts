// WhatsApp Business Cloud API (Meta) — portado de okcomputerclaude
// (supabase/functions/_shared/whatsapp.ts). Lo que hace falta para CONTESTAR
// desde el hub (texto, plantillas, documentos de Zoho y ver lo que mandó el
// cliente); lo que entra lo sigue recibiendo el webhook de la app.
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
