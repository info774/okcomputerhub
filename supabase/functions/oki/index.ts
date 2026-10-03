// oki — lo que Oki redacta para que una persona lo mande (nada sale solo
// hacia un cliente). Con sesión de una persona del hub.
//   estado                       → { claude }
//   proponer_ticket {ticket_id}  → { propuesta } | { propuesta: null, motivo }
// La usa «Sí, contéstalo» de la portada y «Que Oki lo redacte» del ticket:
// el texto entra en la caja de respuesta del ticket y se manda desde allí.
// Las notas internas NO van a Claude: lo que se le cuenta al cliente sale
// solo de lo que el cliente y la empresa ya se han dicho.
import { makeCorsHeaders, json, getAuthedUser, unauthorized, forbidden } from '../_shared/http.ts'
import { hubDb, esUuid } from '../_shared/hub-db.ts'
import { personaPorEmail } from '../_shared/personas.ts'
import { claudeConfigurado, preguntarClaude } from '../_shared/claude.ts'

Deno.serve(async req => {
  const cors = makeCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405, cors)
  const user = await getAuthedUser(req)
  if (!user?.email) return unauthorized(cors)
  const db = hubDb({ origen: 'oki', email: user.email })
  const yo = await personaPorEmail(db, user.email)
  if (!yo) return forbidden(cors, 'No estás dado de alta en el hub.')
  const b = await req.json().catch(() => ({}))
  try {
    if (b.accion === 'estado') return json({ claude: claudeConfigurado() }, 200, cors)

    if (b.accion === 'proponer_ticket') {
      if (!esUuid(b.ticket_id)) return json({ error: 'Ticket no válido' }, 400, cors)
      if (!claudeConfigurado()) return json({ propuesta: null, motivo: 'Oki necesita la clave de Claude (ANTHROPIC_API_KEY) para redactar respuestas.' }, 200, cors)
      const [t] = await db.get(`tickets?select=id,numero,titulo,descripcion,estado,prioridad,cliente_id&id=eq.${b.ticket_id}`)
      if (!t) return json({ error: 'Ticket no encontrado' }, 404, cors)
      const [cli] = t.cliente_id ? await db.get(`clientes?select=nombre&id=eq.${t.cliente_id}`) : []
      const coms = await db.get(`ticket_comentarios?select=tipo,texto,autor_nombre,created_at&ticket_id=eq.${t.id}&tipo=in.(cliente,respuesta)&order=created_at.desc&limit=14`)
      const hilo = [...coms].reverse().map(c => `${c.tipo === 'cliente' ? 'CLIENTE' : `NOSOTROS (${c.autor_nombre ?? ''})`}: ${c.texto}`).join('\n')
      const propuesta = await preguntarClaude({
        sistema: 'Eres Oki, el asistente de OK Computer (servicios informáticos, TPV, alarmas y cámaras en Tenerife). '
          + 'Redacta la PRÓXIMA respuesta de la empresa al cliente en este ticket de soporte. Trato de usted, frases cortas, '
          + 'tono cercano y profesional, sin emojis, en español. No prometas horas, precios ni visitas concretas que no salgan '
          + 'de la conversación: si hace falta, di que lo revisamos y le decimos. Devuelve SOLO el texto, sin asunto ni firma.',
        contenido: `Ticket #${t.numero}: ${t.titulo}\nCliente: ${cli?.nombre ?? '—'} · estado ${t.estado}${t.prioridad ? ` · prioridad ${t.prioridad}` : ''}\n\n`
          + `Aviso inicial:\n${t.descripcion ?? '(sin descripción)'}\n\nConversación:\n${hilo || '(todavía no le hemos contestado)'}`,
        maxTokens: 700, esfuerzo: 'low',
      })
      return json({ propuesta: String(propuesta).trim() || null }, 200, cors)
    }

    return json({ error: 'Acción desconocida (estado, proponer_ticket)' }, 400, cors)
  } catch (e) {
    console.error('[oki]', e)
    return json({ error: (e as Error).message }, 502, cors)
  }
})
