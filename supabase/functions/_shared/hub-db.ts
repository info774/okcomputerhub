// Cliente PostgREST del hub para funciones de servidor (service_role, esquema
// hub). Lo que escribe lleva x-hub-origen y, si se sabe, x-hub-usuario: así la
// auditoría apunta la escritura a la persona en cuyo nombre actúa la función
// (ver 20261003_mcp.sql).

export type Fila = Record<string, unknown>

export interface Db {
  get(ruta: string): Promise<Fila[]>
  post(tabla: string, cuerpo: unknown): Promise<Fila[]>
  patch(ruta: string, cuerpo: unknown): Promise<Fila[]>
  del(ruta: string): Promise<void>
  rpc(funcion: string, args: unknown): Promise<unknown>
}

export function hubDb(opciones: { origen: string; email?: string }): Db {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const cab = (extra: Record<string, string> = {}) => ({
    apikey: key, Authorization: `Bearer ${key}`,
    'Accept-Profile': 'hub', 'Content-Profile': 'hub', 'Content-Type': 'application/json',
    'x-hub-origen': opciones.origen,
    ...(opciones.email ? { 'x-hub-usuario': opciones.email } : {}),
    ...extra,
  })
  async function pedir(method: string, ruta: string, cuerpo?: unknown, prefer?: string) {
    const res = await fetch(`${url}/rest/v1/${ruta}`, {
      method, headers: cab(prefer ? { Prefer: prefer } : {}),
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(20000),
    })
    const texto = await res.text()
    if (!res.ok) {
      let msg = texto.slice(0, 300)
      try { msg = JSON.parse(texto).message ?? msg } catch { /* texto plano */ }
      throw new Error(`${method} ${ruta.split('?')[0]}: ${msg}`)
    }
    return texto ? JSON.parse(texto) : null
  }
  return {
    get: ruta => pedir('GET', ruta),
    post: (tabla, cuerpo) => pedir('POST', tabla, cuerpo, 'return=representation'),
    patch: (ruta, cuerpo) => pedir('PATCH', ruta, cuerpo, 'return=representation'),
    del: async ruta => { await pedir('DELETE', ruta) },
    rpc: (funcion, args) => pedir('POST', `rpc/${funcion}`, args),
  }
}

// Texto seguro para filtros de PostgREST (ilike/or): sin comodines ni sintaxis.
export const limpio = (s: unknown, max = 80) => String(s ?? '').replace(/[*,()%\\]/g, ' ').trim().slice(0, max)
export const esUuid = (s: unknown) => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s)
export const esFecha = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
