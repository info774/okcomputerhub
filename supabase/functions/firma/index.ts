// firma — firmar un documento del hub (fase 10; portada de la firma de
// contratos de la app, para cualquier documento). SIN_JWT para el firmante:
// lo autoriza el token del enlace (firmar.html?t=…).
//   { accion: 'ver', token } → título, texto, huella y estado
//   { accion: 'firmar', token, hash, nombre, dni, firma (PNG en data URL) }
// Con sesión del equipo: { accion: 'enviar', id } → manda el enlace por correo.
import { makeCorsHeaders, json, getAuthedUser, unauthorized, forbidden } from '../_shared/http.ts'
import { hubDb } from '../_shared/hub-db.ts'
import { personaPorEmail } from '../_shared/personas.ts'
import { enviarCorreo } from '../_shared/gmail.ts'

const URL_FIRMA = () => `${(Deno.env.get('HUB_URL') ?? 'https://okhub-tenerife.web.app')}/firmar.html`
const esUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)

Deno.serve(async req => {
  const cors = makeCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405, cors)
  const db = hubDb({ origen: 'firma' })
  const b = await req.json().catch(() => ({}))
  try {
    if (b.accion === 'ver' || b.accion === 'firmar') {
      if (!esUuid(b.token)) return json({ error: 'Enlace no válido' }, 400, cors)
      if (b.accion === 'ver') {
        const [f] = (await db.rpc('firma_ver', { p_token: b.token })) as Record<string, unknown>[]
        if (!f) return json({ error: 'Este enlace no vale (puede que el documento se haya cambiado: pide el nuevo)' }, 404, cors)
        return json(f, 200, cors)
      }
      const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || null
      const at = await db.rpc('firma_firmar', { p_token: b.token, p_hash: String(b.hash ?? ''), p_nombre: String(b.nombre ?? '').slice(0, 150),
        p_dni: String(b.dni ?? '').slice(0, 20), p_img: String(b.firma ?? ''), p_ip: ip, p_ua: req.headers.get('user-agent') ?? '' })
      return json({ ok: true, firmado_at: at }, 200, cors)
    }
    if (b.accion === 'enviar') {
      const user = await getAuthedUser(req)
      if (!user?.email) return unauthorized(cors)
      if (!(await personaPorEmail(db, user.email))) return forbidden(cors, 'No estás dado de alta en el hub.')
      if (!esUuid(b.id)) return json({ error: 'id no válido' }, 400, cors)
      const [f] = await db.get(`firmas?select=id,titulo,token,estado,firmante_nombre,firmante_email,caduca_at&id=eq.${b.id}`)
      if (!f || f.estado !== 'pendiente') return json({ error: 'Ese documento no está pendiente de firma' }, 400, cors)
      if (!f.firmante_email) return json({ error: 'Falta el correo del firmante' }, 400, cors)
      const url = `${URL_FIRMA()}?t=${f.token}`
      await enviarCorreo({ para: String(f.firmante_email), asunto: `Documento para firmar: ${f.titulo}`, texto:
        `Hola${f.firmante_nombre ? ' ' + String(f.firmante_nombre).split(' ')[0] : ''},\n\nTe enviamos «${f.titulo}» para que lo leas y lo firmes desde el móvil o el ordenador:\n\n${url}\n\nEl enlace vale hasta el ${new Date(String(f.caduca_at)).toLocaleDateString('es-ES')}.\n\nOk Computer Tenerife` })
      await hubDb({ origen: 'firma', email: user.email }).patch(`firmas?id=eq.${f.id}`, { enviado_at: new Date().toISOString() })
      return json({ ok: true, para: f.firmante_email }, 200, cors)
    }
    return json({ error: 'Acción desconocida (ver, firmar, enviar)' }, 400, cors)
  } catch (e) {
    const msg = (e as Error).message.replace(/^POST rpc\/\w+: /, '')
    console.error('[firma]', msg)
    return json({ error: msg }, 400, cors)
  }
})
