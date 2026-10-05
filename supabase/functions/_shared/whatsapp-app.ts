// deno-lint-ignore-file no-explicit-any
// Lo que hacen con la base las funciones de WhatsApp del hub: `whatsapp-webhook`
// (entrada, preparada y sin conectar), `whatsapp` (la ventana fija) y
// `meta-agente-mcp` (las herramientas del agente de Meta). Portado de
// okcomputerclaude (_shared/whatsapp-app.ts) sobre las tablas del hub (dbHub):
// una sola copia, para que el envío de una factura o la conversación de un
// teléfono no se hagan de dos maneras. Cambios al portar:
//  · el comentario del ticket va al Desk del hub (`tipo = respuesta`, canal
//    whatsapp, ya enviado);
//  · los avisos a los administradores van por Telegram (el hub no tiene push).
import { avisarPush } from './push.ts'
import {
  normalizaTelefono, dentroDeVentana, enviarDocumento, enviarPlantillaDocumento, subirMedia, plantillaDocumento,
  type EnvioWa,
} from './whatsapp.ts'
import { zohoCtx, zohoAccessToken } from './zoho-ctx.ts'
import { enviarTelegram, telegramConfigurado, h } from './mensajeria.ts'

type SupabaseClient = any
const HUB = 'https://okhub-tenerife.web.app'

// Conversación de un teléfono; se crea (y se reconoce al cliente) si no existe.
export async function conversacionDe(db: SupabaseClient, tel: string, nombre = '') {
  const telefono = normalizaTelefono(tel)
  const { data: existente } = await db.from('wa_conversaciones').select('*').eq('telefono', telefono).maybeSingle()
  if (existente) {
    if (nombre && nombre !== existente.nombre) {
      await db.from('wa_conversaciones').update({ nombre }).eq('id', existente.id)
      existente.nombre = nombre
    }
    return existente
  }
  const { data: quien } = await db.rpc('wa_buscar_por_telefono', { tel: telefono })
  const q = Array.isArray(quien) ? quien[0] : null
  const { data: nueva, error } = await db.from('wa_conversaciones')
    .upsert({
      telefono, nombre: nombre || null,
      cliente_id: q?.cliente_id ?? null, local_id: q?.local_id ?? null, contacto_id: q?.contacto_id ?? null,
    }, { onConflict: 'telefono' })
    .select('*').single()
  if (error) throw new Error(`conversación: ${error.message}`)
  return nueva
}

// Apunta un mensaje nuestro en la bandeja (y en el ticket abierto, para quien lo lleve).
export async function guardarSaliente(
  db: SupabaseClient, conv: any, fila: Record<string, unknown>, texto: string, usuario: string,
  opciones: { comentarTicket?: boolean } = {},
) {
  const ahora = new Date().toISOString()
  await db.from('wa_mensajes').insert({ conversacion_id: conv.id, direccion: 'saliente', usuario, created_at: ahora, texto, ...fila })
  await db.from('wa_conversaciones').update({ ultimo_mensaje: texto.slice(0, 200), ultimo_mensaje_at: ahora }).eq('id', conv.id)
  if (opciones.comentarTicket !== false && conv.ticket_id && fila.estado !== 'fallido') {
    await db.from('ticket_comentarios').insert({
      ticket_id: conv.ticket_id, autor_nombre: `${usuario} (WhatsApp)`, texto, tipo: 'respuesta', canal: 'whatsapp', enviado_at: ahora,
    })
  }
}

