// deno-lint-ignore-file no-explicit-any
// whatsapp-webhook — la entrada de la WhatsApp Business Cloud API (Meta).
//
// EN EL HUB: PREPARADO Y SIN CONECTAR (paridad bloque 5, decisión de Fran,
// 2026-10-04). Portado de okcomputerclaude (supabase/functions/whatsapp-webhook)
// sobre las tablas del hub (dbHub). Mientras el área `whatsapp` sea de la app,
// Meta llama al webhook de la app y este no hace nada aunque le llegue algo
// (contesta 200 y lo deja: lo guarda la app). El día del cambio se le da a
// Meta esta URL (docs/PENDIENTE_FRAN.md §1 quinquies). Cambios al portar:
//  · tickets y comentarios, al Desk del hub (canal whatsapp; lo del cliente,
//    `tipo = cliente`);
//  · los avisos, por Telegram a los admins (avisarAdmins de whatsapp-app.ts);
//  · las órdenes del equipo (equipo.ts) que tocan áreas aún de la app lo dicen
//    y no escriben (el fichaje va por hub.reloj_fichar → la MISMA hub.fichar).
//
// Meta llama aquí por cada mensaje que escribe un cliente al número de la
// empresa y por cada cambio de estado de lo que mandamos (entregado, leído,
// fallido). Va SIN JWT (lista SIN_JWT de deploy-supabase.yml): la autoriza la
// firma X-Hub-Signature-256 con el secret WHATSAPP_APP_SECRET.
//
//  GET  ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…  → alta del webhook
//  POST { object: 'whatsapp_business_account', entry: [...] }   → eventos
//
// Qué hace con un mensaje entrante:
//  1. Lo guarda en wa_mensajes (idempotente por el id de Meta: Meta reintenta).
//  2. Reconoce al cliente por el teléfono (wa_buscar_por_telefono).
//  3. Si la conversación tiene un ticket ABIERTO, lo suma como comentario.
//     Si no, contesta con el MENÚ de botones (Soporte · Facturación · Ventas).
//     Soporte pregunta el local, mira su plan y si estamos en su horario
//     contratado (festivos fuera) y, si no lo está, ofrece atención con cargo;
//     luego abre ticket con el nº. Facturación → ticket; Ventas → oportunidad.
//     Con WHATSAPP_MENU=0, lo de antes: la IA decide si es aviso y abre ticket.
//  4. Avisa por push a los administradores.
//
// Se contesta 200 a Meta EN SEGUIDA y el trabajo va detrás (EdgeRuntime.waitUntil):
// si tarda, Meta reintenta y el cliente recibiría dos autorrespuestas.

import { dbHub, tablaDelHub } from "../_shared/sb-hub.ts"
import {
  firmaValida, motivoFirma, normalizaTelefono, textoDeMensaje, mediaDeMensaje, enviarTexto,
  enviarBotones, enviarLista, respuestaInteractiva, descargarMedia, waConfigurado,
} from "../_shared/whatsapp.ts"
import { coberturaDeLocal } from "../_shared/soporte-horario.ts"
import { clasificarMensajes } from "../_shared/whatsapp-clasificar.ts"
import { groqTranscribir } from "../_shared/groq.ts"
import { conversacionDe, avisarAdmins as avisar } from "../_shared/whatsapp-app.ts"
import { usuarioDeTelefono, atenderEquipo } from "./equipo.ts"
import { guardarMediaCliente, adjuntarAlTicket } from "../_shared/whatsapp-adjuntos.ts"

// Con el agente de Meta (Meta Business Agent) de primer respondedor, el que
// contesta y abre tickets es él (herramientas de `meta-agente-mcp`); aquí solo
// se guarda la conversación para la bandeja. Ver docs/META_BUSINESS_AGENT.md.
const modoMetaAgente = () => Deno.env.get('WHATSAPP_MODO') === 'meta_agente'
const avisarAdmins = (_db: SupabaseClient, titulo: string, cuerpo: string, convId: string) =>
  avisar(_db, titulo, cuerpo, `wa-${convId}`)

// Un cliente escribe «Hola» · «el datáfono no va» · «es urgente» en tres
// mensajes y en tres segundos: son tres llamadas al webhook en paralelo. Cada
// una espera un poco y solo sigue la del ÚLTIMO mensaje, que se lleva los tres
// al mismo ticket.
const ESPERA_AGRUPAR_MS = 8000
// Mensajes sueltos sin ticket que se juntan para clasificar.
const VENTANA_AGRUPAR_H = 6

type SupabaseClient = any
const sb = (): SupabaseClient => dbHub('whatsapp-webhook')

Deno.serve(async (req) => {
  const url = new URL(req.url)

  if (req.method === 'GET') {
    const modo = url.searchParams.get('hub.mode')
    const tok = url.searchParams.get('hub.verify_token')
    const reto = url.searchParams.get('hub.challenge') ?? ''
    const esperado = Deno.env.get('WHATSAPP_VERIFY_TOKEN') ?? ''
    if (modo === 'subscribe' && esperado && tok === esperado) return new Response(reto, { status: 200 })
    console.warn('[whatsapp-webhook] verificación rechazada', modo)
    return new Response('forbidden', { status: 403 })
  }
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })

  const crudo = await req.text()
  if (!(await firmaValida(crudo, req.headers.get('X-Hub-Signature-256')))) {
    console.warn(`[whatsapp-webhook] firma no válida: ${motivoFirma(req.headers.get('X-Hub-Signature-256'))}`)
    return new Response('bad signature', { status: 401 })
  }
  let cuerpo: any
  try { cuerpo = JSON.parse(crudo) } catch { return new Response('ok', { status: 200 }) }

  const tarea = procesar(cuerpo).catch(e => console.error('[whatsapp-webhook]', e))
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime
  if (rt?.waitUntil) rt.waitUntil(tarea)
  else await tarea
  return new Response('ok', { status: 200 })
})

