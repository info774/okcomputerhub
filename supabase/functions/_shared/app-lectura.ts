// Leer la base de la app actual (`okcomputer`) desde una función del hub: SOLO
// LECTURA, con su service key del Vault del hub (app_service_role_key). Para
// consultas pequeñas y puntuales (la app ya va justa de carga): nada de traer
// tablas enteras desde aquí, eso es cosa de sync-app.
const HUB_URL = Deno.env.get('SUPABASE_URL') ?? ''
const HUB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

async function secreto(env: string, vault: string): Promise<string> {
  const v = Deno.env.get(env)
  if (v) return v
  const res = await fetch(`${HUB_URL}/rest/v1/rpc/secreto`, {
    method: 'POST',
    headers: { apikey: HUB_KEY, Authorization: `Bearer ${HUB_KEY}`, 'Content-Profile': 'hub', 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_nombre: vault }), signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`No se pudo leer ${vault} del Vault: ${res.status}`)
  return (await res.json()) ?? ''
}

let _app: { url: string; key: string } | null = null

// deno-lint-ignore no-explicit-any
export async function appGet(ruta: string): Promise<any[]> {
  _app ??= {
    url: (await secreto('APP_SUPABASE_URL', 'app_supabase_url') || 'https://gaksrtxgnuuuvhvgwxue.supabase.co').replace(/\/$/, ''),
    key: await secreto('APP_SERVICE_ROLE_KEY', 'app_service_role_key'),
  }
  const res = await fetch(`${_app.url}/rest/v1/${ruta}`, {
    headers: { apikey: _app.key, Authorization: `Bearer ${_app.key}` }, signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) throw new Error(`app GET ${ruta.split('?')[0]}: ${res.status} ${(await res.text()).slice(0, 200)}`)
  return await res.json()
}
