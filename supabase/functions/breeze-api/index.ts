// breeze-api — lo que la pantalla Monitorización le pide a Breeze: acusar una
// alerta, mandar un comando a un equipo (refrescar inventario, reiniciar,
// apagar, encender) o lanzar un script. Nunca por UPDATE en public: por la API
// REST de Breeze con el usuario de servicio del hub (_shared/breeze.ts).
//
// Con JWT de sesión (NO va en SIN_JWT): la llama el front del hub. Cualquier
// usuario activo del hub puede usarla; queda en hub.rmm_acciones y en
// hub.auditoria a su nombre.
//
// Cuerpo: { accion: 'estado' } → ¿está configurada?
//         { accion: 'acusar_alerta', alerta_id }
//         { accion: 'comando', device_id, tipo }        (tipos en COMANDOS)
//         { accion: 'script', script_id, device_ids, parametros? }
import { makeCorsHeaders, json, getAuthedUser, unauthorized, forbidden } from '../_shared/http.ts'
import { hubDb } from '../_shared/hub-db.ts'
import { breezeConfigurado, breezeUrl, ErrorBreeze } from '../_shared/breeze.ts'
import { ejecutarAccionRmm, COMANDOS, type AccionRmm } from '../_shared/rmm-acciones.ts'

Deno.serve(async req => {
  const cors = makeCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405, cors)

  const user = await getAuthedUser(req)
  if (!user?.email) return unauthorized(cors)
  const sistema = hubDb({ origen: 'breeze-api' })
  const [persona] = await sistema.get(`usuarios?select=id,nombre&activo=eq.true&email=ilike.${encodeURIComponent(user.email.replace(/[\\%_]/g, '\\$&'))}`)
  if (!persona) return forbidden(cors, 'No estás dado de alta en el hub.')

  const cuerpo = await req.json().catch(() => null)
  if (!cuerpo?.accion) return json({ error: 'Falta la acción' }, 400, cors)

  if (cuerpo.accion === 'estado') {
    return json({ configurado: breezeConfigurado(), url: breezeUrl(), comandos: COMANDOS }, 200, cors)
  }
  if (!breezeConfigurado()) {
    return json({ error: 'Falta el usuario de servicio de Breeze (BREEZE_HUB_EMAIL / BREEZE_HUB_PASSWORD). Ver docs/FASE2.md.' }, 503, cors)
  }

  const db = hubDb({ origen: 'breeze-api', email: user.email })
  try {
    const r = await ejecutarAccionRmm(db, { usuarioId: persona.id as string, email: user.email }, cuerpo as AccionRmm)
    return json(r, 200, cors)
  } catch (e) {
    const status = e instanceof ErrorBreeze ? (e.status >= 500 ? 502 : e.status === 403 ? 403 : 409) : 400
    console.error('[breeze-api]', (e as Error).message)
    return json({ error: (e as Error).message }, status, cors)
  }
})