async function procesar(cuerpo: any) {
  const db = sb()
  // Sin el cambio de WhatsApp, quien guarda y contesta es la app: aquí, nada.
  if (!(await tablaDelHub(db, 'wa_mensajes'))) {
    console.warn('[whatsapp-webhook] el área whatsapp sigue en la app: no se procesa (¿Meta apunta aquí antes del cambio?)')
    return
  }
  for (const entry of cuerpo?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const v = change?.value ?? {}
      const campo = change?.field
      if (campo === 'messages' || campo === 'standby') {
        // Con el agente de Meta al mando, lo del cliente llega por `standby` (la
        // app es «participante en espera») junto con copias de lo que responde
        // el agente; por `messages` llega cuando la conversación la lleva la app.
        // Las dos cosas van a la bandeja; el push solo cuando la lleva la app.
        const conAgente = campo === 'standby'
        const propio = normalizaTelefono(v.metadata?.display_phone_number ?? '')
        const nombres = new Map<string, string>()
        for (const c of v.contacts ?? []) nombres.set(c.wa_id, c.profile?.name ?? '')
        for (const s of v.statuses ?? []) await actualizarEstado(db, s)
        for (const m of v.messages ?? []) {
          if (propio && normalizaTelefono(m.from ?? '') === propio) await registrarEco(db, m, 'Agente de Meta')
          else await procesarEntrante(db, m, nombres.get(m.from) ?? '', conAgente)
        }
        for (const m of v.message_echoes ?? []) await registrarEco(db, m, conAgente ? 'Agente de Meta' : 'Móvil de la empresa')
      } else if (campo === 'message_echoes') {
        for (const m of v.message_echoes ?? []) await registrarEco(db, m, 'Agente de Meta')
      } else if (campo === 'smb_message_echoes') {
        // Coexistencia: lo que se escribe desde la app WhatsApp Business del
        // móvil de la empresa también llega aquí, para que la bandeja lo tenga.
        for (const m of v.message_echoes ?? []) await registrarEco(db, m, 'Móvil de la empresa')
      } else if (campo === 'messaging_handovers') {
        await traspaso(db, v)
      }
    }
  }
}

async function actualizarEstado(db: SupabaseClient, s: any) {
  const mapa: Record<string, string> = { sent: 'enviado', delivered: 'entregado', read: 'leido', failed: 'fallido' }
  const estado = mapa[s?.status]
  if (!estado || !s?.id) return
  const cambios: Record<string, unknown> = { estado }
  if (estado === 'fallido') {
    const e = s.errors?.[0]
    cambios.error = e?.error_data?.details || e?.title || e?.message || 'Meta no pudo entregar el mensaje'
  }
  // Un «entregado» que llega después del «leído» no lo puede pisar.
  let q = db.from('wa_mensajes').update(cambios).eq('wa_message_id', s.id)
  if (estado === 'entregado') q = q.neq('estado', 'leido')
  if (estado === 'enviado') q = q.not('estado', 'in', '(entregado,leido)')
  const { error } = await q
  if (error) console.error('[whatsapp-webhook] estado', error.message)
}

async function transcribirAudio(mediaId: string): Promise<string> {
  const apiKey = Deno.env.get('GROQ_API_KEY')
  if (!apiKey) return ''
  const f = await descargarMedia(mediaId)
  if (!f.bytes) { console.warn('[whatsapp-webhook] audio', f.error); return '' }
  const r = await groqTranscribir(apiKey, (modelo) => {
    const fd = new FormData()
    fd.append('file', new Blob([f.bytes as BlobPart], { type: f.mime || 'audio/ogg' }), 'audio.ogg')
    fd.append('model', modelo)
    fd.append('language', 'es')
    fd.append('response_format', 'json')
    fd.append('temperature', '0')
    return fd
  }, 'whatsapp-webhook/audio')
  if (!r.ok) console.warn('[whatsapp-webhook] transcripción', r.status, r.detalle ?? '')
  return r.ok ? (r.contenido ?? '') : ''
}

