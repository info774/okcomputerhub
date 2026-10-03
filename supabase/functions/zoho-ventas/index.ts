// zoho-ventas — presupuestos y facturas de trabajos en Zoho Books (paridad con
// la app, bloque 3: send-to-zoho-estimate, send-to-zoho-invoice y
// add-to-zoho-invoice). Con sesión de una persona del hub.
//   presupuesto {presupuesto_id}            → { zoho_estimate_id, numero, actualizado }
//       Crea el estimate (o lo actualiza si ya tiene zoho_estimate_id; si Zoho
//       no deja actualizarlo, crea otro), guarda id y número y lo deja «Enviado».
//       Solo con el área `presupuestos` cortada.
//   borradores {cliente_id}                 → { facturas: [{invoice_id, invoice_number, reference_number, date, total}] }
//       Facturas en BORRADOR del cliente, para añadirles trabajos. Solo lee.
//   factura {cliente_id, titulo?, lineas, trabajo_ids}       → { invoice_id, invoice_number }
//   anadir {invoice_id, lineas, trabajo_ids}                 → { invoice_id, invoice_number }
//       Factura nueva, o líneas añadidas a un borrador (que tiene que seguir en
//       borrador). Los trabajos pasan a «Facturado» con el id y el número de la
//       factura. Solo con el área `trabajos` cortada.
// Las líneas van a Zoho por _shared/zoho-lineas.ts (artículo + descripción).
import { makeCorsHeaders, json, getAuthedUser, unauthorized, forbidden } from '../_shared/http.ts'
import { hubDb, esUuid, type Db } from '../_shared/hub-db.ts'
import { personaPorEmail } from '../_shared/personas.ts'
import { zohoEnviar, zohoGet } from '../_shared/zoho.ts'
import { itemsDeCatalogo, lineasAZoho, type LineaApp } from '../_shared/zoho-lineas.ts'

class Aviso extends Error { constructor(m: string, public estado = 400) { super(m) } }

async function exigirArea(db: Db, tabla: string, que: string) {
  const [a] = await db.get(`areas?select=dueno&tablas=cs.{${tabla}}`)
  if (a?.dueno !== 'hub') throw new Aviso(`${que} se siguen llevando en la app: es ella quien los manda a Zoho.`, 409)
}

async function clienteZoho(db: Db, id: unknown): Promise<{ id: string; nombre: string; zoho_id: string | null }> {
  if (!esUuid(id)) throw new Aviso('Cliente no válido')
  const [c] = await db.get(`clientes?select=id,nombre,zoho_id&id=eq.${id}`)
  if (!c) throw new Aviso('Cliente no encontrado', 404)
  return c as { id: string; nombre: string; zoho_id: string | null }
}

function lineasValidas(l: unknown): LineaApp[] {
  if (!Array.isArray(l) || !l.length) throw new Aviso('No hay líneas')
  if (l.length > 200) throw new Aviso('Demasiadas líneas')
  return l as LineaApp[]
}

const idsValidos = (ids: unknown): string[] => (Array.isArray(ids) ? ids.filter(esUuid) as string[] : [])

async function marcarFacturados(db: Db, ids: string[], invoiceId: string, numero: string | null) {
  if (!ids.length) return
  await db.patch(`trabajos?id=in.(${ids.join(',')})`, { estado: 'Facturado', zoho_invoice_id: invoiceId, zoho_invoice_number: numero })
}

