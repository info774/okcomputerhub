// comandas — dictar o escribir una comanda desde el hub (#/comandas).
// Con sesión: { accion: 'crear', texto } o { accion: 'crear', audio (base64), mime }
// → transcribe (Groq), trocea (Claude) y guarda; { accion: 'estado' } → qué
// hay configurado; { accion: 'transcribir', audio, mime } → { texto }, solo el
// dictado (la nota de voz del tablero). Las tareas se mueven luego desde el
// front (RLS).
import { makeCorsHeaders, json, getAuthedUser, unauthorized, forbidden } from '../_shared/http.ts'
import { hubDb } from '../_shared/hub-db.ts'
import { personaPorEmail } from '../_shared/personas.ts'
import { claudeConfigurado } from '../_shared/claude.ts'
import { crearComanda, groqConfigurado, transcribir } from '../_shared/comandas.ts'

Deno.serve(async req => {
  const cors = makeCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405, cors)
  const user = await getAuthedUser(req)
  if (!user?.email) return unauthorized(cors)
  const yo = await personaPorEmail(hubDb({ origen: 'comandas' }), user.email)
  if (!yo) return forbidden(cors, 'No estás dado de alta en el hub.')
  const db = hubDb({ origen: 'comandas', email: user.email })
  const b = await req.json().catch(() => ({}))
  try {
    if (b.accion === 'estado') return json({ audio: groqConfigurado(), claude: claudeConfigurado() }, 200, cors)
    if (b.accion === 'crear') {
      let texto = typeof b.texto === 'string' ? b.texto : ''
      if (!texto && typeof b.audio === 'string') {
        const bytes = Uint8Array.from(atob(b.audio), c => c.charCodeAt(0))
        texto = await transcribir(bytes, String(b.mime ?? 'audio/webm'))
        if (!texto) return json({ error: 'No se entendió nada en el audio' }, 422, cors)
      }
      return json(await crearComanda(db, { texto, origen: 'app', autorId: yo.id, autorNombre: yo.nombre }), 200, cors)
    }
    if (b.accion === 'transcribir') {
      if (typeof b.audio !== 'string' || !b.audio) return json({ error: 'Falta el audio' }, 400, cors)
      if (!groqConfigurado()) return json({ error: 'El dictado no está configurado (falta GROQ_API_KEY)' }, 503, cors)
      const bytes = Uint8Array.from(atob(b.audio), c => c.charCodeAt(0))
      const texto = await transcribir(bytes, String(b.mime ?? 'audio/webm'))
      return json({ texto }, 200, cors)
    }
    return json({ error: 'Acción desconocida (estado, crear, transcribir)' }, 400, cors)
  } catch (e) {
    console.error('[comandas]', e)
    return json({ error: (e as Error).message }, 502, cors)
  }
})
