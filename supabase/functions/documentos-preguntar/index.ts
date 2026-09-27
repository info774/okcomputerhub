// documentos-preguntar — «pregúntale a la wiki»: busca en el índice (wiki,
// Drive, conocimiento y tablero de la app) y Claude redacta la respuesta
// citando las fuentes. Con sesión (JWT) de un usuario del hub.
// Cuerpo: { pregunta }  →  { respuesta, fuentes: [{ n, titulo, url, fuente, texto }], con_claude }
import { makeCorsHeaders, json, getAuthedUser, unauthorized, forbidden } from '../_shared/http.ts'
import { hubDb } from '../_shared/hub-db.ts'
import { preguntar } from '../_shared/rag.ts'

Deno.serve(async req => {
  const cors = makeCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405, cors)
  const user = await getAuthedUser(req)
  if (!user?.email) return unauthorized(cors)
  const db = hubDb({ origen: 'preguntar', email: user.email })
  const [p] = await db.get(`usuarios?select=id&activo=eq.true&email=ilike.${encodeURIComponent(user.email.replace(/[\\%_]/g, '\\$&'))}`)
  if (!p) return forbidden(cors, 'No estás dado de alta en el hub.')
  const cuerpo = await req.json().catch(() => ({}))
  try {
    return json(await preguntar(db, String(cuerpo.pregunta ?? '')), 200, cors)
  } catch (e) {
    return json({ error: (e as Error).message }, 400, cors)
  }
})