Deno.serve(async req => {
  const cors = makeCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405, cors)
  const user = await getAuthedUser(req)
  if (!user?.email) return unauthorized(cors)
  const db = hubDb({ origen: 'zoho-ventas', email: user.email })
  const yo = await personaPorEmail(db, user.email)
  if (!yo) return forbidden(cors, 'No estás dado de alta en el hub.')
  const b = await req.json().catch(() => ({}))
  try {
    if (b.accion === 'presupuesto') {
      if (!esUuid(b.presupuesto_id)) throw new Aviso('Presupuesto no válido')
      await exigirArea(db, 'presupuestos', 'Los presupuestos')
      const [p] = await db.get(`presupuestos?select=*&id=eq.${b.presupuesto_id}`)
      if (!p) throw new Aviso('Presupuesto no encontrado', 404)
      if (!p.cliente_id) throw new Aviso('El presupuesto no tiene cliente')
      const c = await clienteZoho(db, p.cliente_id)
      if (!c.zoho_id) throw new Aviso(`El cliente «${c.nombre}» no está en Zoho Books: dalo de alta primero.`)
      const lineas = await db.get(`documento_lineas?select=nombre,cantidad,precio,descuento&presupuesto_id=eq.${p.id}&order=orden.nullslast,created_at`)
      const lineItems = lineasAZoho(lineas as LineaApp[], await itemsDeCatalogo(db))
      if (!lineItems.length) throw new Aviso('El presupuesto no tiene líneas')
      const cuerpo = {
        customer_id: c.zoho_id, subject: p.titulo || undefined, date: p.fecha || new Date().toISOString().slice(0, 10),
        line_items: lineItems, ...(p.exigencias ? { notes: p.exigencias } : {}),
      }
      let id: string | null = p.zoho_estimate_id ? String(p.zoho_estimate_id) : null
      let numero: string | null = (p.numero_presupuesto as string | null) ?? null
      let actualizado = false
      if (id) {
        const r = await zohoEnviar(db, 'PUT', `estimates/${id}`, cuerpo)
        if (r.code === 0) actualizado = true
        else id = null // si no deja actualizarlo (aceptado, borrado…), se crea otro, como la app
      }
      if (!id) {
        const r = await zohoEnviar(db, 'POST', 'estimates', cuerpo)
        if (r.code !== 0) throw new Aviso(`Zoho no creó el presupuesto: ${r.message ?? 'sin detalle'}`, 502)
        id = r.estimate?.estimate_id ?? null
        numero = r.estimate?.estimate_number ?? null
      }
      await db.patch(`presupuestos?id=eq.${p.id}`, { zoho_estimate_id: id, numero_presupuesto: numero, estado: 'Enviado' })
      return json({ zoho_estimate_id: id, numero, actualizado }, 200, cors)
    }

    if (b.accion === 'borradores') {
      const c = await clienteZoho(db, b.cliente_id)
      if (!c.zoho_id) return json({ facturas: [] }, 200, cors)
      const r = await zohoGet(db, 'invoices', { customer_id: c.zoho_id, status: 'draft' })
      // deno-lint-ignore no-explicit-any
      const facturas = (r.invoices ?? []).map((x: any) => ({ invoice_id: x.invoice_id, invoice_number: x.invoice_number, reference_number: x.reference_number ?? '', date: x.date, total: x.total }))
      return json({ facturas }, 200, cors)
    }

    if (b.accion === 'factura') {
      await exigirArea(db, 'trabajos', 'Los trabajos')
      const lineas = lineasValidas(b.lineas)
      const c = await clienteZoho(db, b.cliente_id)
      if (!c.zoho_id) throw new Aviso(`El cliente «${c.nombre}» no está en Zoho Books: dalo de alta primero.`)
      const r = await zohoEnviar(db, 'POST', 'invoices', {
        customer_id: c.zoho_id, date: new Date().toISOString().slice(0, 10), line_items: lineasAZoho(lineas, await itemsDeCatalogo(db)),
        ...(b.titulo ? { reference_number: String(b.titulo).slice(0, 100) } : {}),
      })
      if (r.code !== 0) throw new Aviso(`Zoho no creó la factura: ${r.message ?? 'sin detalle'}`, 502)
      const id = String(r.invoice?.invoice_id ?? ''), numero = r.invoice?.invoice_number ?? null
      await marcarFacturados(db, idsValidos(b.trabajo_ids), id, numero)
      return json({ invoice_id: id, invoice_number: numero }, 200, cors)
    }

    if (b.accion === 'anadir') {
      await exigirArea(db, 'trabajos', 'Los trabajos')
      if (!/^\d{5,25}$/.test(String(b.invoice_id ?? ''))) throw new Aviso('Factura no válida')
      const lineas = lineasValidas(b.lineas)
      const g = await zohoGet(db, `invoices/${b.invoice_id}`)
      const f = g.invoice
      if (f?.status !== 'draft') throw new Aviso('La factura ya no está en borrador; no se le pueden añadir trabajos.')
      // Las líneas que ya tiene, con su line_item_id (si no, Zoho las borraría), y las nuevas detrás.
      // deno-lint-ignore no-explicit-any
      const ya = (f.line_items ?? []).map((li: any) => Object.fromEntries(Object.entries({
        line_item_id: li.line_item_id, quantity: li.quantity, rate: li.rate, item_id: li.item_id, name: li.name,
        description: li.description, discount: li.discount, tax_id: li.tax_id, unit: li.unit,
      }).filter(([, v]) => v !== undefined && v !== null && v !== '')))
      const r = await zohoEnviar(db, 'PUT', `invoices/${b.invoice_id}`, { line_items: [...ya, ...lineasAZoho(lineas, await itemsDeCatalogo(db))] })
      if (r.code !== 0) throw new Aviso(`Zoho no actualizó la factura: ${r.message ?? 'sin detalle'}`, 502)
      const numero = r.invoice?.invoice_number ?? f.invoice_number ?? null
      await marcarFacturados(db, idsValidos(b.trabajo_ids), String(b.invoice_id), numero)
      return json({ invoice_id: String(b.invoice_id), invoice_number: numero }, 200, cors)
    }

    return json({ error: 'Acción desconocida (presupuesto, borradores, factura, anadir)' }, 400, cors)
  } catch (e) {
    if (e instanceof Aviso) return json({ error: e.message }, e.estado, cors)
    console.error('[zoho-ventas]', e)
    return json({ error: (e as Error).message }, 502, cors)
  }
})
