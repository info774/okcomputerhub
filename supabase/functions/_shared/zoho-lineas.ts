// Las líneas del hub (y de la app) a `line_items` de Zoho Books: portado de
// _shared/zoho-lineas.ts de la app, para que presupuesto y factura salgan
// igual desde los dos sitios. Una línea trae:
//   nombre   rótulo corto — el ARTÍCULO (p. ej. «#412 - Bar Pepe» o «Router»)
//   detalle  texto largo  — la DESCRIPCIÓN (qué se hizo, fichajes, horas)
// Sin `detalle` (las de un presupuesto) todo va en la descripción, como siempre.
// Si el nombre coincide con un artículo del catálogo ya enlazado con Zoho
// (`catalogo.zoho_item_id`), la línea va ENLAZADA a ese artículo.
import type { Db } from './hub-db.ts'

export interface LineaApp { nombre?: string; detalle?: string; cantidad?: number | string; precio?: number | string; descuento?: number | string }

const NAME_MAX = 100 // Zoho corta el nombre del artículo a 100 caracteres

/** nombre en minúsculas → zoho_item_id, de los artículos del catálogo ya enlazados. Si falla, sin enlazar. */
export async function itemsDeCatalogo(db: Db): Promise<Map<string, string>> {
  const mapa = new Map<string, string>()
  try {
    const filas = await db.get('catalogo?select=nombre,zoho_item_id&zoho_item_id=not.is.null&limit=5000')
    for (const f of filas) {
      const k = String(f.nombre ?? '').trim().toLowerCase()
      if (k && f.zoho_item_id && !mapa.has(k)) mapa.set(k, String(f.zoho_item_id))
    }
  } catch (e) { console.warn('[zoho-lineas] sin catálogo:', e) }
  return mapa
}

// deno-lint-ignore no-explicit-any
export function lineasAZoho(lineas: LineaApp[], items?: Map<string, string>): any[] {
  return (lineas ?? []).map(l => {
    const nombre = String(l.nombre ?? '').trim()
    const detalle = String(l.detalle ?? '').trim()
    // deno-lint-ignore no-explicit-any
    const item: any = {
      quantity: parseFloat(String(l.cantidad ?? 1)) || 1,
      rate: parseFloat(String(l.precio ?? 0)) || 0,
      discount: parseFloat(String(l.descuento ?? 0)) || 0,
    }
    if (detalle) { item.name = (nombre || detalle).slice(0, NAME_MAX); item.description = detalle }
    else item.description = nombre || '—'
    const id = items?.get(nombre.toLowerCase())
    if (id) item.item_id = id
    return item
  })
}
