// mcp — conector MCP del hub para Claude Code (streamable HTTP sin estado,
// JSON-RPC 2.0 sobre POST). Patrón de `mcp-server` de la app actual.
//
// Autorización: token propio del hub (hub.mcp_tokens, se crea en la pantalla
// «Conector MCP»), en `Authorization: Bearer okh_…` o en `x-mcp-token`. Va en
// SIN_JWT (el token no es un JWT de Supabase). Cada token tiene alcance
// (lectura | escritura | admin) y dueño; lo que escribe queda en
// hub.auditoria a nombre del dueño, con origen 'mcp'.
//
// Herramientas: _shared/acciones.ts (catálogo único, sin SQL libre, respeta
// hub.areas). Conexión desde Claude Code: ver docs/MCP.md y .mcp.json.
import { hubDb } from '../_shared/hub-db.ts'
import { disponibles, ejecutar, tablasDeLaApp, type Alcance, type Contexto } from '../_shared/acciones.ts'

const PROTOCOLOS = ['2025-06-18', '2025-03-26', '2024-11-05']
const CAB: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-mcp-token, mcp-protocol-version, mcp-session-id',
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CAB, 'Content-Type': 'application/json' } })
const ok = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result })
const err = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } })

async function autenticar(req: Request): Promise<Contexto | null> {
  const token = (req.headers.get('x-mcp-token') ?? req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '').trim()
  if (!token.startsWith('okh_')) return null
  const sistema = hubDb({ origen: 'mcp' })
  const filas = await sistema.rpc('mcp_validar', { p_token: token }) as { alcance: Alcance; usuario_id: string; email: string; nombre: string }[]
  const t = filas?.[0]
  if (!t) return null
  return { db: hubDb({ origen: 'mcp', email: t.email }), usuarioId: t.usuario_id, email: t.email, nombre: t.nombre, alcance: t.alcance }
}

// deno-lint-ignore no-explicit-any
async function atender(msg: any, ctx: Contexto): Promise<unknown | null> {
  const { id, method, params } = msg ?? {}
  const notificacion = id === undefined || id === null
  switch (method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: PROTOCOLOS.includes(params?.protocolVersion) ? params.protocolVersion : PROTOCOLOS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'okhub', title: 'Ok Computer Hub', version: '1.0.0' },
        instructions: `Hub de Ok Computer Tenerife. Actúas en nombre de ${ctx.nombre} (${ctx.email}) con alcance «${ctx.alcance}». ` +
          'Empieza por «esquema» si no sabes dónde está algo. Los datos de la app actual (clientes, trabajos, tickets…) son una copia de solo lectura; ' +
          'los proyectos son del hub y se pueden escribir. Fechas en AAAA-MM-DD (Canarias). Nunca inventes ids: sácalos de buscar o de los listados.',
      })
    case 'ping':
      return ok(id, {})
    case 'tools/list': {
      const lista = disponibles(ctx.alcance, await tablasDeLaApp(ctx.db))
      return ok(id, { tools: lista.map(h => ({ name: h.name, description: h.description, inputSchema: h.inputSchema })) })
    }
    case 'tools/call':
      try {
        const r = await ejecutar(params?.name, params?.arguments ?? {}, ctx)
        return ok(id, { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] })
      } catch (e) {
        // Error de la herramienta, no del protocolo: el modelo lo lee y corrige.
        return ok(id, { content: [{ type: 'text', text: `Error: ${(e as Error).message}` }], isError: true })
      }
    default:
      return notificacion ? null : err(id, -32601, `Método no soportado: ${method}`)
  }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CAB })
  if (req.method === 'GET') return json({ error: 'SSE no soportado (servidor sin estado)' }, 405)
  if (req.method === 'DELETE') return new Response(null, { status: 200, headers: CAB })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  let ctx: Contexto | null = null
  try { ctx = await autenticar(req) } catch (e) { console.error('[mcp] validar token:', e) }
  if (!ctx) return json({ error: 'No autorizado: token del hub (okh_…) ausente, revocado o caducado' }, 401)

  const cuerpo = await req.json().catch(() => null)
  if (!cuerpo) return json(err(null, -32700, 'JSON no válido'), 400)
  const mensajes = Array.isArray(cuerpo) ? cuerpo : [cuerpo]
  const respuestas = []
  for (const m of mensajes) {
    const r = await atender(m, ctx)
    if (r !== null) respuestas.push(r)
  }
  if (!respuestas.length) return new Response(null, { status: 202, headers: CAB })
  return json(Array.isArray(cuerpo) ? respuestas : respuestas[0])
})
