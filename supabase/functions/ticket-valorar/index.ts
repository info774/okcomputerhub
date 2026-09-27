// ticket-valorar — la valoración 1-5 que deja el cliente con el enlace del
// mensaje de cierre (public/valorar.html?t=<token>). SIN_JWT: lo autoriza el
// token del ticket (uuid imposible de adivinar); se puede cambiar 30 días.
// { token } → { numero, titulo } · { token, nota, comentario } → guarda.
import { makeCorsHeaders, json } from '../_shared/http.ts'
import { hubDb } from '../_shared/hub-db.ts'

Deno.serve(async req => {
  const cors = makeCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405, cors)
  const b = await req.json().catch(() => ({}))
  if (typeof b.token !== 'string' || !/^[0-9a-f-]{36}$/i.test(b.token)) return json({ error: 'Enlace no válido' }, 400, cors)
  const nota = b.nota == null ? null : Number(b.nota)
  if (nota != null && !(Number.isInteger(nota) && nota >= 1 && nota <= 5)) return json({ error: 'La nota va de 1 a 5' }, 400, cors)
  try {
    const r = await hubDb({ origen: 'valoracion' }).rpc('valorar_ticket',
      { p_token: b.token, p_nota: nota, p_comentario: typeof b.comentario === 'string' ? b.comentario.slice(0, 2000) : null }) as { numero: number; titulo: string }[]
    if (!r?.length) return json({ error: 'Este enlace ya no vale' }, 404, cors)
    return json({ numero: r[0].numero, titulo: r[0].titulo, guardada: nota != null }, 200, cors)
  } catch (e) {
    console.error('[ticket-valorar]', e)
    return json({ error: 'No se pudo guardar' }, 500, cors)
  }
})