async function procesarEntrante(db: SupabaseClient, m: any, nombrePerfil: string, conAgente = false) {
  if (!m?.id || !m?.from) return
  const telefono = normalizaTelefono(m.from)
  const conv = await conversacionDe(db, telefono, nombrePerfil)
  const media = mediaDeMensaje(m)

  let texto = textoDeMensaje(m)
  if ((m.type === 'audio' || m.type === 'voice') && media.id) {
    const t = await transcribirAudio(media.id)
    texto = t ? `🎤 ${t}` : '🎤 Nota de voz'
  } else if (!texto) {
    texto = { image: '📷 Foto', video: '🎬 Vídeo', sticker: '🙂 Sticker', document: '📎 Documento' }[m.type as string]
      ?? `(${m.type})`
  }

  const cuando = m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString()
  const { data: insertado, error } = await db.from('wa_mensajes')
    .upsert({
      conversacion_id: conv.id, wa_message_id: m.id, direccion: 'entrante', tipo: m.type,
      texto, media_id: media.id ?? null, media_mime: media.mime ?? null, media_nombre: media.nombre ?? null,
      estado: 'recibido', created_at: cuando,
    }, { onConflict: 'wa_message_id', ignoreDuplicates: true })
    .select('id')
  if (error) throw new Error(`mensaje: ${error.message}`)
  if (!insertado?.length) return // reintento de Meta: ya estaba

  const mensajeId = insertado[0].id
  await db.from('wa_conversaciones').update({
    ultimo_mensaje: texto.slice(0, 200), ultimo_mensaje_at: cuando, ultimo_entrante_at: cuando,
    sin_leer: (conv.sin_leer ?? 0) + 1,
  }).eq('id', conv.id)

  const nombre = conv.nombre || nombrePerfil || `+${telefono}`

  // ¿Escribe alguien del equipo (usuarios.telefono)? Va por su propio camino:
  // la IA entiende la orden y la app apunta o crea (./equipo.ts), sin menú de clientes.
  if (!modoMetaAgente() && !conAgente && waConfigurado()) {
    const usuario = await usuarioDeTelefono(db, telefono)
    if (usuario) {
      const ctx: Ctx = { db, conv, telefono, nombre, datos: {} }
      await atenderEquipo(db, conv, usuario,
        { texto, boton: respuestaInteractiva(m), tipo: m.type, mediaId: media.id ?? null, mime: media.mime ?? null },
        (t, extra) => decir(ctx, t, extra ?? {}))
      return
    }
  }

  // Foto, vídeo o documento del cliente: copia en Storage (Meta lo borra a las
  // pocas semanas) y, si es foto, la IA cuenta lo que se ve, que pasa al texto
  // del mensaje y de ahí al ticket (_shared/whatsapp-adjuntos.ts).
  const guardada = await guardarMediaCliente(db, conv.id, mensajeId, {
    tipo: m.type, mediaId: media.id, mime: media.mime, nombre: media.nombre, pie: textoDeMensaje(m),
  })
  if (guardada?.descripcion) {
    texto = `${texto}\n(En la foto se ve: ${guardada.descripcion})`
    await db.from('wa_mensajes').update({ texto }).eq('id', mensajeId)
  }
  const autorWa = `WhatsApp · ${nombre}`

  // ¿Hay un ticket abierto de esta conversación? El mensaje va a él.
  const abierto = await ticketAbierto(db, conv.ticket_id)
  if (abierto) {
    await db.from('ticket_comentarios').insert({
      ticket_id: abierto.id, autor_nombre: autorWa, texto, tipo: 'cliente', canal: 'whatsapp',
    })
    await db.from('wa_mensajes').update({ ticket_id: abierto.id }).eq('id', mensajeId)
    await adjuntarAlTicket(db, abierto.id, [mensajeId], autorWa)
    if (!conAgente) await avisarAdmins(db, `💬 ${nombre} (ticket #${abierto.numero})`, texto, conv.id)
    return
  }

  if (modoMetaAgente() || conAgente) {
    // Contesta el agente de Meta: aquí solo se guarda. Avisar de cada mensaje
    // que el agente ya está atendiendo sería ruido; se avisa al traspasar.
    if (!conAgente) await avisarAdmins(db, `💬 WhatsApp de ${nombre}`, texto, conv.id)
    return
  }


  // Un botón pulsado no hace esperar: es una respuesta, no un mensaje a medias.
  const boton = respuestaInteractiva(m)
  if (!boton) {
    // Sin ticket: esperar por si vienen más mensajes seguidos.
    await new Promise(r => setTimeout(r, ESPERA_AGRUPAR_MS))
    const { data: posterior } = await db.from('wa_mensajes').select('id')
      .eq('conversacion_id', conv.id).eq('direccion', 'entrante').gt('created_at', cuando).limit(1)
    if (posterior?.length) return // lo recoge el último
  }
  const { data: convAhora } = await db.from('wa_conversaciones').select('*').eq('id', conv.id).single()
  const recienAbierto = await ticketAbierto(db, convAhora?.ticket_id)
  if (recienAbierto) {
    await db.from('ticket_comentarios').insert({ ticket_id: recienAbierto.id, autor_nombre: `WhatsApp · ${nombre}`, texto, tipo: 'cliente', canal: 'whatsapp' })
    await db.from('wa_mensajes').update({ ticket_id: recienAbierto.id }).eq('id', mensajeId)
    await adjuntarAlTicket(db, recienAbierto.id, [mensajeId], autorWa)
    return
  }

  // Sin respuestas automáticas (o con el menú apagado): ticket directo, como antes.
  if (!menuActivo()) return await ticketDirecto(db, convAhora ?? conv, telefono, nombre, mensajeId, texto)

  // Si una persona está contestando desde la bandeja, el menú no se mete.
  if (await atiendePersona(db, conv.id)) {
    await avisarAdmins(db, `💬 WhatsApp de ${nombre}`, texto, conv.id)
    return
  }
  await menu(db, convAhora ?? conv, telefono, nombre, { boton, texto, cuando })
}

// ─── Menú de entrada: Soporte · Facturación · Ventas ────────────────────────
// Máquina de estados por conversación (wa_conversaciones.bot_estado/bot_datos).
// Soporte pregunta el local, mira su plan y horario contratado
// (_shared/soporte-horario.ts) y, fuera de horario o sin mantenimiento, ofrece
// la atención con cargo antes de abrir el ticket. Facturación abre ticket;
// Ventas, oportunidad. Ver docs/WHATSAPP_CLOUD.md («Menú de entrada»).

const menuActivo = () =>
  Deno.env.get('WHATSAPP_AUTORESPUESTA') !== '0' && Deno.env.get('WHATSAPP_MENU') !== '0' && waConfigurado()

// Un paso a medias se abandona pasado este tiempo; «derivado» (lo lleva una
// persona) aguanta más para no volver a sacar el menú en la misma consulta.
const CADUCA_PASO_H = 2
const CADUCA_DERIVADO_H = 12

const OPCIONES_MENU = [
  { id: 'soporte', titulo: 'Soporte técnico' },
  { id: 'facturacion', titulo: 'Facturación' },
  { id: 'ventas', titulo: 'Ventas' },
]

interface Entrada { boton: string | null; texto: string; cuando: string }

