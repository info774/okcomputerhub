// trabajo-foto — la foto de un trabajo (modo calle: «Terminar» exige foto,
// como en la app). Solo con el área `trabajos` ya cortada al hub: hasta
// entonces las fotos se hacen en la app. Almacén privado «trabajos».
// Con sesión: { accion: 'subir', trabajo_id, archivo (base64), tipo, descripcion }
// y { accion: 'url', id } (enlace de minutos).
import { makeCorsHeaders, json, getAuthedUser, unauthorized, forbidden } from '../_shared/http.ts'
import { hubDb } from '../_shared/hub-db.ts'
import { personaPorEmail } from '../_shared/personas.ts'
import { subir, urlFirmada } from '../_shared/archivos.ts'

const TIPOS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' }
const esUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)

Deno.serve(async req => {
  const cors = makeCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405, cors)
  const user = await getAuthedUser(req)
  if (!user?.email) return unauthorized(cors)
  const yo = await personaPorEmail(hubDb({ origen: 'fotos' }), user.email)
  if (!yo) return forbidden(cors, 'No estás dado de alta en el hub.')
  const db = hubDb({ origen: 'fotos', email: user.email })
  const b = await req.json().catch(() => ({}))
  try {
    if (b.accion === 'subir') {
      if (!(await db.rpc('tabla_es_del_hub', { p_tabla: 'trabajo_fotos' }))) return json({ error: 'Las fotos de los trabajos se siguen haciendo en la app hasta el cambio' }, 409, cors)
      if (!esUuid(b.trabajo_id)) return json({ error: 'Trabajo no válido' }, 400, cors)
      const tipo = String(b.tipo ?? '')
      if (!TIPOS[tipo]) return json({ error: 'Sube una foto (JPG, PNG, WEBP o HEIC)' }, 400, cors)
      const bytes = Uint8Array.from(atob(String(b.archivo ?? '')), c => c.charCodeAt(0))
      if (bytes.byteLength < 100 || bytes.byteLength > 12 * 1024 * 1024) return json({ error: 'La foto está vacía o pasa de 12 MB' }, 400, cors)
      const [t] = await db.get(`trabajos?select=id,numero&id=eq.${b.trabajo_id}`)
      if (!t) return json({ error: 'No existe ese trabajo' }, 404, cors)
      const ruta = `${t.numero}/${crypto.randomUUID()}.${TIPOS[tipo]}`
      await subir('trabajos', ruta, bytes, tipo)
      const [f] = await db.post('trabajo_fotos', { trabajo_id: t.id, tecnico_id: yo.nombre, descripcion: String(b.descripcion ?? '').slice(0, 200) || null, archivo_path: ruta })
      return json({ id: f.id }, 200, cors)
    }
    if (b.accion === 'url') {
      if (!esUuid(b.id)) return json({ error: 'id no válido' }, 400, cors)
      const [f] = await db.get(`trabajo_fotos?select=archivo_path&id=eq.${b.id}`)
      if (!f?.archivo_path) return json({ error: 'Sin fichero' }, 404, cors)
      return json({ url: await urlFirmada('trabajos', String(f.archivo_path)) }, 200, cors)
    }
    return json({ error: 'Acción desconocida (subir, url)' }, 400, cors)
  } catch (e) {
    console.error('[trabajo-foto]', e)
    return json({ error: (e as Error).message }, 502, cors)
  }
})
