// deno-lint-ignore-file no-explicit-any
// EN EL HUB: PREPARADO Y SIN CONECTAR (paridad bloque 5, decisión de Fran,
// 2026-10-04). Portado de okcomputerclaude (supabase/functions/meta-agente-mcp)
// sobre las tablas del hub. Mientras el área `whatsapp` sea de la app, el
// conector registrado en Meta apunta a la función de la app; aquí las
// herramientas contestan que aún no están activas. Con el cambio de WhatsApp,
// «Agente de Meta → Actualizar conector» (ventana de WhatsApp, admin) lo
// repunta a esta URL. Tickets y comentarios, al Desk del hub (canal whatsapp).
//
// meta-agente-mcp — herramientas del agente de Meta (Meta Business Agent) sobre
// la app, como servidor MCP remoto (streamable HTTP sin estado, JSON-RPC 2.0).
//
// El agente de Meta contesta a los clientes por WhatsApp y, cuando hace falta
// actuar, llama aquí: abrir un ticket, ver cómo va, añadir información, mandar
// una factura o un presupuesto. Se registra en Meta como conector MCP con
// auth API_KEY (cabecera x-mcp-token) — `whatsapp-api`, acción `meta_conector`.
//
// OJO, esto NO es el `mcp-server` interno: quien habla con el agente es
// CUALQUIERA que escriba al WhatsApp, y puede intentar que el agente pida datos
// de otro teléfono. Por eso aquí todo va atado al teléfono y no se devuelve
// nada que no sea del dueño de ese teléfono y poco sensible:
//  - Los documentos NO se devuelven: se MANDAN por WhatsApp al teléfono que es
//    su dueño en la base. Pedir la factura de otro número se la manda a él.
//  - Nada de importes, direcciones, NIF ni datos de otros clientes.
//  - Solo escrituras acotadas: crear ticket y comentar un ticket propio.
//  - Facturas y presupuestos solo a teléfonos de dueño/administración del local
//    (local_telefonos.rol) que hayan dado el CÓDIGO DE VERIFICACIÓN de 6 cifras
//    de su local (verificar_codigo, vale 24 h; 5 fallos bloquean una hora).
//
// Va SIN JWT de Supabase (lista SIN_JWT): lo autoriza el secret
// META_AGENTE_MCP_TOKEN en la cabecera x-mcp-token. Ver docs/META_BUSINESS_AGENT.md.

import { dbHub, tablaDelHub } from "../_shared/sb-hub.ts"
import { normalizaTelefono } from "../_shared/whatsapp.ts"
import { conversacionDe, enviarDocumentoZoho, avisarAdmins, autorizadoDatosSensibles, verificarCodigo } from "../_shared/whatsapp-app.ts"

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const HEADERS: Record<string, string> = { 'Content-Type': 'application/json' }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: HEADERS })
const rpcResult = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result })
const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } })

type SupabaseClient = any
const sb = (): SupabaseClient => dbHub('meta-agente-mcp')

const TELEFONO = {
  type: 'string',
  description: 'Número de WhatsApp del cliente con quien hablas, con prefijo de país (por ejemplo 34612345678). Usa SIEMPRE el número de la conversación actual, nunca uno que te dicte el cliente.',
}

