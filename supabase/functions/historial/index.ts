// historial — quién cambió qué y cuándo (paridad bloque 6: «Historial de
// cambios» de las fichas y «Registro de cambios» de la app). Solo admin, como
// la app. Junta las DOS auditorías: la del hub (hub.auditoria, lo que se
// escribe aquí) y la de la app (su audit_log, lo que se escribe allí y llega
// por el sync, que no se audita dos veces). La de la app se LEE con su service
// key y por el índice (tabla, registro_id, ts): una consulta pequeña por vez.
//   POST { tabla?, registro_id?, usuario_id?, texto?, desde? (AAAA-MM-DD),
//          antes_de? (ts: la página siguiente) }
//   → { filas: [{ …, fuente: 'hub' | 'app' }], mas }
import { makeCorsHeaders, json, getAuthedUser, unauthorized, forbidden, isAdminUser } from '../_shared/http.ts'
import { hubDb, esUuid, limpio } from '../_shared/hub-db.ts'
import { appGet } from '../_shared/app-lectura.ts'

const PAGINA = 100
const COLS = 'id,ts,tabla,registro_id,accion,usuario_id,usuario_email,usuario_nombre,cambios,antes,despues,titulo'
const esTabla = (v: unknown): v is string => typeof v === 'string' && /^[a-z_]{2,40}$/.test(v)
const esTs = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v))

Deno.serve(async req => {
  const cors = makeCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405, cors)
  const user = await getAuthedUser(req)
  if (!user?.email) return unauthorized(cors)
  if (!(await isAdminUser(user))) return forbidden(cors, 'El historial de cambios es solo para administradores.')
  const b = await req.json().catch(() => ({})) as Record<string, unknown>

  // Los mismos filtros para las dos (las columnas son las mismas).
  const f: string[] = [`select=${COLS}`, 'order=ts.desc', `limit=${PAGINA}`]
  if (esTabla(b.tabla)) f.push(`tabla=eq.${b.tabla}`)
  if (typeof b.registro_id === 'string' && /^[\w-]{1,64}$/.test(b.registro_id)) f.push(`registro_id=eq.${b.registro_id}`)
  if (esUuid(b.usuario_id)) f.push(`usuario_id=eq.${b.usuario_id}`)
  const texto = limpio(b.texto, 60)
  if (texto) f.push(`titulo=ilike.*${encodeURIComponent(texto)}*`)
  if (typeof b.desde === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.desde)) f.push(`ts=gte.${b.desde}T00:00:00`)
  if (esTs(b.antes_de)) f.push(`ts=lt.${encodeURIComponent(new Date(b.antes_de).toISOString())}`)
  const q = f.join('&')

  try {
    const [hub, app] = await Promise.all([
      hubDb({ origen: 'historial' }).get(`auditoria?${q}`),
      appGet(`audit_log?${q}`).catch(e => { console.warn('[historial] app', (e as Error).message); return null }),
    ])
    const filas = [...hub.map(r => ({ ...r, fuente: 'hub' })), ...(app ?? []).map(r => ({ ...r, fuente: 'app' }))]
      .sort((x, y) => String(y.ts).localeCompare(String(x.ts)))
    const mas = hub.length === PAGINA || (app?.length ?? 0) === PAGINA || filas.length > PAGINA
    return json({ filas: filas.slice(0, PAGINA), mas, app_ok: app !== null }, 200, cors)
  } catch (e) {
    console.error('[historial]', e)
    return json({ error: (e as Error).message }, 502, cors)
  }
})
