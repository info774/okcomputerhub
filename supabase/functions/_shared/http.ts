// Utilidades HTTP de las edge functions del hub (portado de
// okcomputerclaude/supabase/functions/_shared/http.ts).

// Orígenes permitidos. El secret ALLOWED_ORIGINS AÑADE (no sustituye): así un
// secret viejo no deja fuera al dominio nuevo.
const DEFAULT_ALLOWED_ORIGINS = [
  'https://okhub-tenerife.web.app',
  'https://okhub-tenerife.firebaseapp.com',
  'http://localhost:5173',
  'http://localhost:4173',
]

// Canales de preview de Firebase Hosting: SITE--CHANNEL-HASH.web.app
const PREVIEW_ORIGIN_RE = /^https:\/\/okhub-tenerife--[a-z0-9-]+\.web\.app$/

function isAllowedOrigin(origin: string, allowed: string[]): boolean {
  if (!origin) return false
  return allowed.includes(origin) || PREVIEW_ORIGIN_RE.test(origin)
}

export function makeCorsHeaders(req: Request): Record<string, string> {
  const extra = Deno.env.get('ALLOWED_ORIGINS')?.split(',').map(s => s.trim()).filter(Boolean) ?? []
  const allowed = [...DEFAULT_ALLOWED_ORIGINS, ...extra]
  const origin = req.headers.get('Origin') ?? ''
  const headers: Record<string, string> = {
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
  if (isAllowedOrigin(origin, allowed)) headers['Access-Control-Allow-Origin'] = origin
  else if (origin) console.warn(`[cors] origen no permitido: ${origin}`)
  return headers
}

export function json(body: unknown, status = 200, cors: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

// JWT de sesión real de Supabase Auth: la anon key sola no pasa.
export async function getAuthedUser(req: Request): Promise<{ id: string; email?: string } | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return null
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, {
    headers: { apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '', Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
  const user = await res.json().catch(() => null)
  return user?.id ? user : null
}

// ¿Administrador del hub? Misma regla que hub.es_admin() (email → hub.usuarios).
export async function isAdminUser(user: { email?: string } | null): Promise<boolean> {
  const email = (user?.email || '').trim()
  if (!email) return false
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const q = new URLSearchParams({ select: 'rol,activo', email: `ilike.${email.replace(/[\\%_]/g, '\\$&')}`, limit: '5' })
  const res = await fetch(`${url}/rest/v1/usuarios?${q}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Accept-Profile': 'hub' },
  })
  if (!res.ok) return false
  const rows = await res.json().catch(() => [])
  return Array.isArray(rows) && rows.some((r: { rol?: string; activo?: boolean }) => r.rol === 'admin' && r.activo !== false)
}

// Comparación en tiempo constante para tokens de cabecera.
export function mismoToken(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

export function unauthorized(cors: Record<string, string>): Response {
  return json({ error: 'No autorizado: se requiere sesión de usuario válida.' }, 401, cors)
}
export function forbidden(cors: Record<string, string>, motivo = 'Solo un administrador puede hacer esto.'): Response {
  return json({ error: motivo }, 403, cors)
}