// Baja el PDF de Zoho Books y lo manda por WhatsApp a la conversación: suelto
// dentro de las 24 h, con la plantilla WHATSAPP_PLANTILLA_DOCUMENTO fuera.
export async function enviarDocumentoZoho(
  db: SupabaseClient, conv: any, tipo: 'factura' | 'presupuesto', zohoId: string, numero: string, usuario: string,
): Promise<EnvioWa> {
  const plantilla = plantillaDocumento()
  const ventana = dentroDeVentana(conv.ultimo_entrante_at)
  if (!ventana && !plantilla) {
    return { ok: false, error: 'El cliente no ha escrito en las últimas 24 h, y para escribirle primero Meta exige una plantilla aprobada. Falta poner WHATSAPP_PLANTILLA_DOCUMENTO en el hub (ver docs/PENDIENTE_FRAN.md).' }
  }
  const ctx = zohoCtx()
  const tokenZoho = await zohoAccessToken(ctx)
  const ruta = tipo === 'factura' ? 'invoices' : 'estimates'
  const pdf = await fetch(
    `https://${ctx.apiDomain}/books/v3/${ruta}/${zohoId}?organization_id=${ctx.ZOHO_ORG_ID}&accept=pdf`,
    { headers: { Authorization: `Zoho-oauthtoken ${tokenZoho}` }, signal: AbortSignal.timeout(30000) },
  )
  if (!pdf.ok || !(pdf.headers.get('content-type') || '').includes('pdf')) {
    console.error('[whatsapp] PDF Zoho', pdf.status, (await pdf.text().catch(() => '')).slice(0, 300))
    return { ok: false, error: `Zoho Books no devolvió el PDF de ${tipo === 'factura' ? 'la factura' : 'el presupuesto'}.` }
  }
  const bytes = new Uint8Array(await pdf.arrayBuffer())
  const etiqueta = tipo === 'factura' ? 'Factura' : 'Presupuesto'
  const nombreFichero = `${etiqueta}_${String(numero || zohoId).replace(/[^\w.-]+/g, '_')}.pdf`

  const subida = await subirMedia(bytes, 'application/pdf', nombreFichero)
  if (!subida.id) return { ok: false, error: subida.error }

  const texto = `${etiqueta} ${numero || ''} de Ok Computer Tenerife`.replace(/\s+/g, ' ').trim()
  const r = ventana
    ? await enviarDocumento(conv.telefono, subida.id, nombreFichero, texto)
    : await enviarPlantillaDocumento(conv.telefono, plantilla, Deno.env.get('WHATSAPP_PLANTILLA_IDIOMA') || 'es',
        subida.id, nombreFichero, [`${etiqueta.toLowerCase()} ${numero || ''}`.trim()])
  await guardarSaliente(db, conv, {
    wa_message_id: r.id ?? null, tipo: ventana ? 'document' : 'template', media_id: subida.id,
    media_mime: 'application/pdf', media_nombre: nombreFichero,
    estado: r.ok ? 'enviado' : 'fallido', error: r.error ?? null,
  }, `📎 ${texto}`, usuario)
  return r
}

// Aviso a los administradores por Telegram (el push de la app, en el hub): a
// los que tengan su Telegram vinculado (Informes → Vincular mi Telegram).
export async function avisarAdmins(db: SupabaseClient, titulo: string, cuerpo: string, tag: string) {
  try {
    const { data: admins } = await db.from('usuarios').select('id').eq('rol', 'admin').neq('activo', false)
    if (!admins?.length) return
    // En el móvil (push, como la app) y por Telegram.
    await avisarPush(admins.map((a: any) => a.id), { title: titulo, body: cuerpo, tag, url: '/#/inicio' })
    if (!telegramConfigurado()) return
    const { data: vs } = await db.from('telegram_vinculos').select('chat_id')
      .eq('activo', true).not('chat_id', 'is', null).in('usuario_id', admins.map((a: any) => a.id))
    const texto = `<b>${h(titulo)}</b>\n${h(cuerpo.slice(0, 300))}\n\n<a href="${HUB}">Abrir el hub</a> (el WhatsApp, abajo a la derecha)`
    for (const v of vs ?? []) await enviarTelegram(v.chat_id, texto).catch(() => {})
  } catch (e) {
    console.warn('[whatsapp] aviso', e)
  }
}

// ── Código de verificación del local ────────────────────────────────────────
// Antes de dar datos sensibles (facturas, presupuestos, contrato, cobros) el
// teléfono tiene que ser de dueño o administración de una sede del cliente
// (local_telefonos.rol) Y haber dado el código de 6 cifras de esa sede en las
// últimas 24 h. Así un número que se ha colado en la ficha equivocada, o un
// empleado, no se lleva los papeles de otra empresa.
const VERIFICACION_HORAS = 24
const MAX_FALLOS = 5

