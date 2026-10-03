// Cliente de Zoho Books para el hub (organización «Dalmon Sistemas S.L.»,
// región eu). Es un cliente propio del hub, con su «Self Client»: no comparte
// credenciales con la app actual. Casi todo es LECTURA (el espejo de dinero);
// la única escritura es la de la paridad con la app (decisión de Fran,
// 2026-10-03): dar de alta y quitar CONTACTOS al crear o eliminar un cliente
// (`zohoEnviar`, función `clientes`), y solo con el área `clientes` cortada.
// Permisos del Self Client: los de lectura + ZohoBooks.contacts.CREATE y
// ZohoBooks.contacts.DELETE (docs/PENDIENTE_FRAN.md).
//
// Secrets de la función (Supabase del hub → Edge Functions → Secrets):
//   ZOHO_HUB_CLIENT_ID, ZOHO_HUB_CLIENT_SECRET   del Self Client (api-console.zoho.eu)
//   ZOHO_ORG_ID                                  20107733530
// El refresh token NO va en secrets: lo obtiene zoho-lectura al canjear el
// código de un uso que genera Fran, y lo guarda en el Vault
// (zoho_hub_refresh_token, hub.guardar_secreto).
import type { Db } from './hub-db.ts'

const CUENTAS = 'https://accounts.zoho.eu'
const API = 'https://www.zohoapis.eu/books/v3'
export const ORG = () => Deno.env.get('ZOHO_ORG_ID') ?? '20107733530'
const cliente = () => ({ id: Deno.env.get('ZOHO_HUB_CLIENT_ID') ?? '', secreto: Deno.env.get('ZOHO_HUB_CLIENT_SECRET') ?? '' })

export const clienteConfigurado = () => !!(cliente().id && cliente().secreto)

let _refresh = ''
let _token = ''
let _caduca = 0

export async function refreshToken(db: Db): Promise<string> {
  if (_refresh) return _refresh
  _refresh = Deno.env.get('ZOHO_HUB_REFRESH_TOKEN') ?? ((await db.rpc('secreto', { p_nombre: 'zoho_hub_refresh_token' })) as string | null) ?? ''
  return _refresh
}

// Canjea el código de un uso del Self Client por el refresh token y lo guarda.
export async function conectar(db: Db, codigo: string): Promise<void> {
  const c = cliente()
  if (!c.id || !c.secreto) throw new Error('Faltan ZOHO_HUB_CLIENT_ID / ZOHO_HUB_CLIENT_SECRET')
  const q = new URLSearchParams({ grant_type: 'authorization_code', client_id: c.id, client_secret: c.secreto, code: codigo.trim() })
  const res = await fetch(`${CUENTAS}/oauth/v2/token?${q}`, { method: 'POST', signal: AbortSignal.timeout(20000) })
  const j = await res.json().catch(() => ({}))
  if (j.error || !j.refresh_token) {
    throw new Error(j.error === 'invalid_code' ? 'El código no vale o ya caducó (dura unos minutos): genera otro' : `Zoho no dio el token: ${j.error ?? res.status}`)
  }
  await db.rpc('guardar_secreto', { p_nombre: 'zoho_hub_refresh_token', p_valor: j.refresh_token })
  _refresh = j.refresh_token
  _token = j.access_token ?? ''
  _caduca = Date.now() + ((Number(j.expires_in) || 3600) - 120) * 1000
}

async function accessToken(db: Db): Promise<string> {
  if (_token && Date.now() < _caduca) return _token
  const c = cliente()
  const r = await refreshToken(db)
  if (!c.id || !c.secreto || !r) throw new Error('Zoho no está conectado todavía (ver docs/FASE3.md)')
  const q = new URLSearchParams({ grant_type: 'refresh_token', client_id: c.id, client_secret: c.secreto, refresh_token: r })
  const res = await fetch(`${CUENTAS}/oauth/v2/token?${q}`, { method: 'POST', signal: AbortSignal.timeout(20000) })
  const j = await res.json().catch(() => ({}))
  if (j.error || !j.access_token) throw new Error(`Zoho no renovó el acceso: ${j.error ?? res.status}`)
  _token = j.access_token
  _caduca = Date.now() + ((Number(j.expires_in) || 3600) - 120) * 1000
  return _token
}

// deno-lint-ignore no-explicit-any
export async function zohoGet(db: Db, ruta: string, params: Record<string, string> = {}): Promise<any> {
  const q = new URLSearchParams({ organization_id: ORG(), ...params })
  const res = await fetch(`${API}/${ruta}?${q}`, {
    headers: { Authorization: `Zoho-oauthtoken ${await accessToken(db)}` },
    signal: AbortSignal.timeout(30000),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok || (j.code && j.code !== 0)) throw new Error(`Zoho ${ruta} → ${res.status}: ${j.message ?? 'sin detalle'}`)
  return j
}

// Escribir en Zoho (POST/DELETE). Devuelve la respuesta; NO lanza si Zoho
// contesta con un código de error (quien llama decide, p. ej. desactivar en
// vez de borrar).
// deno-lint-ignore no-explicit-any
export async function zohoEnviar(db: Db, metodo: 'POST' | 'DELETE', ruta: string, cuerpo?: unknown): Promise<any> {
  const q = new URLSearchParams({ organization_id: ORG() })
  const res = await fetch(`${API}/${ruta}?${q}`, {
    method: metodo,
    headers: { Authorization: `Zoho-oauthtoken ${await accessToken(db)}`, ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    signal: AbortSignal.timeout(30000),
  })
  return await res.json().catch(() => ({ code: res.status, message: `HTTP ${res.status}` }))
}

// Recorre todas las páginas (200 por página; tope de seguridad 100 páginas).
// deno-lint-ignore no-explicit-any
export async function zohoTodo(db: Db, ruta: string, lista: string, params: Record<string, string> = {}): Promise<any[]> {
  // deno-lint-ignore no-explicit-any
  const filas: any[] = []
  for (let page = 1; page <= 100; page++) {
    const j = await zohoGet(db, ruta, { ...params, per_page: '200', page: String(page) })
    filas.push(...(j[lista] ?? []))
    if (!j.page_context?.has_more_page) break
  }
  return filas
}

// Corte para last_modified_time: Zoho quiere fecha, hora y offset numérico
// (`2026-09-16T00:00:00+0000`); ni fecha suelta ni `Z` (lección de la app).
export function zohoDesde(d: Date): string {
  return d.toISOString().slice(0, 19) + '+0000'
}

// PDF de una factura o un presupuesto (portal de clientes). Lectura:
// permisos ZohoBooks.invoices.READ / ZohoBooks.estimates.READ.
export async function zohoPdf(db: Db, ruta: 'invoices' | 'estimates', id: string): Promise<ArrayBuffer> {
  if (!/^\d{5,25}$/.test(id)) throw new Error('Documento no válido')
  const q = new URLSearchParams({ organization_id: ORG(), accept: 'pdf' })
  const res = await fetch(`${API}/${ruta}/${id}?${q}`, {
    headers: { Authorization: `Zoho-oauthtoken ${await accessToken(db)}` },
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`Zoho no dio el PDF (${res.status})`)
  return await res.arrayBuffer()
}
