// Acceso a las APIs de Google con la cuenta de servicio del hub
// (firebase-adminsdk-fbsvc@okcomputerclaude.iam.gserviceaccount.com, la misma
// que despliega el front). JWT firmado con su clave → token de acceso.
//
// · Drive (fase 5): la carpeta se COMPARTE con el correo de la cuenta de
//   servicio (lector); no hace falta delegación.
// · Gmail (fase 6): necesita delegación de dominio en Google Workspace
//   (Admin → Seguridad → Controles de API → Delegación de todo el dominio) y
//   se actúa «como» info@okcomputertenerife.com (`sujeto`).
//
// Secrets: GOOGLE_SA_KEY (la clave privada PEM) y, opcional, GOOGLE_SA_EMAIL.

export const correoCuenta = () => Deno.env.get('GOOGLE_SA_EMAIL') ?? 'firebase-adminsdk-fbsvc@okcomputerclaude.iam.gserviceaccount.com'
export const googleConfigurado = () => !!Deno.env.get('GOOGLE_SA_KEY')

const b64url = (b: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof b === 'string' ? new TextEncoder().encode(b) : new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b))
  let s = ''
  for (const x of bytes) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

let _clave: CryptoKey | null = null
async function clave(): Promise<CryptoKey> {
  if (_clave) return _clave
  const pem = (Deno.env.get('GOOGLE_SA_KEY') ?? '').replace(/\\n/g, '\n')
  const cuerpo = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '')
  if (!cuerpo) throw new Error('Falta GOOGLE_SA_KEY (clave de la cuenta de servicio de Google)')
  const der = Uint8Array.from(atob(cuerpo), c => c.charCodeAt(0))
  _clave = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  return _clave
}

const _tokens = new Map<string, { token: string; caduca: number }>()

// Token de acceso para unos permisos; `sujeto` = actuar como ese usuario (delegación).
export async function tokenGoogle(scopes: string[], sujeto?: string): Promise<string> {
  const k = `${scopes.join(' ')}|${sujeto ?? ''}`
  const t = _tokens.get(k)
  if (t && Date.now() < t.caduca) return t.token
  const ahora = Math.floor(Date.now() / 1000)
  const cab = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const carga = b64url(JSON.stringify({ iss: correoCuenta(), scope: scopes.join(' '), aud: 'https://oauth2.googleapis.com/token',
    iat: ahora, exp: ahora + 3600, ...(sujeto ? { sub: sujeto } : {}) }))
  const firma = b64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await clave(), new TextEncoder().encode(`${cab}.${carga}`)))
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${cab}.${carga}.${firma}` }),
    signal: AbortSignal.timeout(20000),
  })
  const j = await res.json().catch(() => ({}))
  if (!j.access_token) {
    throw new Error(j.error === 'unauthorized_client'
      ? 'Google no deja actuar como ese usuario: falta la delegación de dominio (ver docs/PENDIENTE_FRAN.md)'
      : `Google no dio acceso: ${j.error_description ?? j.error ?? res.status}`)
  }
  _tokens.set(k, { token: j.access_token, caduca: Date.now() + ((Number(j.expires_in) || 3600) - 120) * 1000 })
  return j.access_token
}

export async function googleFetch(url: string, scopes: string[], init: RequestInit & { sujeto?: string } = {}): Promise<Response> {
  const { sujeto, ...resto } = init
  return fetch(url, { ...resto, headers: { ...(resto.headers ?? {}), Authorization: `Bearer ${await tokenGoogle(scopes, sujeto)}` },
    signal: resto.signal ?? AbortSignal.timeout(60000) })
}