export type Autorizacion = { ok: true } | { ok: false; motivo: 'sin_cliente' | 'rol' | 'codigo' | 'bloqueado'; mensaje: string }

async function localesAutorizados(db: SupabaseClient, conv: any): Promise<{ local_id: string; codigo_verificacion: string }[]> {
  if (!conv.cliente_id) return []
  const { data } = await db.rpc('wa_locales_autorizados', { tel: conv.telefono, cliente: conv.cliente_id })
  return (data ?? []) as { local_id: string; codigo_verificacion: string }[]
}

export async function autorizadoDatosSensibles(db: SupabaseClient, conv: any): Promise<Autorizacion> {
  if (!conv.cliente_id) return { ok: false, motivo: 'sin_cliente', mensaje: 'Este número no está en nuestras fichas. Que lo solicite a la oficina en info@okcomputertenerife.com.' }
  const locs = await localesAutorizados(db, conv)
  if (!locs.length) return { ok: false, motivo: 'rol', mensaje: 'Por seguridad, la documentación solo se envía a los teléfonos del dueño o de administración del negocio. Que lo pida la persona responsable o la oficina en info@okcomputertenerife.com.' }
  const vigente = conv.verificado_at && (Date.now() - new Date(conv.verificado_at).getTime()) < VERIFICACION_HORAS * 3600_000
  if (vigente && locs.some(l => l.local_id === conv.verificado_local_id)) return { ok: true }
  if (conv.codigo_bloqueado_hasta && new Date(conv.codigo_bloqueado_hasta).getTime() > Date.now()) {
    return { ok: false, motivo: 'bloqueado', mensaje: 'Demasiados códigos incorrectos. Por seguridad hay que esperar una hora o pedirlo a la oficina.' }
  }
  return { ok: false, motivo: 'codigo', mensaje: 'Antes de enviar documentación hay que pedir al cliente el código de verificación de 6 cifras de su local (viene en su contrato de mantenimiento) y comprobarlo con verificar_codigo.' }
}

export async function verificarCodigo(db: SupabaseClient, conv: any, codigo: string): Promise<{ ok: boolean; mensaje: string }> {
  if (conv.codigo_bloqueado_hasta && new Date(conv.codigo_bloqueado_hasta).getTime() > Date.now()) {
    return { ok: false, mensaje: 'Demasiados códigos incorrectos. Por seguridad hay que esperar una hora o pedirlo a la oficina.' }
  }
  const locs = await localesAutorizados(db, conv)
  if (!locs.length) {
    return { ok: false, mensaje: 'Este teléfono no está autorizado (dueño o administración) en ningún local del cliente. Que lo pida la persona responsable o la oficina.' }
  }
  const limpio = String(codigo || '').replace(/\D/g, '')
  const local = limpio.length === 6 ? locs.find(l => l.codigo_verificacion === limpio) : undefined
  if (local) {
    const cambios = { verificado_local_id: local.local_id, verificado_at: new Date().toISOString(), codigo_fallos: 0, codigo_bloqueado_hasta: null }
    await db.from('wa_conversaciones').update(cambios).eq('id', conv.id)
    Object.assign(conv, cambios)
    return { ok: true, mensaje: 'Código correcto. Ya se puede enviar la documentación.' }
  }
  const fallos = (conv.codigo_fallos ?? 0) + 1
  const bloquear = fallos >= MAX_FALLOS
  const cambios = bloquear
    ? { codigo_fallos: 0, codigo_bloqueado_hasta: new Date(Date.now() + 3600_000).toISOString() }
    : { codigo_fallos: fallos }
  await db.from('wa_conversaciones').update(cambios).eq('id', conv.id)
  Object.assign(conv, cambios)
  if (bloquear) {
    await avisarAdmins(db, '🔒 WhatsApp: código bloqueado', `+${conv.telefono} ha fallado ${MAX_FALLOS} veces el código de verificación.`, `wa-cod-${conv.id}`)
    return { ok: false, mensaje: 'Código incorrecto. Se ha bloqueado una hora por seguridad.' }
  }
  return { ok: false, mensaje: `Código incorrecto. Le quedan ${MAX_FALLOS - fallos} intentos.` }
}
