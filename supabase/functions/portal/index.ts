// portal — el área de clientes (fase 7). SIN_JWT: los clientes no son
// usuarios de Supabase; entran con un ENLACE MÁGICO que se manda desde el
// Gmail de la empresa a los correos INVITADOS (hub.portal_accesos) y trabajan
// con una sesión propia (cabecera x-portal-token, 30 días). Todo lo que
// devuelve va filtrado por el cliente del acceso, y queda en hub.portal_traza.
//
// Sin sesión: pedir_enlace { email } (siempre la misma respuesta: no dice si
// el correo existe) y entrar { codigo }.
// Con sesión: yo, resumen, tickets, ticket, ticket_crear, ticket_mensaje,
// presupuestos, presupuesto_aceptar, facturas, pdf, mantenimiento, equipos, salir.
// Con sesión del HUB (admin): enlace_admin { acceso_id } → el enlace para
// mandarlo a mano (por WhatsApp) mientras el correo no esté conectado.
import { makeCorsHeaders, json, getAuthedUser, isAdminUser } from '../_shared/http.ts'
import { hubDb, type Db, type Fila } from '../_shared/hub-db.ts'
import { enviarCorreo } from '../_shared/gmail.ts'
import { zohoPdf } from '../_shared/zoho.ts'
import { enviarTelegram, h } from '../_shared/mensajeria.ts'
import { urlFirmada } from '../_shared/archivos.ts'

const PORTAL_URL = () => Deno.env.get('PORTAL_URL') ?? 'https://okhub-tenerife.web.app/portal.html'
const GESTORIA_URL = () => `${Deno.env.get('HUB_URL') ?? 'https://okhub-tenerife.web.app'}/gestoria.html`
const MIN_ENLACE = 30, DIAS_SESION = 30
const esUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)
const txt = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max)

