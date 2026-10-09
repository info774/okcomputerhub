// control-equipos — ¿lleva cada PC de cliente lo que tiene que llevar?
// Action1, Breeze (nuestro RMM), RustDesk y AnyDesk. Portada de la app
// (supabase/functions/control-equipos) para la paridad del bloque 7, tanda 4,
// PREPARADA Y SIN ENCENDER (decisión de Fran): con el área `equipos` de la app
// contesta `omitido` sin tocar nada (la comprobación la hace la app cada día y
// el hub la copia; hacerla desde los dos abriría tareas repetidas).
//
// Diferencias con la de la app:
//   · Breeze se LEE de sus vistas (hub.rmm_equipos y hub.rmm_software, que ya
//     tienen la sede y los programas) en vez de pedírselo a su API: regla 3 del
//     hub, leer Breeze, no escribirle. El ID de AnyDesk de los campos de Breeze
//     no está en las vistas: sale del software (o de la ficha del equipo).
//   · Action1, igual (API 3.0, OAuth client_credentials).
//   · Los avisos a admins, por Telegram y push (`avisarAdmins` del hub); la
//     tarea [Equipos] por sede con mantenimiento solo si las tareas ya son del
//     hub.
//
// SIN JWT (lista SIN_JWT de deploy-funciones.yml): x-sync-token = hub_sync_token
// (pg_cron, cuando se encienda) o la sesión de un admin («Comprobar ahora»).
// Secrets (solo para Action1): ACTION1_CLIENT_ID, ACTION1_CLIENT_SECRET,
// ACTION1_REGION (eu por defecto) y ACTION1_ORG_IDS (opcional).
import { makeCorsHeaders, json, getAuthedUser, isAdminUser, unauthorized, forbidden, mismoToken } from '../_shared/http.ts'
import { dbHub, tablaDelHub } from '../_shared/sb-hub.ts'
import { avisarAdmins } from '../_shared/whatsapp-app.ts'

// deno-lint-ignore no-explicit-any
type SupabaseClient = any

const PROGRAMAS = ['action1', 'breeze', 'rustdesk', 'anydesk'] as const
type Programa = typeof PROGRAMAS[number]
const PATRON: Record<Programa, RegExp> = {
  action1: /action1/i,
  breeze: /breeze/i,
  rustdesk: /rustdesk/i,
  anydesk: /anydesk/i,
}
const NOMBRE: Record<Programa, string> = { action1: 'Action1', breeze: 'Breeze', rustdesk: 'RustDesk', anydesk: 'AnyDesk' }
const MARCA_TAREA = '[Equipos]'
const OLVIDAR_DIAS = 60
// Un agente de Breeze que no conecta en una semana cuenta como «falta Breeze»:
// estar dado de alta no sirve de nada si no habla.
const BREEZE_MUDO_DIAS = 7

const clave = (h: string) => (h || '').trim().toLowerCase().split('.')[0].replace(/[^a-z0-9-]/g, '')

// Varias peticiones a la vez, pero no todas: Breeze y Action1 limitan.
async function enParalelo<T, R>(lista: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, lista.length) }, async () => {
    while (i < lista.length) { const k = i++; out[k] = await fn(lista[k]) }
  }))
  return out
}

// ── Breeze (por las vistas del hub) ─────────────────────────────────────────
interface Visto { hostname: string; programas: string[] | null; rustdesk_id?: string | null; anydesk_id?: string | null; visto?: string | null }

