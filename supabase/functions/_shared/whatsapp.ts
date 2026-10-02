// WhatsApp Business Cloud API (Meta) — portado de okcomputerclaude
// (supabase/functions/_shared/whatsapp.ts). Solo lo que hace falta para
// CONTESTAR desde el hub; lo que entra lo sigue recibiendo el webhook de la app.
//
// Secrets del hub (panel de Supabase del hub → Edge Functions → Secrets), los
// MISMOS valores que tiene la app:
//  - WHATSAPP_TOKEN            token permanente del usuario del sistema de Meta.
//  - WHATSAPP_PHONE_NUMBER_ID  id del número (no el número).
//  - WHATSAPP_API_VERSION      opcional (v23.0).

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
  if (code === 130429 || code === 131056) return 'Demasiados mensajes seguidos: Meta ha puesto un límite, prueba en un rato.'
  return e?.error_user_msg || e?.message || 'WhatsApp rechazó el mensaje.'
}

export async function enviarTexto(para: string, texto: string): Promise<EnvioWa> {
  const res = await fetch(`${GRAPH()}/${Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('WHATSAPP_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', recipient_type: 'individual',
      to: normalizaTelefono(para), type: 'text', text: { body: texto.slice(0, 4096), preview_url: true },
    }),
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