const aleatorio = () => { const b = crypto.getRandomValues(new Uint8Array(32)); return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
async function huella(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('')
}

interface Sesion { sesion_id: string; acceso_id: string; email: string; nombre: string | null; cliente_id: string; tipo: 'cliente' | 'gestoria' }

const traza = (db: Db, s: { acceso_id?: string; email?: string } | null, accion: string, detalle?: Fila) =>
  db.post('portal_traza', { acceso_id: s?.acceso_id ?? null, email: s?.email ?? null, accion, detalle: detalle ?? null }).catch(e => console.error('[portal] traza', e))

async function nuevoEnlace(db: Db, accesoId: string, tipo = 'cliente'): Promise<string> {
  const codigo = aleatorio()
  await db.post('portal_enlaces', { acceso_id: accesoId, huella: await huella(codigo), caduca_at: new Date(Date.now() + MIN_ENLACE * 60000).toISOString() })
  return `${tipo === 'gestoria' ? GESTORIA_URL() : PORTAL_URL()}?c=${codigo}`
}

async function sesion(db: Db, token: string | null): Promise<Sesion | null> {
  if (!token || token.length < 30) return null
  const [s] = await db.get(`portal_sesiones?select=id,acceso_id,ultimo_uso_at,portal_accesos(email,nombre,cliente_id,activo,tipo)&huella=eq.${await huella(token)}&cerrada_at=is.null&caduca_at=gt.${new Date().toISOString()}`)
  // deno-lint-ignore no-explicit-any
  const a = s?.portal_accesos as any
  if (!s || !a?.activo) return null
  if (!s.ultimo_uso_at || Date.now() - new Date(String(s.ultimo_uso_at)).getTime() > 5 * 60000) {
    await db.patch(`portal_sesiones?id=eq.${s.id}`, { ultimo_uso_at: new Date().toISOString() })
  }
  return { sesion_id: s.id as string, acceso_id: s.acceso_id as string, email: a.email, nombre: a.nombre, cliente_id: a.cliente_id, tipo: a.tipo ?? 'cliente' }
}

async function localesDe(db: Db, clienteId: string) {
  return db.get(`locales?select=id,nombre,direccion,plan,importe_mantenimiento,frecuencia_pago,estado_pago,proxima_cuota,activo&cliente_id=eq.${clienteId}&activo=eq.true&order=nombre`)
}
async function zohoIdDe(db: Db, clienteId: string): Promise<string | null> {
  const [c] = await db.get(`clientes?select=zoho_id&id=eq.${clienteId}`)
  return (c?.zoho_id as string) || null
}
async function ticketDe(db: Db, s: Sesion, numero: unknown) {
  const [t] = await db.get(`tickets?select=id,numero,titulo,descripcion,estado,prioridad,created_at,updated_at,cerrado_at,resolucion,local_id,tecnico_id&cliente_id=eq.${s.cliente_id}&numero=eq.${Number(numero) || 0}`)
  if (!t) throw new Error('No encontramos ese ticket')
  return t
}

async function avisarEquipo(db: Db, texto: string) {
  try {
    const admins = await db.get('usuarios?select=id&rol=eq.admin&activo=eq.true')
    if (!admins.length) return
    const vs = await db.get(`telegram_vinculos?select=chat_id&activo=eq.true&chat_id=not.is.null&usuario_id=in.(${admins.map(a => a.id).join(',')})`)
    for (const v of vs) await enviarTelegram(v.chat_id as number, texto).catch(() => {})
  } catch (e) { console.error('[portal] aviso', e) }
}

// deno-lint-ignore no-explicit-any
async function conSesion(db: Db, s: Sesion, accion: string, b: any): Promise<unknown> {
  switch (accion) {
    case 'yo': {
      const [c] = await db.get(`clientes?select=nombre&id=eq.${s.cliente_id}`)
      return { nombre: s.nombre, email: s.email, cliente: c?.nombre ?? '' }
    }
    case 'resumen': {
      const [tks, ls, zid] = await Promise.all([
        db.get(`tickets?select=id&cliente_id=eq.${s.cliente_id}&estado=neq.Cerrado`), localesDe(db, s.cliente_id), zohoIdDe(db, s.cliente_id)])
      const [pres, facs, eqs] = await Promise.all([
        db.get(`presupuestos?select=id&cliente_id=eq.${s.cliente_id}&estado=eq.Enviado`),
        zid ? db.get(`zoho_facturas?select=saldo&cliente_zoho_id=eq.${encodeURIComponent(zid)}&saldo=gt.0&estado=not.in.(draft,void)`) : Promise.resolve([]),
        ls.length ? db.get(`rmm_equipos?select=conectado,alertas_abiertas&local_id=in.(${ls.map(l => l.id).join(',')})`) : Promise.resolve([])])
      return { tickets_abiertos: tks.length, presupuestos_pendientes: pres.length,
        facturas_pendientes: facs.length, saldo_pendiente: facs.reduce((a, f) => a + Number(f.saldo ?? 0), 0),
        equipos: eqs.length, equipos_conectados: eqs.filter(e => e.conectado).length, alertas: eqs.reduce((a, e) => a + Number(e.alertas_abiertas ?? 0), 0), sedes: ls.length }
    }
    case 'tickets':
      return db.get(`tickets?select=numero,titulo,estado,prioridad,created_at,updated_at,cerrado_at&cliente_id=eq.${s.cliente_id}&order=created_at.desc&limit=100`)
    case 'ticket': {
      const t = await ticketDe(db, s, b.numero)
      // Las notas internas NUNCA salen al portal.
      const cs = await db.get(`ticket_comentarios?select=created_at,tipo,autor_nombre,texto&ticket_id=eq.${t.id}&tipo=in.(respuesta,cliente)&order=created_at`)
      await traza(db, s, 'ver_ticket', { numero: t.numero })
      const { id: _id, ...resto } = t
      return { ...resto, mensajes: cs.map(c => ({ fecha: c.created_at, de: c.tipo === 'cliente' ? 'tú' : 'Ok Computer', texto: c.texto })) }
    }
    case 'ticket_crear': {
      const titulo = txt(b.titulo, 200)
      if (titulo.length < 3) throw new Error('Cuéntanos en pocas palabras qué pasa')
      let local: string | null = null
      if (!b.local_id) {
        const ls = await localesDe(db, s.cliente_id)
        if (ls.length === 1) local = ls[0].id as string
      } else {
        if (!esUuid(b.local_id)) throw new Error('Sede no válida')
        const [l] = await db.get(`locales?select=id&id=eq.${b.local_id}&cliente_id=eq.${s.cliente_id}`)
        if (!l) throw new Error('Sede no válida')
        local = l.id as string
      }
      const [k] = await db.get(`contactos?select=id&cliente_id=eq.${s.cliente_id}&email=ilike.${encodeURIComponent(s.email.replace(/[\\%_*,()]/g, ''))}&limit=1`)
      const [t] = await db.post('tickets', { titulo, descripcion: txt(b.descripcion, 5000) || null, cliente_id: s.cliente_id, local_id: local,
        contacto_id: k?.id ?? null, estado: 'Abierto', prioridad: 'Media', canal: 'portal', via_contacto: 'portal', email_de: s.email })
      await traza(db, s, 'abrir_ticket', { numero: t.numero })
      return { numero: t.numero }
    }
    case 'ticket_mensaje': {
      const t = await ticketDe(db, s, b.numero)
      const texto = txt(b.texto, 5000)
      if (!texto) throw new Error('Escribe el mensaje')
      await db.post('ticket_comentarios', { ticket_id: t.id, texto, tipo: 'cliente', canal: 'portal', autor_nombre: `${s.nombre ?? s.email} (portal)` })
      await traza(db, s, 'mensaje_ticket', { numero: t.numero })
      return { ok: true }
    }
    case 'presupuestos': {
      const ps = await db.get(`presupuestos?select=id,numero_presupuesto,titulo,estado,total,fecha,zoho_estimate_id&cliente_id=eq.${s.cliente_id}&estado=neq.Borrador&order=fecha.desc.nullslast&limit=100`)
      const ac = ps.length ? await db.get(`portal_aceptaciones?select=presupuesto_id,created_at,nombre&presupuesto_id=in.(${ps.map(p => p.id).join(',')})`) : []
      return ps.map(p => ({ id: p.id, numero: p.numero_presupuesto, titulo: p.titulo, estado: p.estado, total: p.total, fecha: p.fecha,
        pdf: !!p.zoho_estimate_id, aceptado: ac.find(a => a.presupuesto_id === p.id) ?? null }))
    }
    case 'presupuesto_aceptar': {
      if (!esUuid(b.id)) throw new Error('Presupuesto no válido')
      const nombre = txt(b.nombre, 120)
      if (nombre.length < 3) throw new Error('Escribe tu nombre para aceptarlo')
      const [p] = await db.get(`presupuestos?select=id,numero_presupuesto,titulo,estado,total&id=eq.${b.id}&cliente_id=eq.${s.cliente_id}`)
      if (!p) throw new Error('Presupuesto no válido')
      if (p.estado !== 'Enviado') throw new Error('Este presupuesto ya no está pendiente de aceptar')
      const [ac] = await db.post('portal_aceptaciones', { presupuesto_id: p.id, acceso_id: s.acceso_id, nombre, comentario: txt(b.comentario, 2000) || null })
      await traza(db, s, 'aceptar_presupuesto', { presupuesto: p.numero_presupuesto, total: p.total })
      // Con el área `presupuestos` del hub (tras el corte) pasa a «Aceptado» solo y la
      // aceptación queda revisada; antes, lo pasa una persona en la app (paridad bloque 8, tanda 3).
      const [area] = await db.get('areas?select=dueno&tablas=cs.{presupuestos}&limit=1')
      const delHub = ((area?.dueno as string | undefined) ?? 'hub') === 'hub'
      if (delHub) {
        await db.patch(`presupuestos?id=eq.${p.id}`, { estado: 'Aceptado' })
        if (ac?.id) await db.patch(`portal_aceptaciones?id=eq.${ac.id}`, { revisada_at: new Date().toISOString() })
      }
      const [c] = await db.get(`clientes?select=nombre&id=eq.${s.cliente_id}`)
      await avisarEquipo(db, `✅ <b>Presupuesto aceptado en el portal</b>\n${h(p.numero_presupuesto ?? '')} ${h(p.titulo ?? '')} · ${h(c?.nombre ?? '')}\nLo aceptó ${h(nombre)}. ${delHub ? 'Ya está como aceptado en el hub.' : 'Pásalo a aceptado en la app.'}`)
      return { ok: true }
    }
    case 'facturas': {
      const zid = await zohoIdDe(db, s.cliente_id)
      if (!zid) return []
      return db.get(`zoho_facturas?select=invoice_id,numero,fecha,vence,estado,total,saldo&cliente_zoho_id=eq.${encodeURIComponent(zid)}&estado=not.in.(draft,void)&order=fecha.desc&limit=200`)
    }
    case 'mantenimiento':
      return (await localesDe(db, s.cliente_id)).map(l => ({ local_id: l.id, nombre: l.nombre, direccion: l.direccion, plan: l.plan, importe: l.importe_mantenimiento,
        frecuencia: l.frecuencia_pago, estado_pago: l.estado_pago, proxima_cuota: l.proxima_cuota }))
    case 'equipos': {
      const ls = await localesDe(db, s.cliente_id)
      if (!ls.length) return []
      const eqs = await db.get(`rmm_equipos?select=hostname,nombre,local_id,so,conectado,visto_ultimo,alertas_abiertas,reinicio_pendiente,parches_pendientes,antivirus&local_id=in.(${ls.map(l => l.id).join(',')})&order=hostname`)
      return eqs.map(e => ({ ...e, sede: ls.find(l => l.id === e.local_id)?.nombre ?? '', local_id: undefined }))
    }
    case 'salir':
      await db.patch(`portal_sesiones?id=eq.${s.sesion_id}`, { cerrada_at: new Date().toISOString() })
      await traza(db, s, 'salir')
      return { ok: true }
  }
  throw new Error('Acción desconocida')
}

// ── Gestoría (fase 10): todo lo que consulta queda en la traza ────────────
const mesDe = (v: unknown) => { const m = String(v ?? '').match(/^(\d{4})-(\d{2})$/); if (!m) throw new Error('Mes no válido (AAAA-MM)'); return { desde: `${m[1]}-${m[2]}-01`, hasta: new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).toISOString().slice(0, 10), mes: `${m[1]}-${m[2]}` } }
// deno-lint-ignore no-explicit-any
async function gestoria(db: Db, s: Sesion, accion: string, b: any): Promise<unknown> {
  const { desde, hasta, mes } = mesDe(b.mes)
  await traza(db, s, accion, { mes })
  switch (accion) {
    case 'g_jornada': {
      const filas = (await db.rpc('jornada', { p_desde: desde, p_hasta: hasta })) as Fila[]
      const [cierres, ajustes] = await Promise.all([db.get(`jornada_cierres?select=usuario_id,confirmado_at&mes=eq.${desde}`),
        db.get(`jornada_ajustes?select=usuario_id,fecha,motivo,created_at&fecha=gte.${desde}&fecha=lte.${hasta}`)])
      return { dias: filas, conformidad: cierres, ajustes }
    }
    case 'g_ausencias':
      return db.get(`ausencias?select=usuario_id,tipo,desde,hasta,dias,estado&estado=eq.aprobada&desde=lte.${hasta}&hasta=gte.${desde}&order=desde`)
    case 'g_gastos': {
      const [hubG, appG] = await Promise.all([
        db.get(`tickets_gasto?select=id,fecha,proveedor,nif,concepto,base,impuesto_pct,impuesto,total,categoria,forma_pago,estado,archivo_path&fecha=gte.${desde}&fecha=lte.${hasta}&estado=in.(ok,revisar)&order=fecha`),
        db.get(`gastos?select=id,fecha,importe,categoria,descripcion,notas,tecnico_id,tipo,foto_url&fecha=gte.${desde}&fecha=lte.${hasta}&order=fecha`)])
      return { tickets: hubG.map(g => ({ ...g, archivo: !!g.archivo_path, archivo_path: undefined })), app: appG }
    }
    case 'g_gasto_url': {
      if (!esUuid(b.id)) throw new Error('id no válido')
      const [g] = await db.get(`tickets_gasto?select=archivo_path&id=eq.${b.id}`)
      if (!g?.archivo_path) throw new Error('Sin fichero')
      return { url: await urlFirmada('gastos', String(g.archivo_path), 300) }
    }
    case 'g_facturas':
      return db.get(`zoho_facturas?select=numero,fecha,cliente_nombre,total,saldo,estado&fecha=gte.${desde}&fecha=lte.${hasta}&estado=not.in.(draft,void)&order=fecha,numero`)
    case 'g_personas':
      return db.get('usuarios?select=id,nombre&activo=eq.true&order=nombre')
    case 'g_cierre': {
      const [c] = await db.get(`cierres_mes?select=*&mes=eq.${desde}`)
      if (b.estado === 'revisado') {
        if (c?.estado === 'cerrado') throw new Error('El mes ya está cerrado')
        await db.upsert('cierres_mes', 'mes', [{ mes: desde, estado: 'revisado', nota_gestoria: txt(b.nota, 4000) || null, revisado_at: new Date().toISOString(), revisado_por: s.email }])
        await avisarEquipo(db, `📒 <b>La gestoría ha revisado ${h(mes)}</b>${b.nota ? `\n«${h(txt(b.nota, 500))}»` : ''}\nCiérralo en el hub (Personas → Cierre).`)
        return { ok: true }
      }
      return c ?? { mes: desde, estado: 'abierto' }
    }
  }
  throw new Error('Acción desconocida')
}