async function leerBreeze(sb: SupabaseClient): Promise<{ ok: boolean; error?: string; porClave: Map<string, Visto & { equipo: any }> }> {
  const porClave = new Map<string, Visto & { equipo: any }>()
  const { data: equipos, error } = await sb.from('rmm_equipos').select('id,hostname,local_id,rustdesk_id,visto_ultimo').range(0, 4999)
  if (error) return { ok: false, error: error.message, porClave }
  const ids = (equipos ?? []).map((e: any) => e.id)
  const programas = new Map<string, string[]>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data: sw, error: e2 } = await sb.from('rmm_software').select('device_id,nombre').in('device_id', ids.slice(i, i + 200)).range(0, 49999)
    if (e2) return { ok: false, error: e2.message, porClave }
    for (const s of (sw ?? []) as any[]) programas.set(s.device_id, [...(programas.get(s.device_id) ?? []), String(s.nombre ?? '')])
  }
  for (const e of (equipos ?? []) as any[]) {
    const k = clave(e.hostname)
    if (!k) continue
    // Un mismo PC puede tener varias filas en Breeze (agente reinstalado): manda la última vista.
    const ya = porClave.get(k)
    if (ya && (ya.visto ?? '') > (e.visto_ultimo ?? '')) continue
    porClave.set(k, { equipo: { ...e, breeze_id: e.id }, hostname: e.hostname, programas: programas.get(e.id) ?? [], rustdesk_id: e.rustdesk_id ?? null, anydesk_id: null, visto: e.visto_ultimo })
  }
  return { ok: true, porClave }
}

// ── Action1 ─────────────────────────────────────────────────────────────────
const ACTION1_BASE: Record<string, string> = {
  eu: 'https://app.eu.action1.com/api/3.0',
  na: 'https://app.action1.com/api/3.0',
  au: 'https://app.au.action1.com/api/3.0',
}

// El nombre de un programa en las filas de /apps/{org}/data/{id}: la API no
// documenta un único campo, así que se prueban los que usa.
// Fechas de Action1: «2026-10-01_17-25-57» (UTC) en vez de ISO. Lo que no se
// entienda se queda en null antes que tumbar el upsert entero.
function fechaAction1(v: unknown): string | null {
  const t = String(v ?? '').trim()
  const m = t.match(/^(\d{4}-\d{2}-\d{2})[_ T](\d{2})[-:](\d{2})[-:](\d{2})/)
  const iso = m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}Z` : t
  return iso && !isNaN(Date.parse(iso)) ? new Date(iso).toISOString() : null
}

const nombreApp = (a: any) => String(a?.name ?? a?.Name ?? a?.app_name ?? a?.product_name ?? a?.display_name ?? a?.fields?.Name ?? '')

async function leerAction1(): Promise<{ ok: boolean; error?: string; base?: string; porClave: Map<string, Visto & { id: string; org: string }> }> {
  const porClave = new Map<string, Visto & { id: string; org: string }>()
  const id = Deno.env.get('ACTION1_CLIENT_ID') ?? '', secret = Deno.env.get('ACTION1_CLIENT_SECRET') ?? ''
  if (!id || !secret) return { ok: false, error: 'Action1 sin configurar', porClave }
  const base = ACTION1_BASE[(Deno.env.get('ACTION1_REGION') ?? 'eu').toLowerCase()] ?? ACTION1_BASE.eu

  const t = await fetch(`${base}/oauth2/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }).toString(),
    signal: AbortSignal.timeout(20000),
  })
  if (!t.ok) return { ok: false, error: `token de Action1 → ${t.status}`, porClave }
  const token = (await t.json())?.access_token
  if (!token) return { ok: false, error: 'Action1 sin access_token', porClave }
  const get = async (path: string) => {
    const r = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) })
    if (!r.ok) throw new Error(`Action1 GET ${path} → ${r.status}`)
    return r.json()
  }
  // Paginación de Action1: from/limit, filas en `items`.
  const todo = async (path: string) => {
    const filas: any[] = []
    for (let from = 0; from < 20000; from += 100) {
      const j = await get(`${path}${path.includes('?') ? '&' : '?'}from=${from}&limit=100`)
      const items = Array.isArray(j) ? j : (j?.items ?? [])
      filas.push(...items)
      if (items.length < 100) break
    }
    return filas
  }

  let orgs = (Deno.env.get('ACTION1_ORG_IDS') ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (!orgs.length) orgs = (await todo('/organizations')).map((o: any) => o.id).filter(Boolean)

  for (const org of orgs) {
    const endpoints = await todo(`/endpoints/managed/${org}`)
    await enParalelo(endpoints, 4, async (ep: any) => {
      const host = String(ep.name ?? ep.device_name ?? ep.endpoint_name ?? '')
      const k = clave(host)
      if (!k) return
      let programas: string[] | null = null
      try {
        const j = await get(`/apps/${org}/data/${ep.id}?limit=1000`)
        programas = (Array.isArray(j) ? j : j?.items ?? []).map(nombreApp).filter(Boolean)
      } catch (err) { console.warn('[control-equipos] apps Action1', host, String(err)) }
      porClave.set(k, { id: String(ep.id), org, hostname: host, programas, visto: fechaAction1(ep.last_seen) })
    })
  }
  return { ok: true, base, porClave }
}

