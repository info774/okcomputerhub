// desk-correo — el correo del Desk (fase 6) sobre el Gmail de la empresa.
//
// Va en SIN_JWT: la lanza pg_cron cada 5 min (x-sync-token) para LEER lo que
// entra en info@: si es de un ticket (mismo hilo o «[#numero]» en el asunto)
// va como comentario del cliente (y lo reabre si estaba cerrado); si es de un
// cliente o contacto conocido, abre ticket; si es de alguien desconocido, a la
// bandeja (#/tickets/bandeja) para que una persona decida; los boletines y
// respuestas automáticas se descartan solos (quedan apuntados).
//
// Con sesión: { accion: 'estado' }, { accion: 'enviar', comentario_id } (manda
// una respuesta del ticket por correo, en su hilo) y { accion: 'leer' } (admin).
import { makeCorsHeaders, json, getAuthedUser, isAdminUser, unauthorized, forbidden, mismoToken } from '../_shared/http.ts'
import { hubDb, type Db, type Fila } from '../_shared/hub-db.ts'
import { googleConfigurado } from '../_shared/google.ts'
import { BUZON, correosDesde, enviarCorreo, perfilBuzon, type Correo } from '../_shared/gmail.ts'

const esUuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)
const q = (s: string) => encodeURIComponent(s.replace(/[\\%_*,()]/g, ''))