async function menu(db: SupabaseClient, conv: any, telefono: string, nombre: string, e: Entrada) {
  let estado: string | null = conv.bot_estado ?? null
  const datos: Record<string, any> = conv.bot_datos ?? {}
  if (estado && conv.bot_estado_at) {
    const h = (Date.now() - new Date(conv.bot_estado_at).getTime()) / 3600_000
    if (h > (estado === 'derivado' ? CADUCA_DERIVADO_H : CADUCA_PASO_H)) estado = null
  }
  const ctx: Ctx = { db, conv, telefono, nombre, datos }

  switch (estado) {
    case 'menu': {
      const eleccion = (e.boton && OPCIONES_MENU.some(o => o.id === e.boton)) ? e.boton : eleccionPorTexto(e.texto)
      if (eleccion) return await empezar(ctx, eleccion)
      if ((datos.reintentos ?? 0) >= 1) return await derivar(ctx, 'No ha elegido ninguna opción del menú.')
      datos.reintentos = (datos.reintentos ?? 0) + 1
      return await mostrarMenu(ctx, 'Perdona, no te he entendido. Elige una opción, por favor:')
    }
    case 'soporte_local': return await elegirLocal(ctx, e)
    case 'soporte_cargo': return await decidirCargo(ctx, e)
    case 'soporte_detalle': return await ticketSoporte(ctx)
    case 'facturacion_detalle': return await ticketFacturacion(ctx)
    case 'ventas_detalle': return await oportunidadVentas(ctx)
    case 'derivado':
      await avisarAdmins(db, `💬 WhatsApp de ${nombre}`, e.texto, conv.id)
      return
    default: {
      // Un botón del menú pulsado tarde (el paso ya había caducado) vale igual.
      if (e.boton && OPCIONES_MENU.some(o => o.id === e.boton)) {
        ctx.datos = { desde: new Date(Date.now() - VENTANA_AGRUPAR_H * 3600_000).toISOString() }
        return await empezar(ctx, e.boton)
      }
      // Conversación nueva: los mensajes sueltos de las últimas horas son la consulta.
      const desde = new Date(Date.now() - VENTANA_AGRUPAR_H * 3600_000).toISOString()
      const { data: primero } = await db.from('wa_mensajes').select('created_at')
        .eq('conversacion_id', conv.id).eq('direccion', 'entrante').is('ticket_id', null)
        .gte('created_at', desde).order('created_at').limit(1)
      ctx.datos = { desde: primero?.[0]?.created_at ?? e.cuando }
      const saludo = conv.nombre ? `¡Hola ${conv.nombre.split(' ')[0]}!` : '¡Hola!'
      await mostrarMenu(ctx, `${saludo} Gracias por escribir a Ok Computer Tenerife. ¿En qué podemos ayudarte?`)
      await avisarAdmins(db, `💬 WhatsApp de ${nombre}`, e.texto, conv.id)
    }
  }
}

interface Ctx { db: SupabaseClient; conv: any; telefono: string; nombre: string; datos: Record<string, any> }

async function paso(c: Ctx, estado: string | null) {
  await c.db.from('wa_conversaciones').update({
    bot_estado: estado, bot_datos: estado ? c.datos : {}, bot_estado_at: new Date().toISOString(),
  }).eq('id', c.conv.id)
}

async function mostrarMenu(c: Ctx, texto: string) {
  await decir(c, texto, { botones: OPCIONES_MENU })
  await paso(c, 'menu')
}

