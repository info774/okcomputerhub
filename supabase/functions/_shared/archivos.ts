// Almacén de ficheros privado del hub (Supabase Storage, con la service key:
// no hay políticas para el navegador; se descarga con URL firmada de minutos).
// Cubos: «gastos» (fotos y PDF de tickets de gasto, fase 10).
const URL_BASE = () => `${Deno.env.get('SUPABASE_URL')}/storage/v1`
const cab = (extra: Record<string, string> = {}) => {
  const k = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  return { apikey: k, Authorization: `Bearer ${k}`, ...extra }
}
const _hechos = new Set<string>()

export async function asegurarCubo(cubo: string): Promise<void> {
  if (_hechos.has(cubo)) return
  const r = await fetch(`${URL_BASE()}/bucket/${cubo}`, { headers: cab() })
  if (!r.ok) {
    const c = await fetch(`${URL_BASE()}/bucket`, { method: 'POST', headers: cab({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ id: cubo, name: cubo, public: false, file_size_limit: 15 * 1024 * 1024 }) })
    if (!c.ok && c.status !== 409) throw new Error(`No se pudo crear el almacén ${cubo}: ${(await c.text()).slice(0, 200)}`)
  }
  _hechos.add(cubo)
}

export async function subir(cubo: string, ruta: string, datos: Uint8Array, tipo: string): Promise<void> {
  await asegurarCubo(cubo)
  const r = await fetch(`${URL_BASE()}/object/${cubo}/${ruta}`, { method: 'POST', headers: cab({ 'Content-Type': tipo, 'x-upsert': 'false' }),
    body: new Uint8Array(datos), signal: AbortSignal.timeout(60000) })
  if (!r.ok) throw new Error(`No se pudo guardar el fichero: ${(await r.text()).slice(0, 200)}`)
}

export async function urlFirmada(cubo: string, ruta: string, segundos = 600): Promise<string> {
  const r = await fetch(`${URL_BASE()}/object/sign/${cubo}/${ruta}`, { method: 'POST', headers: cab({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ expiresIn: segundos }) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.signedURL) throw new Error('No se pudo preparar la descarga')
  return `${URL_BASE()}${j.signedURL}`
}
