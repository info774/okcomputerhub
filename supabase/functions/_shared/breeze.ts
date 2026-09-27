// Cliente de la API REST de Breeze (breeze.oksistemas.online) para lo que el
// hub le PIDE a Breeze: acusar una alerta, mandar un comando a un equipo,
// lanzar un script. Las lecturas no pasan por aquí: salen de las vistas
// hub.rmm_* (regla 3 de CLAUDE.md: leer Breeze, no escribirle).
//
// Usuario de servicio con rol «Partner Technician» y SIN MFA (la función no
// sabría pasarlo): ese rol acusa alertas, manda comandos y lanza scripts, y
// NO resuelve alertas ni abre sesiones remotas; eso se hace en el panel de
// Breeze con el usuario de cada uno (enlaces en la pantalla Monitorización).
//
// Secrets (Supabase del hub → Edge Functions → Secrets):
//   BREEZE_URL            raíz del panel, p. ej. https://breeze.oksistemas.online
//   BREEZE_HUB_EMAIL      usuario de servicio del hub en Breeze
//   BREEZE_HUB_PASSWORD   su contraseña
//
// El token de Breeze dura 15 min y su refresco va por cookie: se vuelve a
// hacer login (Breeze limita a 10 logins cada 5 min por IP, así que el token
// se guarda en memoria mientras la función siga caliente).

let _token = ''
let _caduca = 0

export function breezeUrl(): string {
  return (Deno.env.get('BREEZE_URL') ?? 'https://breeze.oksistemas.online').replace(/\/+$/, '')
}

export function breezeConfigurado(): boolean {
  return !!(Deno.env.get('BREEZE_HUB_EMAIL') && Deno.env.get('BREEZE_HUB_PASSWORD'))
}

async function login(): Promise<string> {
  if (_token && Date.now() < _caduca) return _token
  const res = await fetch(`${breezeUrl()}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email: Deno.env.get('BREEZE_HUB_EMAIL'), password: Deno.env.get('BREEZE_HUB_PASSWORD') }),
    signal: AbortSignal.timeout(20000),
  })
  const j = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`login en Breeze → ${res.status} ${j?.error ?? ''}`.trim())
  if (j?.mfaRequired) throw new Error('el usuario de servicio de Breeze tiene MFA: la función no puede pasarlo')
  const token = j?.tokens?.accessToken
  if (!token) throw new Error('Breeze no devolvió token')
  const segundos = Number(j?.tokens?.expiresInSeconds) || 900
  _token = token
  _caduca = Date.now() + (segundos - 60) * 1000
  return token
}

export class ErrorBreeze extends Error {
  constructor(public status: number, mensaje: string) { super(mensaje) }
}

// Petición autenticada; si el token caducó antes de tiempo, un reintento.
export async function breeze(metodo: 'GET' | 'POST', ruta: string, cuerpo?: unknown): Promise<unknown> {
  for (let intento = 0; intento < 2; intento++) {
    const res = await fetch(`${breezeUrl()}/api/v1${ruta}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${await login()}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(25000),
    })
    const texto = await res.text()
    let j: unknown = null
    try { j = texto ? JSON.parse(texto) : null } catch { j = texto }
    if (res.status === 401 && intento === 0) { _token = ''; continue }
    if (!res.ok) {
      const msg = (j as { error?: string; message?: string })?.error ?? (j as { message?: string })?.message ?? String(texto).slice(0, 200)
      throw new ErrorBreeze(res.status, `Breeze ${metodo} ${ruta} → ${res.status}: ${msg}`)
    }
    return j
  }
  throw new ErrorBreeze(401, 'Breeze rechaza el token del usuario de servicio')
}