Deno.serve(async req => {
  const cors = { ...makeCorsHeaders(req), 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-portal-token' }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405, cors)
  const db = hubDb({ origen: 'portal' })
  const b = await req.json().catch(() => ({}))
  const accion = String(b.accion ?? '')
  try {
    if (accion === 'pedir_enlace') {
      const email = txt(b.email, 200).toLowerCase()
      const respuesta = { ok: true, mensaje: 'Si ese correo tiene acceso, en unos minutos te llega un enlace para entrar.' }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(respuesta, 200, cors)
      const [a] = await db.get(`portal_accesos?select=id,email,nombre,tipo&email=eq.${encodeURIComponent(email)}&activo=eq.true`)
      if (!a) { await traza(db, { email }, 'enlace_desconocido'); return json(respuesta, 200, cors) }
      const hora = await db.get(`portal_enlaces?select=id&acceso_id=eq.${a.id}&created_at=gt.${new Date(Date.now() - 3600000).toISOString()}`)
      if (hora.length >= 5) { await traza(db, { acceso_id: a.id as string, email }, 'enlace_limite'); return json(respuesta, 200, cors) }
      const url = await nuevoEnlace(db, a.id as string, a.tipo as string)
      try {
        await enviarCorreo({ para: email, asunto: 'Tu enlace para entrar · Ok Computer Tenerife', texto:
          `Hola${a.nombre ? ' ' + String(a.nombre).split(' ')[0] : ''},\n\nPara entrar en ${a.tipo === 'gestoria' ? 'el área de la gestoría' : 'el área de clientes'} de Ok Computer Tenerife pulsa este enlace (vale ${MIN_ENLACE} minutos y una sola vez):\n\n${url}\n\nSi no lo has pedido tú, no hagas nada: sin el enlace nadie puede entrar.\n\nOk Computer Tenerife` })
        await traza(db, { acceso_id: a.id as string, email }, 'enlace_enviado')
      } catch (e) {
        console.error('[portal] correo', e)
        await traza(db, { acceso_id: a.id as string, email }, 'enlace_error', { error: (e as Error).message.slice(0, 300) })
      }
      return json(respuesta, 200, cors)
    }
    if (accion === 'entrar') {
      const codigo = txt(b.codigo, 100)
      const [e] = codigo.length > 30 ? await db.get(`portal_enlaces?select=id,acceso_id,portal_accesos(email,nombre,activo,tipo)&huella=eq.${await huella(codigo)}&usado_at=is.null&caduca_at=gt.${new Date().toISOString()}`) : []
      // deno-lint-ignore no-explicit-any
      const a = e?.portal_accesos as any
      if (!e || !a?.activo) return json({ error: 'El enlace no vale o ya caducó. Pide otro.' }, 401, cors)
      await db.patch(`portal_enlaces?id=eq.${e.id}`, { usado_at: new Date().toISOString() })
      const token = aleatorio()
      await db.post('portal_sesiones', { acceso_id: e.acceso_id, huella: await huella(token), caduca_at: new Date(Date.now() + DIAS_SESION * 86400000).toISOString() })
      await db.patch(`portal_accesos?id=eq.${e.acceso_id}`, { ultima_entrada_at: new Date().toISOString() })
      await traza(db, { acceso_id: e.acceso_id as string, email: a.email }, 'entrada')
      return json({ token, nombre: a.nombre, tipo: a.tipo ?? 'cliente' }, 200, cors)
    }
    if (accion === 'enlace_admin') {
      const user = await getAuthedUser(req)
      if (!user || !(await isAdminUser(user))) return json({ error: 'Solo un administrador' }, 403, cors)
      if (!esUuid(b.acceso_id)) return json({ error: 'acceso_id no válido' }, 400, cors)
      const [a] = await db.get(`portal_accesos?select=id,email,tipo&id=eq.${b.acceso_id}&activo=eq.true`)
      if (!a) return json({ error: 'Ese acceso no está activo' }, 404, cors)
      const url = await nuevoEnlace(db, a.id as string, a.tipo as string)
      await traza(db, { acceso_id: a.id as string, email: a.email as string }, 'enlace_generado', { por: user.email })
      return json({ url, caduca_min: MIN_ENLACE }, 200, cors)
    }

    const s = await sesion(db, req.headers.get('x-portal-token'))
    if (!s) return json({ error: 'Tu sesión ha caducado: vuelve a pedir el enlace.', sesion: false }, 401, cors)
    if (s.tipo === 'gestoria') {
      if (accion === 'salir') { await db.patch(`portal_sesiones?id=eq.${s.sesion_id}`, { cerrada_at: new Date().toISOString() }); await traza(db, s, 'salir'); return json({ ok: true }, 200, cors) }
      if (accion === 'yo') return json({ nombre: s.nombre, email: s.email, tipo: 'gestoria' }, 200, cors)
      return json(await gestoria(db, s, accion, b), 200, cors)
    }
    if (accion.startsWith('g_')) return json({ error: 'No tienes acceso a esto' }, 403, cors)
    if (accion === 'pdf') {
      const tipo = b.tipo === 'presupuesto' ? 'presupuesto' : 'factura'
      let zid: string | null = null
      if (tipo === 'factura') {
        const cz = await zohoIdDe(db, s.cliente_id)
        const [f] = cz ? await db.get(`zoho_facturas?select=invoice_id,numero&invoice_id=eq.${encodeURIComponent(txt(b.id, 40))}&cliente_zoho_id=eq.${encodeURIComponent(cz)}`) : []
        zid = (f?.invoice_id as string) ?? null
      } else if (esUuid(b.id)) {
        const [p] = await db.get(`presupuestos?select=zoho_estimate_id&id=eq.${b.id}&cliente_id=eq.${s.cliente_id}`)
        zid = (p?.zoho_estimate_id as string) ?? null
      }
      if (!zid) return json({ error: 'No encontramos ese documento' }, 404, cors)
      const pdf = await zohoPdf(db, tipo === 'factura' ? 'invoices' : 'estimates', zid)
      await traza(db, s, `descargar_${tipo}`, { id: zid })
      return new Response(pdf, { status: 200, headers: { ...cors, 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${tipo}-${zid}.pdf"` } })
    }
    return json(await conSesion(db, s, accion, b), 200, cors)
  } catch (e) {
    console.error('[portal]', accion, e)
    return json({ error: (e as Error).message }, 400, cors)
  }
})
