// sync-app — copia de solo lectura de la app actual (`okcomputer`) al esquema
// `hub`, área a área, mientras el área tenga dueño 'app' (hub.areas).
//
// Modos (cuerpo JSON `{ modo }`):
//   · incremental (cada 15 min, pg_cron): lee `audit_log` de la app desde el
//     último corte, junta los registros tocados por tabla y pide su estado
//     ACTUAL: lo que existe se sube al hub (upsert), lo que ya no existe se
//     borra. Da igual el orden o las repeticiones del log: manda el estado de
//     la app en el momento de leer.
//   · completo (cada noche): copia enteras las tablas sin auditoría en la app
//     y las marcadas `nocturna`, y borra del hub lo que ya no está en la app.
//     Con `{ modo: 'completo', todas: true }` repasa todas (a mano).
//
// Regla: UN SYNC QUE FALLA NO MUEVE EL CORTE (hub.sync_estado.corte_id).
//
// Autorización (va en SIN_JWT): cabecera x-sync-token = hub_sync_token (cron),
// o sesión de un admin del hub («Sincronizar ahora» en la pantalla Datos).
//
// Configuración: cada clave se lee de su variable de entorno y, si no está,
// del Vault del hub (hub.secreto(), solo service_role):
//   APP_SUPABASE_URL     / app_supabase_url
//   APP_SERVICE_ROLE_KEY / app_service_role_key   (de `okcomputer`, solo para LEER)
//   HUB_SYNC_TOKEN       / hub_sync_token         (el mismo que usa el cron)
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY son los del propio hub (los pone
// Supabase).
//
// Carga inicial: `{ modo: 'completo', todas: true }` con el corte sin poner
// copia todas las tablas y deja el corte en el último id de audit_log leído
// ANTES de empezar, así lo que cambie durante la copia entra en la siguiente
// pasada incremental. (La otra vía, desde el dump: scripts/importar-app.mjs.)

import { makeCorsHeaders, json, getAuthedUser, isAdminUser, mismoToken, unauthorized } from '../_shared/http.ts'
import { TABLAS_APP } from '../_shared/tablas-app.ts'

let APP_URL = ''
let APP_KEY = ''
const HUB_URL = Deno.env.get('SUPABASE_URL') ?? ''
const HUB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const PAGINA_LOG = 1000      // filas de audit_log por página
const MAX_PAGINAS_LOG = 10   // tope por pasada: lo que sobre, en la siguiente
const LOTE_IDS = 100         // ids por consulta `id=in.(…)` (longitud de URL)
const LOTE_UPSERT = 500

type Fila = Record<string, unknown>

// ── PostgREST de la app (solo lectura) ─────────────────────────────────────
async function appGet(ruta: string): Promise<Fila[]> {
  const res = await fetch(`${APP_URL}/rest/v1/${ruta}`, {
    headers: { apikey: APP_KEY, Authorization: `Bearer ${APP_KEY}` },
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`app GET ${ruta.split('?')[0]}: ${res.status} ${(await res.text()).slice(0, 300)}`)
  return await res.json()
}

// ── PostgREST del hub (esquema hub, marcado como sync para no auditarlo) ───
async function hub(method: string, ruta: string, body?: unknown, prefer?: string): Promise<Fila[] | null> {
  const headers: Record<string, string> = {
    apikey: HUB_KEY, Authorization: `Bearer ${HUB_KEY}`,
    'Accept-Profile': 'hub', 'Content-Profile': 'hub',
    'Content-Type': 'application/json', 'x-hub-sync': '1',
  }
  if (prefer) headers.Prefer = prefer
  const res = await fetch(`${HUB_URL}/rest/v1/${ruta}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`hub ${method} ${ruta.split('?')[0]}: ${res.status} ${(await res.text()).slice(0, 300)}`)
  if (res.status === 204 || method !== 'GET') return null
  return await res.json()
}

const trozos = <T>(xs: T[], n: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

// Variable de entorno o, si falta, el Vault del hub.
async function config(env: string, vault: string): Promise<string> {
  const v = Deno.env.get(env)
  if (v) return v
  const res = await fetch(`${HUB_URL}/rest/v1/rpc/secreto`, {
    method: 'POST',
    headers: { apikey: HUB_KEY, Authorization: `Bearer ${HUB_KEY}`, 'Content-Profile': 'hub', 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_nombre: vault }),
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`No se pudo leer ${vault} del Vault: ${res.status} ${(await res.text()).slice(0, 200)}`)
  return (await res.json()) ?? ''
}

async function tablasDeLaApp(): Promise<string[]> {
  const areas = await hub('GET', 'areas?select=tablas&dueno=eq.app') ?? []
  const set = new Set(areas.flatMap(a => (a.tablas as string[]) ?? []))
  return Object.keys(TABLAS_APP).filter(t => set.has(t))
}

async function subir(tabla: string, filas: Fila[]): Promise<void> {
  for (const lote of trozos(filas, LOTE_UPSERT)) {
    await hub('POST', `${tabla}?on_conflict=id`, lote, 'resolution=merge-duplicates,return=minimal')
  }
}

async function borrar(tabla: string, ids: string[]): Promise<void> {
  for (const lote of trozos(ids, LOTE_IDS)) {
    await hub('DELETE', `${tabla}?id=in.(${lote.join(',')})`, undefined, 'return=minimal')
  }
}

// Estado actual de unos ids en la app → upsert de los que están, borrado del resto.
async function refrescar(tabla: string, ids: string[]): Promise<number> {
  const sel = TABLAS_APP[tabla].columnas.join(',')
  const vistos = new Set<string>()
  const filas: Fila[] = []
  for (const lote of trozos(ids, LOTE_IDS)) {
    const rs = await appGet(`${tabla}?select=${sel}&id=in.(${lote.join(',')})`)
    for (const r of rs) { vistos.add(String(r.id)); filas.push(r) }
  }
  await subir(tabla, filas)
  const idos = ids.filter(id => !vistos.has(id))
  if (idos.length) await borrar(tabla, idos)
  return filas.length + idos.length
}

async function estado(clave: string): Promise<Fila> {
  const [e] = await hub('GET', `sync_estado?clave=eq.${clave}&limit=1`) ?? []
  return e ?? { clave }
}

async function guardarEstado(clave: string, cambios: Fila): Promise<void> {
  await hub('PATCH', `sync_estado?clave=eq.${clave}`, cambios, 'return=minimal')
}

// ── Incremental por audit_log ──────────────────────────────────────────────
async function incremental(): Promise<Fila> {
  const e = await estado('audit')
  let corte = e.corte_id as number | null
  if (corte == null) {
    if (!e.corte_ts) throw new Error('Sin corte: falta la carga inicial (scripts/importar-app.mjs la deja puesta).')
    const [primero] = await appGet(`audit_log?select=id&ts=gte.${encodeURIComponent(String(e.corte_ts))}&order=id.asc&limit=1`)
    if (primero) corte = Number(primero.id) - 1
    else {
      const [ultimo] = await appGet('audit_log?select=id&order=id.desc&limit=1')
      corte = ultimo ? Number(ultimo.id) : 0
    }
  }

  const tablas = (await tablasDeLaApp()).filter(t => TABLAS_APP[t].auditada)
  if (!tablas.length) {
    await guardarEstado('audit', { corte_id: corte, ultima_ok: new Date().toISOString(), filas: 0, ultimo_error: null })
    return { filas: 0, corte }
  }

  const tocados: Record<string, Set<string>> = {}
  let hasta = corte
  for (let p = 0; p < MAX_PAGINAS_LOG; p++) {
    const log = await appGet(`audit_log?select=id,tabla,registro_id&id=gt.${hasta}` +
      `&tabla=in.(${tablas.join(',')})&order=id.asc&limit=${PAGINA_LOG}`)
    for (const l of log) {
      (tocados[String(l.tabla)] ??= new Set()).add(String(l.registro_id))
      hasta = Number(l.id)
    }
    if (log.length < PAGINA_LOG) break
  }

  const detalle: Record<string, number> = {}
  let filas = 0
  for (const [tabla, ids] of Object.entries(tocados)) {
    detalle[tabla] = await refrescar(tabla, [...ids])
    filas += detalle[tabla]
  }
  // Solo aquí, con todo escrito, avanza el corte.
  await guardarEstado('audit', {
    corte_id: hasta, ultima_ok: new Date().toISOString(), filas, detalle, ultimo_error: null,
  })
  return { filas, corte: hasta, detalle }
}

// ── Completo (nocturno) ────────────────────────────────────────────────────
async function ultimoIdLog(): Promise<number> {
  const [ultimo] = await appGet('audit_log?select=id&order=id.desc&limit=1')
  return ultimo ? Number(ultimo.id) : 0
}

async function completo(todas: boolean): Promise<Fila> {
  // ¿Carga inicial? Sin corte, se apunta el log ANTES de copiar.
  const e = await estado('audit')
  const cortePendiente = todas && e.corte_id == null && e.corte_ts == null ? await ultimoIdLog() : null
  const tablas = (await tablasDeLaApp()).filter(t => todas || !TABLAS_APP[t].auditada || TABLAS_APP[t].nocturna)
  const detalle: Record<string, number> = {}
  let filas = 0
  for (const tabla of tablas) {
    const sel = TABLAS_APP[tabla].columnas.join(',')
    const enApp = new Set<string>()
    for (let offset = 0; ; offset += 1000) {
      const rs = await appGet(`${tabla}?select=${sel}&order=id.asc&limit=1000&offset=${offset}`)
      rs.forEach(r => enApp.add(String(r.id)))
      await subir(tabla, rs)
      if (rs.length < 1000) break
    }
    const idos: string[] = []
    for (let offset = 0; ; offset += 1000) {
      const rs = await hub('GET', `${tabla}?select=id&order=id.asc&limit=1000&offset=${offset}`) ?? []
      rs.forEach(r => { if (!enApp.has(String(r.id))) idos.push(String(r.id)) })
      if (rs.length < 1000) break
    }
    if (idos.length) await borrar(tabla, idos)
    detalle[tabla] = enApp.size + idos.length
    filas += detalle[tabla]
  }
  await guardarEstado('completo', { ultima_ok: new Date().toISOString(), filas, detalle, ultimo_error: null })
  if (cortePendiente != null) {
    await guardarEstado('audit', { corte_id: cortePendiente, ultimo_error: null })
    return { filas, detalle, carga_inicial: true, corte: cortePendiente }
  }
  return { filas, detalle }
}

Deno.serve(async req => {
  const cors = makeCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  let token = ''
  try {
    token = await config('HUB_SYNC_TOKEN', 'hub_sync_token')
    APP_URL = (await config('APP_SUPABASE_URL', 'app_supabase_url')).replace(/\/$/, '')
    APP_KEY = await config('APP_SERVICE_ROLE_KEY', 'app_service_role_key')
  } catch (e) {
    console.error('[sync-app] configuración:', e)
    return json({ error: e instanceof Error ? e.message : String(e) }, 503, cors)
  }
  const porCron = mismoToken(req.headers.get('x-sync-token') ?? '', token)
  if (!porCron && !(await isAdminUser(await getAuthedUser(req)))) return unauthorized(cors)
  if (!APP_URL || !APP_KEY) {
    return json({ error: 'Falta app_supabase_url / app_service_role_key (Vault del hub o secrets de la función)' }, 503, cors)
  }

  const body = await req.json().catch(() => ({}))
  const modo = body?.modo === 'completo' ? 'completo' : 'incremental'
  const clave = modo === 'completo' ? 'completo' : 'audit'
  try {
    const r = modo === 'completo' ? await completo(body?.todas === true) : await incremental()
    return json({ ok: true, modo, ...r }, 200, cors)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[sync-app] ${modo}: ${msg}`)
    await guardarEstado(clave, { ultimo_error: msg.slice(0, 1000), ultimo_error_at: new Date().toISOString() })
      .catch(err => console.error('[sync-app] no se pudo apuntar el error:', err))
    return json({ ok: false, modo, error: msg }, 500, cors)
  }
})