function sinAcentos(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function eleccionPorTexto(texto: string): string | null {
  const t = sinAcentos(texto).trim()
  if (/^1\b|soporte|averia|no funciona|no va|problema|error|incidencia|tecnic/.test(t)) return 'soporte'
  if (/^2\b|factura|pago|cobro|recibo|domicilia|cuota|abono/.test(t)) return 'facturacion'
  if (/^3\b|venta|comprar|compra|presupuesto|precio|oferta|informacion|contratar/.test(t)) return 'ventas'
  return null
}

// Lo que el cliente ha escrito desde que empezó el menú (sin los botones).
async function mensajesConsulta(c: Ctx) {
  const desde = c.datos.desde ?? new Date(Date.now() - VENTANA_AGRUPAR_H * 3600_000).toISOString()
  const { data } = await c.db.from('wa_mensajes').select('id, texto, tipo')
    .eq('conversacion_id', c.conv.id).eq('direccion', 'entrante').is('ticket_id', null)
    .gte('created_at', desde).order('created_at')
  const todos = (data ?? []) as { id: string; texto: string | null; tipo: string }[]
  const utiles = todos.filter(x => x.tipo !== 'interactive' && x.tipo !== 'button')
  // El nombre del local escrito a mano tampoco es la consulta.
  const sinLocal = utiles.filter(x => !(c.datos.textoLocal && x.texto === c.datos.textoLocal))
  return { ids: todos.map(x => x.id), texto: sinLocal.map(x => x.texto).filter(Boolean).join('\n') }
}

// ¿Ha contado ya qué le pasa, o solo ha saludado?
function hayDetalle(texto: string): boolean {
  const limpio = sinAcentos(texto)
    .replace(/\b(hola|buenas|buenos dias|buenas tardes|buenas noches|saludos|gracias|por favor|soporte|facturacion|ventas)\b/g, '')
    .replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim()
  return limpio.length >= 20
}

async function empezar(c: Ctx, eleccion: string) {
  c.datos.opcion = eleccion
  c.datos.reintentos = 0
  const { texto } = await mensajesConsulta(c)
  if (eleccion === 'soporte') return await preguntarLocal(c)
  if (eleccion === 'facturacion') {
    if (hayDetalle(texto)) return await ticketFacturacion(c)
    await decir(c, 'De acuerdo. Cuéntanos en un mensaje qué necesitas sobre facturación (una factura, un pago, la domiciliación…).')
    return await paso(c, 'facturacion_detalle')
  }
  if (hayDetalle(texto)) return await oportunidadVentas(c)
  await decir(c, '¡Genial! Cuéntanos qué necesitas (equipo, TPV, software, presupuesto…) y el equipo comercial te contesta.')
  await paso(c, 'ventas_detalle')
}

// ── Soporte ────────────────────────────────────────────────────────────────

interface LocalBot { id: string; nombre: string; cliente_id: string | null; plan: string | null; estado_pago: string | null }

async function preguntarLocal(c: Ctx) {
  let propios: LocalBot[] = []
  if (c.conv.cliente_id) {
    const { data } = await c.db.from('locales').select('id, nombre, cliente_id, plan, estado_pago')
      .eq('cliente_id', c.conv.cliente_id).eq('activo', true).order('nombre').limit(11)
    propios = (data ?? []) as LocalBot[]
  }
  if (propios.length && propios.length <= 9) {
    await decir(c, '¿Para qué local es? Elígelo de la lista (o «Otro local» si no aparece).', {
      lista: {
        boton: 'Elegir local',
        filas: [...propios.map(l => ({ id: `local:${l.id}`, titulo: l.nombre })), { id: 'local:otro', titulo: 'Otro local' }],
      },
    })
  } else {
    await decir(c, '¿Cómo se llama el local? Así comprobamos el mantenimiento que tiene contratado.')
  }
  await paso(c, 'soporte_local')
}

async function elegirLocal(c: Ctx, e: Entrada) {
  const campos = 'id, nombre, cliente_id, plan, estado_pago'
  let local: LocalBot | null = null
  if (e.boton?.startsWith('local:')) {
    const id = e.boton.slice(6)
    if (id === 'otro') {
      await decir(c, 'Vale. Escríbeme el nombre del local, por favor.')
      return await paso(c, 'soporte_local')
    }
    const { data } = await c.db.from('locales').select(campos).eq('id', id).maybeSingle()
    local = data as LocalBot | null
  } else {
    c.datos.textoLocal = e.texto
    const candidatos = await buscarLocales(c.db, e.texto, c.conv.cliente_id)
    if (candidatos.length === 1) local = candidatos[0]
    else if (candidatos.length > 1) {
      await decir(c, 'He encontrado varios locales parecidos. ¿Cuál es el tuyo?', {
        lista: {
          boton: 'Elegir local',
          filas: [...candidatos.slice(0, 9).map(l => ({ id: `local:${l.id}`, titulo: l.nombre })), { id: 'local:otro', titulo: 'Ninguno de estos' }],
        },
      })
      return await paso(c, 'soporte_local')
    }
  }

  if (!local) {
    if ((c.datos.reintentos ?? 0) < 1) {
      c.datos.reintentos = (c.datos.reintentos ?? 0) + 1
      await decir(c, 'No encuentro ningún local con ese nombre. ¿Puedes escribirlo como aparece en el rótulo o en la factura?')
      return await paso(c, 'soporte_local')
    }
    // Segundo intento fallido: se abre el aviso igual y una persona mira el contrato.
    c.datos.localSinIdentificar = e.texto
    return await ticketSoporte(c)
  }

  const cob = await coberturaDeLocal(c.db, local.plan)
  c.datos.local = local
  c.datos.cobertura = cob
  c.datos.reintentos = 0
  const { texto } = await mensajesConsulta(c)

  if (cob.dentroHorario) {
    if (hayDetalle(texto)) return await ticketSoporte(c)
    await decir(c, `Perfecto, ${local.nombre} tiene soporte incluido ahora mismo. Cuéntanos qué ocurre (qué equipo y qué pasa) y abrimos el aviso. Si puedes, mándanos también una foto o un vídeo corto del problema.`)
    return await paso(c, 'soporte_detalle')
  }

  // El nombre del plan no se dice: es dato del contrato, y el menú no pide el
  // código de verificación (eso es cosa de los documentos, meta-agente-mcp).
  // Se dice solo lo que cubre, que es lo que el cliente necesita para decidir.
  let msg: string
  if (!cob.conMantenimiento) {
    msg = `${local.nombre} no tiene contrato de mantenimiento, así que la asistencia se factura aparte según tarifa. ¿Quieres que te atendamos?`
    await decir(c, msg, { botones: [{ id: 'cargo_si', titulo: 'Sí, con cargo' }, { id: 'cargo_no', titulo: 'No, gracias' }] })
  } else {
    const motivo = cob.festivo ? `Hoy es festivo (${cob.festivo})` : 'Ahora mismo estamos fuera de ese horario'
    msg = `El mantenimiento de ${local.nombre} cubre soporte ${cob.horarioTexto}. ` +
      `${motivo}. Podemos atenderte ahora como servicio fuera de contrato, con cargo aparte, o dejar el aviso para el siguiente día dentro de tu horario.`
    await decir(c, msg, { botones: [{ id: 'cargo_si', titulo: 'Atender con cargo' }, { id: 'cargo_no', titulo: 'Esperar a horario' }] })
  }
  await paso(c, 'soporte_cargo')
}

async function decidirCargo(c: Ctx, e: Entrada) {
  const t = sinAcentos(e.texto).trim()
  const si = e.boton === 'cargo_si' || (!e.boton && /^(si\b|vale|ok\b|de acuerdo|adelante|claro|atender)/.test(t))
  const no = e.boton === 'cargo_no' || (!e.boton && /^(no\b|esperar|mejor no)/.test(t))
  if (!si && !no) {
    if ((c.datos.reintentos ?? 0) >= 1) return await derivar(c, 'No ha contestado si acepta la atención con cargo.')
    c.datos.reintentos = (c.datos.reintentos ?? 0) + 1
    await decir(c, 'Perdona, ¿quieres que te atendamos con cargo? Pulsa uno de los botones.', {
      botones: [{ id: 'cargo_si', titulo: 'Sí, con cargo' }, { id: 'cargo_no', titulo: 'No' }],
    })
    return await paso(c, 'soporte_cargo')
  }
  c.datos.cargo = si
  if (no && !c.datos.cobertura?.conMantenimiento) {
    await decir(c, 'De acuerdo. Si nos necesitas, escríbenos cuando quieras.')
    await avisarAdmins(c.db, `💬 WhatsApp de ${c.nombre}`, `${c.datos.local?.nombre ?? ''}: sin mantenimiento, no acepta la asistencia con cargo.`, c.conv.id)
    return await paso(c, null)
  }
  const { texto } = await mensajesConsulta(c)
  if (hayDetalle(texto)) return await ticketSoporte(c)
  await decir(c, 'Entendido. Cuéntanos qué ocurre (qué equipo y qué pasa) y abrimos el aviso. Si puedes, mándanos también una foto o un vídeo corto del problema.')
  await paso(c, 'soporte_detalle')
}

async function ticketSoporte(c: Ctx) {
  const { ids, texto } = await mensajesConsulta(c)
  const local: LocalBot | undefined = c.datos.local
  const cob = c.datos.cobertura
  const apiKey = Deno.env.get('GROQ_API_KEY') ?? ''
  const contexto = local ? `El aviso es del local "${local.nombre}".` : ''
  const ia = apiKey && texto ? await clasificarMensajes(apiKey, texto, contexto) : null

  let cobertura: string
  let prioridad = ia?.prioridad || 'Media'
  if (!local) cobertura = `⚠ Local sin identificar (escribió «${c.datos.localSinIdentificar ?? ''}»): comprobar el contrato.`
  else if (!cob?.conMantenimiento) cobertura = `Sin contrato de mantenimiento: el cliente ACEPTA la asistencia con cargo.`
  else if (cob.dentroHorario) cobertura = `Plan ${cob.plan}: dentro del horario contratado.`
  else if (c.datos.cargo) {
    cobertura = `Plan ${cob.plan}: FUERA de horario${cob.festivo ? ` (festivo: ${cob.festivo})` : ''}. El cliente ACEPTA la atención con cargo.`
    prioridad = 'Alta'
  } else cobertura = `Plan ${cob.plan}: fuera de horario${cob.festivo ? ` (festivo: ${cob.festivo})` : ''}. Prefiere esperar al siguiente día dentro de su horario (${cob.horarioTexto}).`
  if (local?.estado_pago && local.estado_pago !== 'Al corriente') cobertura += `\nEstado de pago del local: ${local.estado_pago}.`

  const descripcion = `${ia?.descripcion || texto || '(sin descripción)'}\n\n${cobertura}\n\n— WhatsApp de ${c.nombre} (+${c.telefono}):\n${texto}`
  const ticket = await crearTicket(c, {
    titulo: ia?.titulo || `Soporte por WhatsApp${local ? ` · ${local.nombre}` : ''}`,
    descripcion, prioridad,
    cliente_id: local?.cliente_id ?? c.conv.cliente_id, local_id: local?.id ?? c.conv.local_id,
  }, ids)

  let msg = `Hemos registrado tu aviso con el nº ${ticket.numero}: «${ticket.titulo}».`
  if (!local) msg += ' Un compañero comprobará tu contrato y te contactará lo antes posible.'
  else if (cob?.dentroHorario) msg += ' Un técnico se pondrá en contacto contigo lo antes posible.'
  else if (c.datos.cargo) msg += ' Lo atendemos como servicio con cargo: un técnico te contactará en cuanto pueda.'
  else msg += ` Lo atenderemos en tu horario de soporte (${cob.horarioTexto}).`
  await decir(c, `${msg} Si quieres añadir algo (también fotos o vídeos), contesta a este mensaje.`, {}, ticket.id)

  const urgente = !!c.datos.cargo && cob?.conMantenimiento && !cob?.dentroHorario
  await avisarAdmins(c.db, `${urgente ? '🚨' : '🎫'} Ticket #${ticket.numero} por WhatsApp`,
    `${c.nombre}: ${ticket.titulo}${urgente ? ' · fuera de horario, acepta cargo' : ''}`, c.conv.id)
  await paso(c, null)
}

// ── Facturación y ventas ───────────────────────────────────────────────────

async function ticketFacturacion(c: Ctx) {
  const { ids, texto } = await mensajesConsulta(c)
  const resumen = texto.replace(/\s+/g, ' ').trim().slice(0, 80)
  const ticket = await crearTicket(c, {
    titulo: `Facturación: ${resumen || c.nombre}`,
    descripcion: `Consulta de facturación por WhatsApp.\n\n— ${c.nombre} (+${c.telefono}):\n${texto}`,
    prioridad: 'Media', cliente_id: c.conv.cliente_id, local_id: c.conv.local_id,
  }, ids)
  await decir(c, `Hemos registrado tu consulta de facturación con el nº ${ticket.numero}. Una persona de administración te responderá lo antes posible.`, {}, ticket.id)
  await avisarAdmins(c.db, `💶 Facturación #${ticket.numero} por WhatsApp`, `${c.nombre}: ${resumen}`, c.conv.id)
  await paso(c, null)
}

async function oportunidadVentas(c: Ctx) {
  const { texto } = await mensajesConsulta(c)
  const resumen = texto.replace(/\s+/g, ' ').trim().slice(0, 80)
  const { error } = await c.db.from('oportunidades').insert({
    titulo: `WhatsApp · ${c.nombre}${resumen ? ` · ${resumen}` : ''}`.slice(0, 200),
    descripcion: `Consulta comercial por WhatsApp.\n\n— ${c.nombre} (+${c.telefono}):\n${texto}`,
    estado: 'Detectado', origen: 'whatsapp',
    cliente_id: c.conv.cliente_id, local_id: c.conv.local_id, contacto_id: c.conv.contacto_id,
  })
  if (error) console.error('[whatsapp-webhook] oportunidad', error.message)
  await decir(c, 'Gracias. Hemos pasado tu consulta al equipo comercial y te contactaremos lo antes posible.')
  await avisarAdmins(c.db, `🛒 Venta por WhatsApp`, `${c.nombre}: ${resumen}`, c.conv.id)
  await paso(c, 'derivado')
}

async function derivar(c: Ctx, motivo: string) {
  await decir(c, 'Te paso con una persona del equipo, que te contestará en cuanto pueda.')
  await avisarAdmins(c.db, `🙋 WhatsApp: ${c.nombre} necesita una persona`, motivo, c.conv.id)
  await paso(c, 'derivado')
}

async function crearTicket(c: Ctx, t: {
  titulo: string; descripcion: string; prioridad: string; cliente_id: string | null; local_id: string | null
}, mensajes: string[]) {
  const { data: ticket, error } = await c.db.from('tickets').insert({
    ...t, estado: 'Abierto', via_contacto: 'whatsapp', canal: 'whatsapp', contacto_id: c.conv.contacto_id,
  }).select('id, numero, titulo, prioridad').single()
  if (error) throw new Error(`ticket: ${error.message}`)
  const cambios: Record<string, unknown> = { ticket_id: ticket.id }
  // El local elegido queda apuntado en la conversación si no tenía (para la bandeja).
  if (!c.conv.local_id && t.local_id) cambios.local_id = t.local_id
  if (!c.conv.cliente_id && t.cliente_id) cambios.cliente_id = t.cliente_id
  await c.db.from('wa_conversaciones').update(cambios).eq('id', c.conv.id)
  c.conv.ticket_id = ticket.id
  if (mensajes.length) await c.db.from('wa_mensajes').update({ ticket_id: ticket.id }).in('id', mensajes)
  await adjuntarAlTicket(c.db, ticket.id, mensajes, `WhatsApp · ${c.nombre}`)
  return ticket
}

// Locales cuyo nombre se parece a lo escrito. Primero los del cliente del
// teléfono; si no hay ninguno, en toda la base.
async function buscarLocales(db: SupabaseClient, texto: string, clienteId: string | null): Promise<LocalBot[]> {
  const q = sinAcentos(texto).replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim()
  if (q.length < 2) return []
  const vacias = new Set(['el', 'la', 'los', 'las', 'de', 'del', 'bar', 'restaurante', 'cafeteria', 'local', 'es', 'se', 'llama', 'en', 'y'])
  const palabras = q.split(' ').filter(p => p.length >= 3 && !vacias.has(p))
  const clave = (palabras.length ? palabras : [q]).sort((a, b) => b.length - a.length)[0]
  const campos = 'id, nombre, cliente_id, plan, estado_pago'

  const puntua = (l: LocalBot) => {
    const n = sinAcentos(l.nombre)
    if (n === q) return 100
    if (n.includes(q) || q.includes(n)) return 80
    return palabras.filter(p => n.includes(p)).length * 10
  }
  const mejores = (lista: LocalBot[]) => {
    const conPuntos = lista.map(l => ({ l, p: puntua(l) })).filter(x => x.p > 0).sort((a, b) => b.p - a.p)
    if (!conPuntos.length) return []
    const top = conPuntos[0].p
    // Uno claramente mejor que el resto: ese.
    if (conPuntos.length === 1 || top >= 80 && (conPuntos[1]?.p ?? 0) < top) return [conPuntos[0].l]
    return conPuntos.filter(x => x.p === top || x.p >= 20).map(x => x.l).slice(0, 9)
  }

  if (clienteId) {
    const { data } = await db.from('locales').select(campos).eq('cliente_id', clienteId).eq('activo', true)
    const r = mejores((data ?? []) as LocalBot[])
    if (r.length) return r
  }
  const { data } = await db.from('locales').select(campos).eq('activo', true)
    .ilike('nombre', `%${clave.replace(/[%_]/g, '')}%`).limit(50)
  return mejores((data ?? []) as LocalBot[])
}

// ¿Ha escrito alguien del equipo en esta conversación hace poco? Entonces la lleva él.
async function atiendePersona(db: SupabaseClient, convId: string): Promise<boolean> {
  const desde = new Date(Date.now() - CADUCA_DERIVADO_H * 3600_000).toISOString()
  const { data } = await db.from('wa_mensajes').select('id')
    .eq('conversacion_id', convId).eq('direccion', 'saliente').eq('automatico', false)
    .gte('created_at', desde).limit(1)
  return !!data?.length
}

// ─── Sin menú: la IA decide si es un aviso y abre ticket (comportamiento previo) ──
async function ticketDirecto(db: SupabaseClient, conv: any, telefono: string, nombre: string, mensajeId: string, texto: string) {
  const desde = new Date(Date.now() - VENTANA_AGRUPAR_H * 3600_000).toISOString()
  const { data: sueltos } = await db.from('wa_mensajes').select('id, texto, created_at')
    .eq('conversacion_id', conv.id).eq('direccion', 'entrante').is('ticket_id', null)
    .gte('created_at', desde).order('created_at')
  const lote: { id: string; texto: string | null }[] = sueltos?.length ? sueltos : [{ id: mensajeId, texto }]
  const conjunto = lote.map(x => x.texto).filter(Boolean).join('\n')

  let contexto = ''
  if (conv.cliente_id) {
    const { data: cli } = await db.from('clientes').select('nombre').eq('id', conv.cliente_id).maybeSingle()
    if (cli?.nombre) contexto = `El número pertenece al cliente "${cli.nombre}".`
  }

  const apiKey = Deno.env.get('GROQ_API_KEY') ?? ''
  const c = apiKey ? await clasificarMensajes(apiKey, conjunto, contexto) : null

  if (c && !c.es_aviso) {
    await avisarAdmins(db, `💬 WhatsApp de ${nombre}`, texto, conv.id)
    return
  }

  // Sin IA (Groq caído o sin clave) el aviso NO se pierde: ticket con el texto tal cual.
  let descripcion = c?.descripcion || conjunto
  if (c?.tipo === 'trabajo' && (c.fecha || c.hora)) {
    descripcion += `\n\nPide visita${c.fecha ? ` el ${c.fecha}` : ''}${c.hora ? ` a las ${c.hora}` : ''}.`
  }
  descripcion += `\n\n— WhatsApp de ${nombre} (+${telefono}):\n${conjunto}`

  const { data: ticket, error: eT } = await db.from('tickets').insert({
    titulo: c?.titulo || `Aviso por WhatsApp de ${nombre}`,
    descripcion,
    prioridad: c?.prioridad || 'Media',
    estado: 'Abierto',
    via_contacto: 'whatsapp', canal: 'whatsapp',
    cliente_id: conv.cliente_id, local_id: conv.local_id, contacto_id: conv.contacto_id,
  }).select('id, numero, titulo, prioridad').single()
  if (eT) throw new Error(`ticket: ${eT.message}`)

  await db.from('wa_conversaciones').update({ ticket_id: ticket.id }).eq('id', conv.id)
  await db.from('wa_mensajes').update({ ticket_id: ticket.id }).in('id', lote.map(x => x.id))
  await adjuntarAlTicket(db, ticket.id, lote.map(x => x.id), `WhatsApp · ${nombre}`)

  if (Deno.env.get('WHATSAPP_AUTORESPUESTA') !== '0' && waConfigurado()) {
    const saludo = conv.nombre ? `Hola ${conv.nombre.split(' ')[0]}` : 'Hola'
    const urgente = ticket.prioridad === 'Alta' ? ' Lo hemos marcado como urgente.' : ''
    await decir({ db, conv, telefono, nombre, datos: {} },
      `${saludo}, gracias por escribir a Ok Computer Tenerife. Hemos registrado tu aviso con el nº ${ticket.numero}: «${ticket.titulo}».${urgente} Un técnico se pondrá en contacto contigo lo antes posible. Si quieres añadir algo, contesta a este mensaje.`,
      {}, ticket.id)
  }
  await avisarAdmins(db, `🎫 Ticket #${ticket.numero} por WhatsApp`, `${nombre}: ${ticket.titulo}`, conv.id)
}

async function ticketAbierto(db: SupabaseClient, ticketId: string | null | undefined) {
  if (!ticketId) return null
  const { data } = await db.from('tickets').select('id, numero, estado').eq('id', ticketId).maybeSingle()
  return data && data.estado !== 'Cerrado' ? data : null
}

// Manda un mensaje automático (texto, botones o lista) y lo apunta en la bandeja.
async function decir(
  c: Ctx, texto: string,
  extra: { botones?: { id: string; titulo: string }[]; lista?: { boton: string; filas: { id: string; titulo: string }[] } } = {},
  ticketId: string | null = null,
) {
  const r = extra.botones ? await enviarBotones(c.telefono, texto, extra.botones)
    : extra.lista ? await enviarLista(c.telefono, texto, extra.lista.boton, extra.lista.filas)
    : await enviarTexto(c.telefono, texto)
  const opciones = extra.botones?.map(b => b.titulo) ?? extra.lista?.filas.map(f => f.titulo) ?? []
  const guardado = opciones.length ? `${texto}\n[${opciones.join(' · ')}]` : texto
  const ahora = new Date().toISOString()
  await c.db.from('wa_mensajes').insert({
    conversacion_id: c.conv.id, wa_message_id: r.id ?? null, direccion: 'saliente',
    tipo: opciones.length ? 'interactive' : 'text', texto: guardado,
    estado: r.ok ? 'enviado' : 'fallido', error: r.error ?? null, automatico: true, usuario: 'Automático',
    ticket_id: ticketId, created_at: ahora,
  })
  await c.db.from('wa_conversaciones').update({ ultimo_mensaje: texto.slice(0, 200), ultimo_mensaje_at: ahora }).eq('id', c.conv.id)
}

async function registrarEco(db: SupabaseClient, m: any, usuario: string) {
  if (!m?.id || !m?.to) return
  const telefono = normalizaTelefono(m.to)
  const conv = await conversacionDe(db, telefono, '')
  const texto = textoDeMensaje(m) || `(${m.type})`
  const media = mediaDeMensaje(m)
  const cuando = m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString()
  const { data } = await db.from('wa_mensajes').upsert({
    conversacion_id: conv.id, wa_message_id: m.id, direccion: 'saliente', tipo: m.type, texto,
    media_id: media.id ?? null, media_mime: media.mime ?? null, media_nombre: media.nombre ?? null,
    estado: 'enviado', usuario, automatico: usuario === 'Agente de Meta', created_at: cuando,
  }, { onConflict: 'wa_message_id', ignoreDuplicates: true }).select('id')
  if (data?.length) {
    await db.from('wa_conversaciones').update({ ultimo_mensaje: texto.slice(0, 200), ultimo_mensaje_at: cuando }).eq('id', conv.id)
  }
}

// El agente de Meta pasa la conversación a la app (una persona tiene que
// contestar) o la recupera. El formato exacto del aviso no está documentado con
// ejemplo: se busca el teléfono donde suele venir y el cuerpo se deja en el log.
async function traspaso(db: SupabaseClient, v: any) {
  console.log('[whatsapp-webhook] messaging_handovers', JSON.stringify(v).slice(0, 800))
  const tel = normalizaTelefono(String(
    v?.contacts?.[0]?.wa_id ?? v?.user_phone_number ?? v?.from ?? v?.recipient_id ?? v?.messaging_handovers?.[0]?.from ?? '',
  ))
  if (tel.length < 10) return
  const conv = await conversacionDe(db, tel, v?.contacts?.[0]?.profile?.name ?? '')
  const texto = JSON.stringify(v).toLowerCase()
  const aLaApp = /pass|take|human|app_control|to_app|release/.test(texto) && !/to_agent|resume|return/.test(texto)
  if (aLaApp) {
    await db.from('wa_conversaciones').update({ sin_leer: (conv.sin_leer ?? 0) + 1 }).eq('id', conv.id)
    await avisarAdmins(db, `🙋 WhatsApp: ${conv.nombre || '+' + tel} necesita una persona`,
      'El agente de Meta ha pasado la conversación. Contesta desde la bandeja de WhatsApp.', conv.id)
  }
}