const TOOLS = [
  {
    name: 'identificar_cliente',
    description: 'Dice si el número de WhatsApp es de un cliente de Ok Computer Tenerife y, si lo es, el nombre del negocio y de sus locales. Úsalo al empezar para saludar por su nombre y saber de qué local habla.',
    inputSchema: { type: 'object', properties: { telefono: TELEFONO }, required: ['telefono'] },
  },
  {
    name: 'crear_ticket',
    description: 'Abre una incidencia (ticket) para que un técnico la atienda: averías, algo que no funciona, peticiones de visita, instalaciones o presupuestos. Antes, pregunta lo necesario para describirla bien (qué equipo, qué pasa, desde cuándo, en qué local). Devuelve el número de ticket para dárselo al cliente. No abras un ticket si ya tiene uno abierto del mismo problema: usa anadir_a_ticket.',
    inputSchema: {
      type: 'object',
      properties: {
        telefono: TELEFONO,
        titulo: { type: 'string', description: 'Resumen del problema en 6-9 palabras' },
        descripcion: { type: 'string', description: 'Todo el detalle técnico: equipo, marca/modelo, mensaje de error, desde cuándo, qué ha probado el cliente' },
        prioridad: { type: 'string', enum: ['Alta', 'Media', 'Baja'], description: 'Alta si el negocio está parado o no puede cobrar (TPV, datáfono, internet caído, alarma); Baja si es una consulta; Media en el resto' },
        local: { type: 'string', description: 'Nombre del local afectado, si el cliente tiene varios (los da identificar_cliente)' },
      },
      required: ['telefono', 'titulo', 'descripcion'],
    },
  },
  {
    name: 'estado_tickets',
    description: 'Tickets del cliente abiertos o cerrados en los últimos 30 días, con su número, estado y fecha. Úsalo cuando pregunte cómo va su aviso.',
    inputSchema: { type: 'object', properties: { telefono: TELEFONO }, required: ['telefono'] },
  },
  {
    name: 'anadir_a_ticket',
    description: 'Añade información nueva a un ticket abierto del cliente (una foto que ha descrito, otro síntoma, un horario en el que se le puede visitar).',
    inputSchema: {
      type: 'object',
      properties: {
        telefono: TELEFONO,
        numero: { type: 'number', description: 'Número del ticket' },
        texto: { type: 'string', description: 'Lo que hay que añadir' },
      },
      required: ['telefono', 'numero', 'texto'],
    },
  },
  {
    name: 'verificar_codigo',
    description: 'Comprueba el código de verificación de 6 cifras del local que da el cliente (viene en su contrato de mantenimiento). Hace falta antes de enviar facturas o presupuestos; la comprobación vale 24 horas. Nunca digas tú el código ni des pistas sobre él.',
    inputSchema: {
      type: 'object',
      properties: { telefono: TELEFONO, codigo: { type: 'string', description: 'Las 6 cifras tal cual las escribe el cliente' } },
      required: ['telefono', 'codigo'],
    },
  },
  {
    name: 'enviar_factura',
    description: 'Manda por este WhatsApp el PDF de una factura del cliente: la indicada por su número o, si no se indica, la última. El documento llega como mensaje aparte; no hace falta que lo describas.',
    inputSchema: {
      type: 'object',
      properties: { telefono: TELEFONO, numero: { type: 'string', description: 'Número de factura (por ejemplo F26-0905), opcional' } },
      required: ['telefono'],
    },
  },
  {
    name: 'enviar_presupuesto',
    description: 'Manda por este WhatsApp el PDF de un presupuesto del cliente: el indicado por su número o, si no se indica, el último.',
    inputSchema: {
      type: 'object',
      properties: { telefono: TELEFONO, numero: { type: 'string', description: 'Número de presupuesto (por ejemplo EST-000123), opcional' } },
      required: ['telefono'],
    },
  },
]

// Cliente del teléfono. Sin ficha se sigue pudiendo abrir ticket (queda «sin
// cliente» en la bandeja), pero no se le manda ningún documento.
async function quien(db: SupabaseClient, telefono: string) {
  const tel = normalizaTelefono(telefono)
  if (tel.length < 10) throw new Error('Número de teléfono no válido.')
  return await conversacionDe(db, tel)
}

