// Avisos push en el dispositivo (paridad bloque 6, portado de _shared/push.ts
// de la app). Solo Web Push (navegador y PWA instalada): la APK nativa (FCM) se
// deja para el corte final. Claves VAPID PROPIAS del hub (secrets
// VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_CONTACT_EMAIL; la pública va
// también en src/core/config.ts). Las suscripciones viven en
// hub.push_suscripciones y se borran solas cuando el servicio dice que ya no
// existen (404/410). Un aviso push NUNCA sustituye a Telegram: va además.
import webpush from 'npm:web-push@3.6.7'
import { hubDb } from './hub-db.ts'

export interface AvisoPush {
  title: string
  body: string
  tag?: string
  url?: string                 // ruta del hub a abrir (#/…); por defecto, la portada
  chat?: string                // id del canal: el service worker no lo enseña si el hub está a la vista
}

export const pushConfigurado = () => !!(Deno.env.get('VAPID_PUBLIC_KEY') && Deno.env.get('VAPID_PRIVATE_KEY'))

let _listo = false
function preparar() {
  if (_listo) return
  webpush.setVapidDetails(`mailto:${Deno.env.get('VAPID_CONTACT_EMAIL') ?? 'info@okcomputertenerife.com'}`,
    Deno.env.get('VAPID_PUBLIC_KEY') ?? '', Deno.env.get('VAPID_PRIVATE_KEY') ?? '')
  _listo = true
}

export interface Envio { enviados: number; errores: number; borradas: number; detalle?: string }

/** Manda el aviso a todos los dispositivos de esas personas (ids de hub.usuarios). No lanza nunca. */
export async function avisarPush(usuarioIds: (string | null | undefined)[], aviso: AvisoPush): Promise<Envio> {
  const r: Envio = { enviados: 0, errores: 0, borradas: 0 }
  const ids = [...new Set(usuarioIds.filter((x): x is string => !!x && /^[0-9a-f-]{36}$/i.test(x)))]
  if (!ids.length || !pushConfigurado()) return r
  try {
    preparar()
    const db = hubDb({ origen: 'push' })
    const subs = await db.get(`push_suscripciones?select=id,endpoint,p256dh,auth&usuario_id=in.(${ids.join(',')})`)
    const cuerpo = JSON.stringify({ title: aviso.title.slice(0, 100), body: aviso.body.slice(0, 240), tag: aviso.tag ?? `hub-${Date.now()}`,
      data: { url: aviso.url ?? '/', ...(aviso.chat ? { chat: aviso.chat } : {}) } })
    await Promise.all(subs.map(async s => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint as string, keys: { p256dh: s.p256dh as string, auth: s.auth as string } }, cuerpo, { TTL: 3600 })
        r.enviados++
        await db.patch(`push_suscripciones?id=eq.${s.id}`, { ultimo_ok: new Date().toISOString(), ultimo_error: null }).catch(() => {})
      } catch (e: any) {
        if (e?.statusCode === 404 || e?.statusCode === 410) { r.borradas++; await db.del(`push_suscripciones?id=eq.${s.id}`).catch(() => {}); return }
        r.errores++
        r.detalle = String(e?.body || e?.message || e).slice(0, 300)
        await db.patch(`push_suscripciones?id=eq.${s.id}`, { ultimo_error: r.detalle }).catch(() => {})
      }
    }))
  } catch (e) {
    r.detalle = (e as Error).message
    console.warn('[push]', r.detalle)
  }
  return r
}
