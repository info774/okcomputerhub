// Gmail del buzón de la empresa (info@okcomputertenerife.com) con la cuenta
// de servicio y DELEGACIÓN DE DOMINIO (ver docs/PENDIENTE_FRAN.md): leer lo que
// entra para el Desk y contestar en el mismo hilo. Permiso: gmail.modify.
import { googleFetch } from './google.ts'

export const BUZON = Deno.env.get('DESK_BUZON') ?? 'info@okcomputertenerife.com'
export const NOMBRE_BUZON = 'Ok Computer Tenerife'
const SCOPES = ['https://www.googleapis.com/auth/gmail.modify']
const API = 'https://gmail.googleapis.com/gmail/v1/users/me'

async function gmail(ruta: string, init: RequestInit = {}) {
  const res = await googleFetch(`${API}/${ruta}`, SCOPES, { ...init, sujeto: BUZON,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) } })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Gmail ${res.status}: ${j.error?.message ?? 'error'}`)
  return j
}

export interface Correo {
  id: string; hilo: string; messageId: string | null; enRespuestaA: string | null
  de: string; deNombre: string | null; asunto: string; texto: string; fecha: string
  automatico: string | null // por qué parece un envío automático (boletín, respuesta automática…)
}

const desB64 = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)))
}

// deno-lint-ignore no-explicit-any
function cuerpo(parte: any, tipo: string): string | null {
  if (parte?.mimeType === tipo && parte.body?.data) return desB64(parte.body.data)
  for (const p of parte?.parts ?? []) { const t = cuerpo(p, tipo); if (t) return t }
  return null
}

const deHtml = (h: string) => h.replace(/<(style|script)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n')
  .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')

// Quita lo citado de correos anteriores («El lunes, X escribió:», líneas con «>»).
export function sinCita(t: string): string {
  const lineas = t.replace(/\r/g, '').split('\n')
  const fin = lineas.findIndex(l => /^(El|On) .{5,200}(escribió|wrote):\s*$/.test(l.trim()) || /^-{2,}\s*(Mensaje original|Original Message)/i.test(l.trim())
    || /^De:\s.+/.test(l.trim()) && lineas.some(x => /^Enviado( el)?:/.test(x.trim())))
  return (fin > 0 ? lineas.slice(0, fin) : lineas).filter(l => !l.startsWith('>')).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

// deno-lint-ignore no-explicit-any
function leerMensaje(m: any): Correo {
  const cab = (n: string) => m.payload?.headers?.find((x: { name: string }) => x.name.toLowerCase() === n)?.value ?? null
  const from = cab('from') ?? ''
  const email = (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase()
  const nombre = from.includes('<') ? from.split('<')[0].replace(/"/g, '').trim() || null : null
  const texto = cuerpo(m.payload, 'text/plain') ?? deHtml(cuerpo(m.payload, 'text/html') ?? m.snippet ?? '')
  const automatico = cab('list-unsubscribe') || cab('list-id') ? 'boletín o lista de correo'
    : /auto-(replied|generated)/i.test(cab('auto-submitted') ?? '') ? 'respuesta automática'
      : /^(bulk|list|junk)$/i.test(cab('precedence') ?? '') ? 'envío masivo'
        : /(no-?reply|mailer-daemon|postmaster|notifications?@)/i.test(email) ? 'remitente automático' : null
  return { id: m.id, hilo: m.threadId, messageId: cab('message-id'), enRespuestaA: cab('in-reply-to'),
    de: email, deNombre: nombre, asunto: cab('subject') ?? '(sin asunto)', texto: sinCita(texto).slice(0, 20000),
    fecha: new Date(Number(m.internalDate)).toISOString(), automatico }
}

// Correos del buzón recibidos después de `desde` (bandeja principal).
export async function correosDesde(desde: Date, max = 50): Promise<Correo[]> {
  const q = `in:inbox category:primary after:${Math.floor(desde.getTime() / 1000)}`
  const lista = await gmail(`messages?maxResults=${max}&q=${encodeURIComponent(q)}`)
  const out: Correo[] = []
  for (const { id } of lista.messages ?? []) out.push(leerMensaje(await gmail(`messages/${id}?format=full`)))
  return out.sort((a, b) => a.fecha.localeCompare(b.fecha))
}

const asuntoMime = (s: string) => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(s)))}?=`
const b64url = (s: string) => {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Manda un correo desde el buzón; con `hilo`/`enRespuestaA`, dentro de la conversación.
export async function enviarCorreo(o: { para: string; asunto: string; texto: string; hilo?: string | null; enRespuestaA?: string | null }): Promise<{ id: string; hilo: string }> {
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(o.para)) throw new Error('Correo de destino no válido')
  const cab = [
    `From: ${asuntoMime(NOMBRE_BUZON)} <${BUZON}>`, `To: ${o.para}`, `Subject: ${asuntoMime(o.asunto.replace(/[\r\n]+/g, ' '))}`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: 8bit',
    ...(o.enRespuestaA ? [`In-Reply-To: ${o.enRespuestaA}`, `References: ${o.enRespuestaA}`] : []),
  ]
  const r = await gmail('messages/send', { method: 'POST', body: JSON.stringify({ raw: b64url(`${cab.join('\r\n')}\r\n\r\n${o.texto}`), ...(o.hilo ? { threadId: o.hilo } : {}) }) })
  return { id: r.id, hilo: r.threadId }
}

export async function perfilBuzon(): Promise<{ email: string; mensajes: number }> {
  const p = await gmail('profile')
  return { email: p.emailAddress, mensajes: p.messagesTotal }
}