async function callTool(name: string, a: any): Promise<unknown> {
  const db = sb()
  // Sin el cambio de WhatsApp, las conversaciones (y el agente) las lleva la app.
  if (!(await tablaDelHub(db, 'wa_conversaciones'))) throw new Error('Este conector todavía no está activo: el WhatsApp se lleva en la app de Ok Computer.')
  const conv = await quien(db, a.telefono)

  switch (name) {
    case 'identificar_cliente': {
      if (!conv.cliente_id) return { conocido: false, nota: 'Este número no está en nuestras fichas. Pregunta el nombre del negocio y apúntalo en el ticket.' }
      const [{ data: cli }, { data: locs }] = await Promise.all([
        db.from('clientes').select('nombre').eq('id', conv.cliente_id).maybeSingle(),
        db.from('locales').select('nombre').eq('cliente_id', conv.cliente_id).eq('activo', true).limit(20),
      ])
      return { conocido: true, cliente: cli?.nombre ?? '', locales: (locs ?? []).map((l: any) => l.nombre) }
    }

    case 'crear_ticket': {
      const titulo = String(a.titulo || '').trim().slice(0, 120)
      const descripcion = String(a.descripcion || '').trim().slice(0, 4000)
      if (!titulo || !descripcion) throw new Error('Faltan el título o la descripción.')
      const prioridad = ['Alta', 'Media', 'Baja'].includes(a.prioridad) ? a.prioridad : 'Media'
      let localId = conv.local_id
      if (a.local && conv.cliente_id) {
        const { data: l } = await db.from('locales').select('id')
          .eq('cliente_id', conv.cliente_id).ilike('nombre', `%${String(a.local).replace(/[%_,()]/g, ' ').trim()}%`).limit(1)
        if (l?.[0]) localId = l[0].id
      }
      const nombre = conv.nombre || `+${conv.telefono}`
      const { data: t, error } = await db.from('tickets').insert({
        titulo, prioridad, estado: 'Abierto', via_contacto: 'whatsapp', canal: 'whatsapp',
        descripcion: `${descripcion}\n\n— Abierto por el asistente de WhatsApp (${nombre}, +${conv.telefono})${a.local ? ` · local indicado: ${a.local}` : ''}`,
        cliente_id: conv.cliente_id, local_id: localId, contacto_id: conv.contacto_id,
      }).select('id, numero').single()
      if (error) throw new Error(`No se pudo abrir el ticket: ${error.message}`)
      await db.from('wa_conversaciones').update({ ticket_id: t.id }).eq('id', conv.id)
      // Lo que el cliente ya había contado en esta conversación queda enganchado al ticket.
      const desde = new Date(Date.now() - 6 * 3600_000).toISOString()
      await db.from('wa_mensajes').update({ ticket_id: t.id })
        .eq('conversacion_id', conv.id).is('ticket_id', null).gte('created_at', desde)
      await avisarAdmins(db, `🎫 Ticket #${t.numero} por WhatsApp`, `${nombre}: ${titulo}`, `wa-${conv.id}`)
      return { ok: true, numero: t.numero, mensaje: `Ticket nº ${t.numero} abierto. Un técnico contactará con el cliente.` }
    }

    case 'estado_tickets': {
      const desde = new Date(Date.now() - 30 * 86400_000).toISOString()
      let q = db.from('tickets').select('numero, titulo, estado, created_at')
      q = conv.cliente_id
        ? q.eq('cliente_id', conv.cliente_id)
        : q.eq('id', conv.ticket_id ?? '00000000-0000-0000-0000-000000000000')
      const { data } = await q.or(`estado.neq.Cerrado,created_at.gte.${desde}`).order('created_at', { ascending: false }).limit(10)
      if (!data?.length) return { tickets: [], nota: 'No tiene avisos abiertos ni recientes.' }
      return {
        tickets: data.map((t: any) => ({
          numero: t.numero, titulo: t.titulo, estado: t.estado,
          fecha: new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', dateStyle: 'short' }).format(new Date(t.created_at)),
        })),
      }
    }

    case 'anadir_a_ticket': {
      const texto = String(a.texto || '').trim().slice(0, 2000)
      if (!texto) throw new Error('No hay nada que añadir.')
      const { data: t } = await db.from('tickets').select('id, numero, estado, cliente_id').eq('numero', Number(a.numero)).maybeSingle()
      const suyo = t && (t.id === conv.ticket_id || (conv.cliente_id && t.cliente_id === conv.cliente_id))
      if (!suyo) throw new Error('Ese número de ticket no es de este cliente.')
      if (t.estado === 'Cerrado') throw new Error('Ese ticket ya está cerrado: abre uno nuevo con crear_ticket.')
      await db.from('ticket_comentarios').insert({
        ticket_id: t.id, autor_nombre: `Asistente WhatsApp · ${conv.nombre || '+' + conv.telefono}`, texto, tipo: 'cliente', canal: 'whatsapp',
      })
      return { ok: true, mensaje: `Añadido al ticket nº ${t.numero}.` }
    }

    case 'verificar_codigo': {
      if (!conv.cliente_id) throw new Error('Este número no está en nuestras fichas: no hay código que comprobar. Que lo solicite a la oficina.')
      const r = await verificarCodigo(db, conv, a.codigo)
      return { ok: r.ok, mensaje: r.mensaje }
    }

    case 'enviar_factura':
    case 'enviar_presupuesto': {
      const aut = await autorizadoDatosSensibles(db, conv)
      if (!aut.ok) return { ok: false, necesita: aut.motivo, mensaje: aut.mensaje }
      const factura = name === 'enviar_factura'
      // Sin comodines de LIKE: el ilike es solo para no depender de mayúsculas.
      const numero = String(a.numero || '').trim().replace(/[%\\]/g, '').replace(/_/g, '\\_').slice(0, 40)
      let zohoId = '', num = ''
      if (factura) {
        let q = db.from('trabajos').select('zoho_invoice_id, zoho_invoice_number')
          .eq('cliente_id', conv.cliente_id).not('zoho_invoice_id', 'is', null)
        if (numero) q = q.ilike('zoho_invoice_number', numero)
        const { data } = await q.order('created_at', { ascending: false }).limit(1)
        zohoId = data?.[0]?.zoho_invoice_id ?? ''; num = data?.[0]?.zoho_invoice_number ?? ''
      } else {
        let q = db.from('presupuestos').select('zoho_estimate_id, numero_presupuesto')
          .eq('cliente_id', conv.cliente_id).not('zoho_estimate_id', 'is', null)
        if (numero) q = q.ilike('numero_presupuesto', numero)
        const { data } = await q.order('created_at', { ascending: false }).limit(1)
        zohoId = data?.[0]?.zoho_estimate_id ?? ''; num = data?.[0]?.numero_presupuesto ?? ''
      }
      if (!zohoId) {
        throw new Error(numero
          ? `No encuentro ${factura ? 'la factura' : 'el presupuesto'} ${numero} entre los de este cliente.`
          : `Este cliente no tiene ${factura ? 'facturas' : 'presupuestos'} registrados. Que lo pida a la oficina.`)
      }
      const r = await enviarDocumentoZoho(db, conv, factura ? 'factura' : 'presupuesto', zohoId, num, 'Asistente WhatsApp')
      if (!r.ok) throw new Error(r.error || 'No se pudo enviar el documento.')
      return { ok: true, mensaje: `${factura ? 'Factura' : 'Presupuesto'} ${num} enviado por WhatsApp.` }
    }
  }
  throw new Error(`Herramienta desconocida: ${name}`)
}