// `accion: 'probar_action1'`: ¿valen las claves? Pide el token y cuenta
// organizaciones y equipos. No lee programas ni escribe nada, así que vale
// también con el área `equipos` de la app.
async function probarAction1() {
  const id = Deno.env.get('ACTION1_CLIENT_ID') ?? '', secret = Deno.env.get('ACTION1_CLIENT_SECRET') ?? ''
  if (!id || !secret) return { ok: false, error: 'Action1 sin configurar' }
  const region = (Deno.env.get('ACTION1_REGION') ?? 'eu').toLowerCase()
  const base = ACTION1_BASE[region] ?? ACTION1_BASE.eu
  const t = await fetch(`${base}/oauth2/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }).toString(),
    signal: AbortSignal.timeout(20000),
  })
  if (!t.ok) return { ok: false, region, error: `token de Action1 → ${t.status}` }
  const token = (await t.json())?.access_token
  if (!token) return { ok: false, region, error: 'Action1 sin access_token' }
  const get = async (path: string) => {
    const r = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) })
    if (!r.ok) throw new Error(`Action1 GET ${path} → ${r.status}`)
    const j = await r.json()
    return Array.isArray(j) ? j : (j?.items ?? [])
  }
  const orgs = await get('/organizations?limit=100')
  const organizaciones = []
  for (const o of orgs) {
    try {
      const eps = await get(`/endpoints/managed/${o.id}?limit=1000`)
      organizaciones.push({ nombre: String(o.name ?? o.id), equipos: eps.length })
    } catch (e) { organizaciones.push({ nombre: String(o.name ?? o.id), error: String(e) }) }
  }
  return { ok: true, region, organizaciones }
}

// ── La pasada ───────────────────────────────────────────────────────────────
async function pasada(sb: SupabaseClient) {
  const ahora = new Date().toISOString()
  const [bz, a1] = await Promise.all([
    leerBreeze(sb).catch(e => ({ ok: false, error: String(e), porClave: new Map() })),
    leerAction1().catch(e => ({ ok: false, error: String(e), porClave: new Map() })),
  ]) as [Awaited<ReturnType<typeof leerBreeze>>, Awaited<ReturnType<typeof leerAction1>>]

  const { data: previas } = await sb.from('equipos_control').select('*').range(0, 9999)
  const porClave = new Map<string, any>((previas ?? []).map((r: any) => [r.clave, r]))
  const claves = new Set<string>([...porClave.keys(), ...bz.porClave.keys(), ...a1.porClave.keys()])

  const cambios: any[] = []
  const nuevasFaltas: { local_id: string | null; hostname: string; faltan: string[] }[] = []

  for (const k of claves) {
    const prev = porClave.get(k) ?? null
    const b = bz.porClave.get(k), a = a1.porClave.get(k)
    // El id nuevo se pone aquí: el upsert va por lotes con filas viejas y nuevas
    // juntas, y en un lote mixto la columna que falta viaja como null (no como
    // DEFAULT) y choca con el NOT NULL de la clave primaria.
    const fila: any = prev ? { ...prev } : { id: crypto.randomUUID(), clave: k, faltan: [], ignorar: false, local_manual: false }
    delete fila.created_at

    if (b || a) fila.hostname = b?.hostname ?? a?.hostname ?? fila.hostname
    // Cada fuente solo escribe lo suyo, y solo si contestó en esta pasada.
    if (bz.ok) {
      fila.tiene_breeze = !!b && !!b.visto && (Date.now() - new Date(b.visto).getTime()) < BREEZE_MUDO_DIAS * 86400_000
      if (b) {
                fila.breeze_id = b.equipo.breeze_id
        fila.breeze_visto = b.visto ?? fila.breeze_visto ?? null
        if (!fila.local_manual && b.equipo.local_id) fila.local_id = b.equipo.local_id
        if (b.rustdesk_id) fila.rustdesk_id = b.rustdesk_id
        if (b.anydesk_id) {
          fila.anydesk_id = b.anydesk_id
        }
      }
    }
    if (a1.ok) {
      fila.tiene_action1 = !!a
      if (a) { fila.action1_id = a.id; fila.action1_org = a.org; fila.action1_visto = a.visto ?? fila.action1_visto ?? null }
    }
    // RustDesk / AnyDesk / Breeze por la lista de programas de CUALQUIERA de
    // las dos fuentes. Sin ninguna lista, se deja lo que había (no se sabe).
    const listas = [b?.programas, a?.programas].filter((x): x is string[] => Array.isArray(x))
    if (listas.length) {
      const todos = listas.flat()
      const hay = (p: Programa) => todos.some(n => PATRON[p].test(n))
      fila.tiene_rustdesk = hay('rustdesk') || !!fila.rustdesk_id
      fila.tiene_anydesk = hay('anydesk')
      // Breeze NO se da por bueno por verlo instalado: lo que cuenta es que su
      // agente conecte (BREEZE_MUDO_DIAS), y eso solo lo sabe Breeze.
      if (!fila.tiene_action1 && hay('action1')) fila.tiene_action1 = true
    }
    if (b || a) { fila.visto_at = ahora; fila.comprobado_at = ahora }

    const faltan = PROGRAMAS.filter(p => fila[`tiene_${p}`] === false)
    fila.faltan = faltan

    // Equipo que nadie ve desde hace 60 días: retirado.
    const olvidado = !b && !a && fila.visto_at && (Date.now() - new Date(fila.visto_at).getTime()) > OLVIDAR_DIAS * 86400_000
    if (olvidado && prev) { await sb.from('equipos_control').delete().eq('id', prev.id); continue }

    // Una pasada que no cambia nada no escribe nada (salvo comprobado_at, una
    // vez al día, que es lo que dice que el dato es fresco).
    const campos = ['hostname', 'local_id', 'rmm_equipo_id', 'breeze_id', 'action1_id', 'action1_org', 'tiene_breeze',
      'tiene_action1', 'tiene_rustdesk', 'tiene_anydesk', 'rustdesk_id', 'anydesk_id', 'breeze_visto', 'action1_visto', 'faltan', 'comprobado_at']
    const distinto = !prev || campos.some(c => JSON.stringify(prev[c] ?? null) !== JSON.stringify(fila[c] ?? null))
    if (distinto) { fila.updated_at = ahora; cambios.push(fila) }

    const antes = new Set<string>(prev?.faltan ?? [])
    if (!fila.ignorar && faltan.some(f => !antes.has(f))) nuevasFaltas.push({ local_id: fila.local_id ?? null, hostname: fila.hostname ?? k, faltan })
  }

  for (let i = 0; i < cambios.length; i += 200) {
    const { error } = await sb.from('equipos_control').upsert(cambios.slice(i, i + 200), { onConflict: 'clave' })
    if (error) throw new Error(`equipos_control: ${error.message}`)
  }

  const tareas = await abrirTareas(sb, nuevasFaltas)
  if (nuevasFaltas.length) {
    const resumen = nuevasFaltas.slice(0, 5).map(n => `${n.hostname}: falta ${n.faltan.map(f => NOMBRE[f as Programa]).join(', ')}`).join(' · ')
    await avisarAdmins(sb, `${nuevasFaltas.length} PC${nuevasFaltas.length > 1 ? 's' : ''} sin el software obligatorio`, resumen, 'control-equipos')
  }

  return {
    ok: true, equipos: claves.size, escritos: cambios.length, nuevas_faltas: nuevasFaltas.length, tareas,
    breeze: bz.ok ? `ok (${bz.porClave.size})` : bz.error, action1: a1.ok ? `ok (${a1.porClave.size})` : a1.error,
  }
}

// Una tarea por SEDE con mantenimiento, y solo si no hay ya una abierta.
async function abrirTareas(sb: SupabaseClient, faltas: { local_id: string | null; hostname: string; faltan: string[] }[]) {
  const porLocal = new Map<string, typeof faltas>()
  for (const f of faltas) if (f.local_id) porLocal.set(f.local_id, [...(porLocal.get(f.local_id) ?? []), f])
  if (!porLocal.size) return 0
  if (!(await tablaDelHub(sb, 'tareas'))) return 0 // las tareas siguen en la app
  const ids = [...porLocal.keys()]
  const [{ data: locales }, { data: abiertas }] = await Promise.all([
    sb.from('locales').select('id,nombre,cliente_id,plan').in('id', ids),
    sb.from('tareas').select('local_id').in('local_id', ids).like('titulo', `${MARCA_TAREA}%`).neq('estado', 'completada'),
  ])
  const yaAbierta = new Set((abiertas ?? []).map((t: any) => t.local_id))
  let n = 0
  for (const l of (locales ?? []) as any[]) {
    if (!l.plan || l.plan === 'Sin mantenimiento' || yaAbierta.has(l.id)) continue
    const lista = porLocal.get(l.id) ?? []
    const notas = lista.map(f => `• ${f.hostname}: falta ${f.faltan.map(x => NOMBRE[x as Programa]).join(', ')}`).join('\n')
    const { error } = await sb.from('tareas').insert({
      titulo: `${MARCA_TAREA} Instalar software obligatorio en ${l.nombre}`,
      estado: 'pendiente', prioridad: 'media', local_id: l.id, cliente_id: l.cliente_id,
      notas: `${notas}\n\nAbierta sola por el control de equipos (Action1, Breeze, RustDesk, AnyDesk). Al instalarlo, la comprobación diaria lo da por bueno.`,
    })
    if (!error) n++
    else console.warn('[control-equipos] tarea', l.nombre, error.message)
  }
  return n
}

Deno.serve(async req => {
  const cors = makeCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST' }, 405, cors)
  const sb = dbHub('control-equipos')
  const cabecera = req.headers.get('x-sync-token') ?? ''
  if (cabecera) {
    const { data: token } = await sb.rpc('secreto', { p_nombre: 'hub_sync_token' })
    if (!mismoToken(cabecera, Deno.env.get('HUB_SYNC_TOKEN') ?? String(token ?? ''))) return unauthorized(cors)
  } else {
    const user = await getAuthedUser(req)
    if (!user) return unauthorized(cors)
    if (!(await isAdminUser(user))) return forbidden(cors, 'Solo un administrador puede lanzar la comprobación.')
  }
  const cuerpo = await req.json().catch(() => ({}))
  if (cuerpo?.accion === 'probar_action1') {
    try { return json(await probarAction1(), 200, cors) } catch (e) { return json({ ok: false, error: String(e) }, 200, cors) }
  }
  if (!(await tablaDelHub(sb, 'equipos_control'))) {
    return json({ ok: true, omitido: 'El control de equipos lo hace todavía la app (cada mañana): aquí se ve su resultado.' }, 200, cors)
  }
  try {
    const r = await pasada(sb)
    console.log('[control-equipos]', JSON.stringify(r))
    return json(r, 200, cors)
  } catch (e) {
    console.error('[control-equipos]', e)
    return json({ ok: false, error: String(e) }, 500, cors)
  }
})