async function ticketDe(db: Db, c: Correo): Promise<Fila | null> {
  const [porHilo] = await db.get(`tickets?select=id,numero,email_hilo,email_de&email_hilo=eq.${encodeURIComponent(c.hilo)}&limit=1`)
  if (porHilo) return porHilo
  const n = c.asunto.match(/\[#(\d{1,7})\]/)?.[1]
  if (!n) return null
  const [porNumero] = await db.get(`tickets?select=id,numero,email_hilo,email_de&numero=eq.${n}&limit=1`)
  return porNumero ?? null
}

async function quienEs(db: Db, email: string): Promise<{ cliente_id: string | null; contacto_id: string | null } | null> {
  const [k] = await db.get(`contactos?select=id,cliente_id&activo=eq.true&email=ilike.${q(email)}&limit=1`)
  if (k) return { cliente_id: (k.cliente_id as string) ?? null, contacto_id: k.id as string }
  const [c] = await db.get(`clientes?select=id&activo=eq.true&email=ilike.${q(email)}&limit=1`)
  return c ? { cliente_id: c.id as string, contacto_id: null } : null
}

async function leer(db: Db) {
  const [e] = await db.get('sync_estado?select=corte_ts&clave=eq.correo')
  const inicio = new Date()
  const desde = e?.corte_ts ? new Date(new Date(String(e.corte_ts)).getTime() - 3600_000) : new Date(Date.now() - 2 * 86400_000)
  const cuenta = { ticket: 0, comentario: 0, nuevo: 0, descartado: 0, ya: 0 }
  try {
    for (const c of await correosDesde(desde)) {
      if (c.de === BUZON.toLowerCase()) continue
      const [ya] = await db.get(`correos_entrantes?select=id&gmail_id=eq.${encodeURIComponent(c.id)}`)
      if (ya) { cuenta.ya++; continue }
      const fila: Fila = { gmail_id: c.id, hilo: c.hilo, message_id: c.messageId, de: c.de, de_nombre: c.deNombre,
        asunto: c.asunto.slice(0, 500), texto: c.texto, recibido_at: c.fecha }
      const t = await ticketDe(db, c)
      if (t) {
        await db.post('ticket_comentarios', { ticket_id: t.id, autor_nombre: `${c.deNombre ?? c.de} (correo)`, texto: c.texto || '(sin texto)',
          tipo: 'cliente', canal: 'email', email_id: c.id, created_at: c.fecha })
        if (!t.email_hilo) await db.patch(`tickets?id=eq.${t.id}`, { email_hilo: c.hilo, email_de: t.email_de ?? c.de })
        await db.post('correos_entrantes', { ...fila, estado: 'comentario', ticket_id: t.id }); cuenta.comentario++
      } else if (c.automatico) {
        await db.post('correos_entrantes', { ...fila, estado: 'descartado', motivo: c.automatico }); cuenta.descartado++
      } else {
        const quien = await quienEs(db, c.de)
        if (quien) {
          const [nuevo] = await db.post('tickets', { titulo: c.asunto.slice(0, 200), descripcion: c.texto, ...quien, estado: 'Abierto',
            prioridad: 'Media', canal: 'email', via_contacto: 'email', email_hilo: c.hilo, email_de: c.de, created_at: c.fecha })
          await db.post('correos_entrantes', { ...fila, estado: 'ticket', ticket_id: nuevo.id }); cuenta.ticket++
        } else {
          await db.post('correos_entrantes', { ...fila, estado: 'nuevo' }); cuenta.nuevo++
        }
      }
    }
    await db.upsert('sync_estado', 'clave', [{ clave: 'correo', corte_ts: inicio.toISOString(), ultima_ok: inicio.toISOString(),
      filas: cuenta.ticket + cuenta.comentario + cuenta.nuevo, detalle: cuenta, ultimo_error: null }])
    return cuenta
  } catch (err) {
    // Un fallo NO mueve el corte: la próxima pasada vuelve a pedir la misma ventana.
    await db.upsert('sync_estado', 'clave', [{ clave: 'correo', ultimo_error: (err as Error).message.slice(0, 500), ultimo_error_at: new Date().toISOString() }]).catch(() => {})
    throw err
  }
}

async function enviar(db: Db, id: string) {
  const [c] = await db.get(`ticket_comentarios?select=*&id=eq.${id}`)
  if (!c) throw new Error('No existe ese comentario')
  if (c.tipo !== 'respuesta') throw new Error('Solo se mandan las respuestas al cliente, no las notas internas')
  if (c.enviado_at) return { ya: true }
  const [t] = await db.get(`tickets?select=id,numero,titulo,email_hilo,email_de,contacto_id,cliente_id&id=eq.${c.ticket_id}`)
  let para = t?.email_de as string | null
  if (!para && t?.contacto_id) para = ((await db.get(`contactos?select=email&id=eq.${t.contacto_id}`))[0]?.email as string) ?? null
  if (!para && t?.cliente_id) para = ((await db.get(`clientes?select=email&id=eq.${t.cliente_id}`))[0]?.email as string) ?? null
  if (!para) throw new Error('El ticket no tiene correo del cliente: contéstale por WhatsApp o teléfono')
  const [ultimo] = await db.get(`correos_entrantes?select=message_id&ticket_id=eq.${t.id}&message_id=not.is.null&order=recibido_at.desc&limit=1`)
  try {
    const r = await enviarCorreo({ para, asunto: `${t.email_hilo ? 'Re: ' : ''}${t.titulo ?? 'Tu aviso'} [#${t.numero}]`,
      texto: String(c.texto), hilo: (t.email_hilo as string) ?? null, enRespuestaA: (ultimo?.message_id as string) ?? null })
    await db.patch(`ticket_comentarios?id=eq.${id}`, { enviado_at: new Date().toISOString(), email_id: r.id, canal: 'email', envio_error: null })
    if (!t.email_hilo || !t.email_de) await db.patch(`tickets?id=eq.${t.id}`, { email_hilo: t.email_hilo ?? r.hilo, email_de: t.email_de ?? para })
    return { ok: true, para }
  } catch (e) {
    await db.patch(`ticket_comentarios?id=eq.${id}`, { envio_error: (e as Error).message.slice(0, 500) })
    throw e
  }
}

Deno.serve(async req => {
  const cors = makeCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405, cors)
  const sistema = hubDb({ origen: 'correo' })
  const cuerpo = await req.json().catch(() => ({}))
  try {
    const tokenCron = ((await sistema.rpc('secreto', { p_nombre: 'hub_sync_token' }).catch(() => '')) as string) || ''
    if (mismoToken(req.headers.get('x-sync-token') ?? '', tokenCron)) {
      if (!googleConfigurado()) return json({ ok: false, error: 'Falta GOOGLE_SA_KEY' }, 200, cors)
      return json({ ok: true, ...(await leer(sistema)) }, 200, cors)
    }
    const user = await getAuthedUser(req)
    if (!user?.email) return unauthorized(cors)
    const [p] = await sistema.get(`usuarios?select=id&activo=eq.true&email=ilike.${q(user.email)}`)
    if (!p) return forbidden(cors, 'No estás dado de alta en el hub.')
    const db = hubDb({ origen: 'desk', email: user.email })
    if (cuerpo.accion === 'estado') {
      const [s] = await sistema.get('sync_estado?select=ultima_ok,ultimo_error,detalle&clave=eq.correo')
      if (!googleConfigurado()) return json({ configurado: false, buzon: BUZON, sync: s ?? null }, 200, cors)
      try { return json({ configurado: true, buzon: BUZON, ok: true, ...(await perfilBuzon()), sync: s ?? null }, 200, cors) }
      catch (e) { return json({ configurado: true, buzon: BUZON, ok: false, error: (e as Error).message, sync: s ?? null }, 200, cors) }
    }
    if (cuerpo.accion === 'enviar') {
      if (!esUuid(cuerpo.comentario_id)) return json({ error: 'comentario_id no válido' }, 400, cors)
      return json(await enviar(db, cuerpo.comentario_id), 200, cors)
    }
    if (cuerpo.accion === 'leer') {
      if (!(await isAdminUser(user))) return forbidden(cors)
      return json({ ok: true, ...(await leer(sistema)) }, 200, cors)
    }
    return json({ error: 'Acción desconocida (estado, enviar, leer)' }, 400, cors)
  } catch (e) {
    console.error('[desk-correo]', e)
    return json({ ok: false, error: (e as Error).message }, 502, cors)
  }
})