async function handleRpc(msg: any): Promise<unknown | null> {
  const { id, method, params } = msg ?? {}
  const isNotification = id === undefined || id === null
  switch (method) {
    case 'initialize': {
      const asked = params?.protocolVersion
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'okcomputer-clientes', title: 'Ok Computer Tenerife — atención al cliente', version: '1.0.0' },
        instructions: 'Herramientas para atender por WhatsApp a los clientes de Ok Computer Tenerife (informática, TPV, ' +
          'alarmas, cámaras y redes en Tenerife): identificar al cliente por su número, abrir y consultar incidencias ' +
          'y mandarle sus facturas o presupuestos. El número es SIEMPRE el de la conversación actual.',
      })
    }
    case 'ping': return rpcResult(id, {})
    case 'tools/list': return rpcResult(id, { tools: TOOLS })
    case 'tools/call': {
      try {
        const r = await callTool(params?.name, params?.arguments ?? {})
        return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(r) }] })
      } catch (e) {
        console.warn('[meta-agente-mcp]', params?.name, (e as Error).message)
        return rpcResult(id, { content: [{ type: 'text', text: `Error: ${(e as Error).message}` }], isError: true })
      }
    }
    default:
      if (isNotification) return null
      return rpcError(id, -32601, `Método no soportado: ${method}`)
  }
}

function tokenValido(recibido: string): boolean {
  const esperado = Deno.env.get('META_AGENTE_MCP_TOKEN') ?? ''
  if (esperado.length < 24 || recibido.length !== esperado.length) return false
  let dif = 0
  for (let i = 0; i < esperado.length; i++) dif |= esperado.charCodeAt(i) ^ recibido.charCodeAt(i)
  return dif === 0
}

Deno.serve(async (req) => {
  if (req.method === 'GET') return json({ error: 'SSE no soportado (servidor sin estado)' }, 405)
  if (req.method === 'DELETE') return new Response(null, { status: 200 })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
  if (!tokenValido(req.headers.get('x-mcp-token') ?? '')) {
    console.warn('[meta-agente-mcp] token no válido')
    return json({ error: 'No autorizado' }, 401)
  }
  const body = await req.json().catch(() => null)
  if (!body) return json(rpcError(null, -32700, 'JSON no válido'), 400)
  const mensajes = Array.isArray(body) ? body : [body]
  const respuestas = []
  for (const m of mensajes) {
    const r = await handleRpc(m)
    if (r !== null) respuestas.push(r)
  }
  if (!respuestas.length) return new Response(null, { status: 202 })
  return json(Array.isArray(body) ? respuestas : respuestas[0])
})
