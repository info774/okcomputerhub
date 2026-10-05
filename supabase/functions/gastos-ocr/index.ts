// gastos-ocr — un ticket o factura de gasto (foto o PDF) → Claude lo lee →
// hub.tickets_gasto en «revisar» para que una persona confirme (fase 10).
// Con sesión: { accion: 'subir', archivo (base64), tipo, nombre } y
// { accion: 'url', id } (enlace de minutos al fichero; el que lo subió o un admin).
// { accion: 'albaran', archivo, tipo } (paridad bloque 7, el «Escanear albarán» del
// inventario de la app): lee los productos y los DEVUELVE; no guarda nada (los
// da de entrada hub.inventario_entradas, cuando la persona confirma).
// Bloque 7, tanda 2 (Almacén → Facturas de compra y Personas → Gastos):
// { accion: 'compra', archivo, tipo }  sube el adjunto de una factura de proveedor
//   (compras/…) y, con Claude, lo lee para rellenar el formulario → { ruta, lectura }
// { accion: 'compra_url', id }         enlace de minutos al adjunto de esa factura
// { accion: 'foto', archivo, tipo }    foto de un gasto o cobro de la app → { foto_url: 'hub:gastos/…' }
// { accion: 'foto_url', id }           enlace de minutos a la foto de ese movimiento
import { makeCorsHeaders, json, getAuthedUser, unauthorized, forbidden } from '../_shared/http.ts'
import { hubDb, type Db } from '../_shared/hub-db.ts'
import { personaPorEmail } from '../_shared/personas.ts'
import { claudeConfigurado, preguntarClaude } from '../_shared/claude.ts'
import { subir, urlFirmada } from '../_shared/archivos.ts'

const TIPOS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf' }
const CATEGORIAS = ['Material', 'Combustible', 'Dietas', 'Aparcamiento y peajes', 'Transporte', 'Software y suscripciones', 'Teléfono e internet', 'Oficina', 'Herramientas', 'Otros']

interface Lectura { fecha: string | null; proveedor: string | null; nif: string | null; concepto: string | null; base: number | null; impuesto_pct: number | null;
  impuesto: number | null; total: number | null; categoria: string; forma_pago: string | null; legible: boolean }

const n = { type: ['number', 'null'] }, t = { type: ['string', 'null'] }
async function leer(b64: string, tipo: string): Promise<Lectura> {
  const doc = tipo === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
    : { type: 'image', source: { type: 'base64', media_type: tipo, data: b64 } }
  return await preguntarClaude<Lectura>({
    sistema: `Lees tickets y facturas de GASTO de una empresa de Tenerife (Canarias: el impuesto suele ser IGIC 7 % o 3 %, a veces 0; en la península sería IVA). Saca los datos tal cual aparecen, sin inventar: si algo no se lee, null. fecha en AAAA-MM-DD. Importes en euros con punto decimal. categoria: una de ${CATEGORIAS.join(', ')}. legible = false si la imagen no es un ticket o no se lee.`,
    contenido: [doc, { type: 'text', text: 'Lee este gasto.' }],
    maxTokens: 1500, esfuerzo: 'low',
    esquema: { type: 'object', additionalProperties: false, required: ['fecha', 'proveedor', 'nif', 'concepto', 'base', 'impuesto_pct', 'impuesto', 'total', 'categoria', 'forma_pago', 'legible'],
      properties: { fecha: t, proveedor: t, nif: t, concepto: t, base: n, impuesto_pct: n, impuesto: n, total: n, categoria: { type: 'string', enum: CATEGORIAS }, forma_pago: t, legible: { type: 'boolean' } } },
  })
}

interface Albaran { productos: { nombre: string; cantidad: number; precio: number; referencia: string }[]; legible: boolean }
async function leerAlbaran(b64: string, tipo: string): Promise<Albaran> {
  const doc = tipo === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
    : { type: 'image', source: { type: 'base64', media_type: tipo, data: b64 } }
  return await preguntarClaude<Albaran>({
    sistema: 'Lees albaranes y facturas de PROVEEDOR de una empresa de informática de Tenerife. Saca todos los productos o artículos, tal cual aparecen y sin inventar: nombre = la descripción del producto; cantidad = número (1 si no está claro); precio = precio unitario sin impuestos (0 si no aparece); referencia = el código o referencia del proveedor (vacío si no hay). legible = false si no es un albarán o factura o no se lee.',
    contenido: [doc, { type: 'text', text: 'Lee este albarán.' }],
    maxTokens: 4000, esfuerzo: 'low',
    esquema: { type: 'object', additionalProperties: false, required: ['productos', 'legible'], properties: {
      legible: { type: 'boolean' },
      productos: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['nombre', 'cantidad', 'precio', 'referencia'],
        properties: { nombre: { type: 'string' }, cantidad: { type: 'number' }, precio: { type: 'number' }, referencia: { type: 'string' } } } } } },
  })
}

async function procesar(db: Db, id: string, b64: string, tipo: string) {
  try {
    const l = await leer(b64, tipo)
    await db.patch(`tickets_gasto?id=eq.${id}`, { estado: l.legible ? 'revisar' : 'error', leido_por_claude: true, datos_ocr: l,
      fecha: /^\d{4}-\d{2}-\d{2}$/.test(l.fecha ?? '') ? l.fecha : null, proveedor: l.proveedor, nif: l.nif, concepto: l.concepto, base: l.base,
      impuesto_pct: l.impuesto_pct, impuesto: l.impuesto, total: l.total, categoria: l.categoria, forma_pago: l.forma_pago,
      error: l.legible ? null : 'No parece un ticket o no se lee: rellénalo a mano' })
  } catch (e) {
    await db.patch(`tickets_gasto?id=eq.${id}`, { estado: 'error', error: (e as Error).message.slice(0, 300) })
  }
}

Deno.serve(async req => {
  const cors = makeCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405, cors)
  const user = await getAuthedUser(req)
  if (!user?.email) return unauthorized(cors)
  const yo = await personaPorEmail(hubDb({ origen: 'gastos' }), user.email)
  if (!yo) return forbidden(cors, 'No estás dado de alta en el hub.')
  const db = hubDb({ origen: 'gastos', email: user.email })
  const b = await req.json().catch(() => ({}))
  try {
    if (b.accion === 'subir') {
      const tipo = String(b.tipo ?? '')
      if (!TIPOS[tipo]) return json({ error: 'Sube una foto (JPG, PNG, WEBP) o un PDF' }, 400, cors)
      const bytes = Uint8Array.from(atob(String(b.archivo ?? '')), c => c.charCodeAt(0))
      if (bytes.byteLength < 100 || bytes.byteLength > 12 * 1024 * 1024) return json({ error: 'El fichero está vacío o pasa de 12 MB' }, 400, cors)
      const hoy = new Date()
      const ruta = `${hoy.getFullYear()}/${String(hoy.getMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.${TIPOS[tipo]}`
      await subir('gastos', ruta, bytes, tipo)
      const [g] = await db.post('tickets_gasto', { archivo_path: ruta, archivo_tipo: tipo, subido_por: yo.id,
        estado: claudeConfigurado() ? 'leyendo' : 'revisar', error: claudeConfigurado() ? null : 'Sin Claude: rellena los datos a mano' })
      if (claudeConfigurado()) await procesar(db, g.id as string, String(b.archivo), tipo)
      const [fila] = await db.get(`tickets_gasto?select=*&id=eq.${g.id}`)
      return json(fila, 200, cors)
    }
    if (b.accion === 'albaran') {
      const tipo = String(b.tipo ?? '')
      if (!TIPOS[tipo]) return json({ error: 'Sube una foto (JPG, PNG, WEBP) o un PDF' }, 400, cors)
      if (String(b.archivo ?? '').length > 16 * 1024 * 1024) return json({ error: 'El fichero pasa de 12 MB' }, 400, cors)
      if (!claudeConfigurado()) return json({ error: 'Para leer el albarán hace falta la clave de Claude (docs/PENDIENTE_FRAN.md §1). Mientras, añade los productos a mano.' }, 503, cors)
      const a = await leerAlbaran(String(b.archivo ?? ''), tipo)
      if (!a.legible || !a.productos?.length) return json({ error: 'No se detectaron productos: prueba con una foto más clara' }, 422, cors)
      return json({ productos: a.productos.slice(0, 200) }, 200, cors)
    }
    if (b.accion === 'compra' || b.accion === 'foto') {
      const tipo = String(b.tipo ?? '')
      if (!TIPOS[tipo]) return json({ error: 'Sube una foto (JPG, PNG, WEBP) o un PDF' }, 400, cors)
      const bytes = Uint8Array.from(atob(String(b.archivo ?? '')), c => c.charCodeAt(0))
      if (bytes.byteLength < 100 || bytes.byteLength > 12 * 1024 * 1024) return json({ error: 'El fichero está vacío o pasa de 12 MB' }, 400, cors)
      const hoy = new Date()
      const ruta = `${b.accion === 'compra' ? 'compras' : 'movimientos'}/${hoy.getFullYear()}/${String(hoy.getMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.${TIPOS[tipo]}`
      await subir('gastos', ruta, bytes, tipo)
      if (b.accion === 'foto') return json({ foto_url: `hub:gastos/${ruta}` }, 200, cors)
      let lectura: Lectura | null = null
      if (claudeConfigurado()) lectura = await leer(String(b.archivo), tipo).catch(() => null)
      return json({ ruta, tipo, lectura }, 200, cors)
    }
    if (b.accion === 'compra_url' || b.accion === 'foto_url') {
      if (typeof b.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(b.id)) return json({ error: 'id no válido' }, 400, cors)
      const [f] = b.accion === 'compra_url'
        ? await db.get(`facturas_compra?select=ruta:archivo_path&id=eq.${b.id}`)
        : await db.get(`gastos?select=ruta:foto_url&id=eq.${b.id}`)
      const ruta = String(f?.ruta ?? '').replace(/^hub:gastos\//, '')
      if (!ruta || ruta.startsWith('http') || ruta.startsWith('data:')) return json({ error: 'No encontrado' }, 404, cors)
      return json({ url: await urlFirmada('gastos', ruta) }, 200, cors)
    }
    if (b.accion === 'url') {
      if (typeof b.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(b.id)) return json({ error: 'id no válido' }, 400, cors)
      const [g] = await db.get(`tickets_gasto?select=archivo_path,subido_por&id=eq.${b.id}`)
      if (!g?.archivo_path || (g.subido_por !== yo.id && yo.rol !== 'admin')) return json({ error: 'No encontrado' }, 404, cors)
      return json({ url: await urlFirmada('gastos', String(g.archivo_path)) }, 200, cors)
    }
    return json({ error: 'Acción desconocida (subir, url, albaran, compra, compra_url, foto, foto_url)' }, 400, cors)
  } catch (e) {
    console.error('[gastos-ocr]', e)
    return json({ error: (e as Error).message }, 502, cors)
  }
})
