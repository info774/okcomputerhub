// zoho-sync — de Zoho Books al hub: clientes, presupuestos y artículos
// (paridad de `sync-zoho`, `sync-zoho-estimates` y `sync-zoho-items` de la
// app, más el automático de `integrations/sync-auto.js`). PREPARADA para el
// corte: mientras el área sea de la app, la app los trae de Zoho y el hub los
// copia por `sync-app`; aquí se contesta `omitido` sin hablar con Zoho.
//   { accion: 'clientes' | 'presupuestos' | 'articulos', page?, since? }  (persona del hub)
//   { accion: 'todo' }   (pg_cron con x-sync-token cada 2 h, o un admin):
//      clientes y presupuestos incrementales desde el último corte bueno.
// SIN_JWT: la autoriza el token del cron o la sesión de una persona del hub.
// Reglas de la app que se conservan:
// - Nunca `.single()` al buscar por id de Zoho: con un duplicado devolvía
//   null y se insertaba OTRA copia en cada pasada. Se actualiza la más antigua
//   y no se inserta si ya hay alguna.
// - El corte (`hub.sync_estado`, `zoho_clientes` / `zoho_presupuestos`) se
//   apunta ANTES de empezar y SOLO avanza si la pasada fue bien: un fallo que
//   lo moviera perdería esa ventana para siempre (los 6 clientes de 09/2026).
// - `last_modified_time` con fecha, hora y offset numérico (`zohoDesde`).
// - El presupuesto guarda el TOTAL de Zoho (con impuestos) y sus líneas tal
//   cual (item_total); el cliente que no exista se crea solo con `clientes`
//   del hub (si no, el presupuesto entra sin cliente).
import { makeCorsHeaders, json, getAuthedUser, unauthorized, forbidden, isAdminUser, mismoToken } from '../_shared/http.ts'
import { hubDb } from '../_shared/hub-db.ts'
import { dbHub, tablaDelHub } from '../_shared/sb-hub.ts'
import { personaPorEmail } from '../_shared/personas.ts'
import { zohoGet, zohoDesde } from '../_shared/zoho.ts'

const ESTADOS: Record<string, string> = {
  draft: 'Borrador', sent: 'Enviado', accepted: 'Aceptado', declined: 'Rechazado', invoiced: 'Facturado', expired: 'Expirado',
}
const TABLA: Record<string, string> = { clientes: 'clientes', presupuestos: 'presupuestos', articulos: 'catalogo' }
const CLAVE: Record<string, string> = { clientes: 'zoho_clientes', presupuestos: 'zoho_presupuestos' }
const pausa = (ms: number) => new Promise(r => setTimeout(r, ms))

type Pagina = { imported: number; updated: number; hasMore: boolean }
// deno-lint-ignore no-explicit-any
type Sb = any

// `since` como lo manda la app (fecha suelta, ISO o milisegundos) → parámetro de Zoho.
function desde(since: unknown): Record<string, string> {
  if (since === null || since === undefined || since === '') return {}
  const v = typeof since === 'number' || /^\d{12,}$/.test(String(since)) ? Number(since)
    : /^\d{4}-\d{2}-\d{2}$/.test(String(since)) ? `${since}T00:00:00Z` : String(since)
  const d = new Date(v)
  return isNaN(d.getTime()) ? {} : { last_modified_time: zohoDesde(d) }
}

// El cliente del hub en el que se fusionó el de este contacto de Zoho (o null).
async function fusionadoEn(db: Sb, zohoId: string): Promise<string | null> {
  const { data, error } = await db.rpc('cliente_por_zoho', { p_zoho: zohoId })
  if (error) throw new Error(error.message)
  return data ?? null
}

// ── Clientes (sync-zoho) ────────────────────────────────────────────────────
async function clientes(pdb: ReturnType<typeof hubDb>, db: Sb, page: number, since: unknown, resumen: boolean): Promise<Pagina> {
  const j = await zohoGet(pdb, 'contacts', { page: String(page), filter_by: 'Status.Active', ...desde(since) })
  let imported = 0, updated = 0
  for (const s of j.contacts ?? []) {
    if (s.status && String(s.status).toLowerCase() !== 'active') continue
    let c = s
    if (!resumen) {
      // La lista no trae company_id ni billing_address: el detalle sí.
      try { const d = await zohoGet(pdb, `contacts/${s.contact_id}`); if (d.contact) c = d.contact } catch (e) { console.error(`[zoho-sync] contacto ${s.contact_id}:`, (e as Error).message) }
    }
    const ba = c.billing_address
    const fila = {
      nombre: c.contact_name || c.company_name || 'Sin nombre',
      email: c.email || '',
      telefono: c.phone || c.mobile || '',
      nif: c.company_id || c.tax_reg_no || '',
      direccion: ba ? [ba.address, ba.street2, ba.zip, ba.city, ba.state, ba.country].filter(Boolean).join(', ') : '',
      tipo: c.customer_sub_type === 'individual' ? 'individuo' : 'empresa',
    }
    const { data: hay, error } = await db.from('clientes').select('id').eq('zoho_id', c.contact_id).order('created_at', { ascending: true })
    if (error) throw new Error(error.message)
    // Un contacto de Zoho cuyo cliente se fusionó en otro (hub.fusiones): ese
    // otro ya lleva sus datos; ni se pisa ni se vuelve a crear la ficha borrada.
    if (!hay?.length && await fusionadoEn(db, c.contact_id)) continue
    if (hay?.length) {
      const r = await db.from('clientes').update(fila).eq('id', hay[0].id)
      if (r.error) throw new Error(r.error.message)
      updated++
    } else {
      const r = await db.from('clientes').insert({ ...fila, zoho_id: c.contact_id, activo: true })
      if (r.error) throw new Error(r.error.message)
      imported++
    }
    await pausa(50)
  }
  return { imported, updated, hasMore: !!j.page_context?.has_more_page }
}

// ── Presupuestos con sus líneas (sync-zoho-estimates) ───────────────────────
async function presupuestos(pdb: ReturnType<typeof hubDb>, db: Sb, page: number, since: unknown, creaClientes: boolean): Promise<Pagina> {
  const j = await zohoGet(pdb, 'estimates', { page: String(page), ...desde(since) })
  let imported = 0, updated = 0
  for (const s of j.estimates ?? []) {
    let e
    try { e = (await zohoGet(pdb, `estimates/${s.estimate_id}`)).estimate } catch (err) { console.error(`[zoho-sync] presupuesto ${s.estimate_id}:`, (err as Error).message); continue }
    if (!e) continue
    const { data: cli } = await db.from('clientes').select('id').eq('zoho_id', e.customer_id).limit(1).maybeSingle()
    let clienteId: string | null = cli?.id ?? (e.customer_id ? await fusionadoEn(db, e.customer_id) : null)
    if (!clienteId && e.customer_id && creaClientes) {
      const r = await db.from('clientes').insert({ nombre: e.customer_name, zoho_id: e.customer_id, tipo: 'empresa', estado: 'activo' }).select('id').single()
      if (r.error) throw new Error(r.error.message)
      clienteId = r.data?.id ?? null
    }
    const fila = {
      titulo: e.subject || e.estimate_number || 'Sin título',
      numero_presupuesto: e.estimate_number || null,
      total: e.total || 0,
      estado: ESTADOS[e.status] || 'Borrador',
      cliente_id: clienteId,
      fecha: e.date || e.estimate_date || null,
    }
    const { data: hay } = await db.from('presupuestos').select('id').eq('zoho_estimate_id', e.estimate_id).limit(1).maybeSingle()
    let id: string | null = null
    if (hay) {
      const r = await db.from('presupuestos').update(fila).eq('id', hay.id)
      if (r.error) throw new Error(r.error.message)
      id = hay.id; updated++
    } else {
      const r = await db.from('presupuestos').insert({ ...fila, zoho_estimate_id: e.estimate_id }).select('id').single()
      if (r.error) throw new Error(r.error.message)
      id = r.data?.id ?? null; imported++
    }
    if (id && e.line_items?.length) {
      await db.from('documento_lineas').delete().eq('presupuesto_id', id)
      // deno-lint-ignore no-explicit-any
      const lineas = e.line_items.map((li: any, i: number) => {
        const cantidad = li.quantity || 1, precio = li.rate || 0
        return { presupuesto_id: id, nombre: li.description || li.name || 'Línea', cantidad, precio,
          descuento: parseFloat(li.discount) || 0, subtotal: li.item_total || precio * cantidad, orden: i + 1 }
      })
      const r = await db.from('documento_lineas').insert(lineas)
      if (r.error) throw new Error(r.error.message)
    }
    await pausa(50)
  }
  return { imported, updated, hasMore: !!j.page_context?.has_more_page }
}

// ── Artículos al catálogo (sync-zoho-items) ─────────────────────────────────
async function articulos(pdb: ReturnType<typeof hubDb>, db: Sb, page: number): Promise<Pagina> {
  const j = await zohoGet(pdb, 'items', { page: String(page), filter_by: 'Status.Active' })
  let imported = 0, updated = 0
  for (const it of j.items ?? []) {
    const fila = {
      nombre: it.name || 'Sin nombre', precio: it.rate || 0, descripcion: it.description || null, referencia: it.sku || null,
      activo: it.status === 'active', categoria: it.product_type === 'service' ? 'Servicio' : 'Hardware', zoho_item_id: it.item_id,
    }
    // Por el id de Zoho y, si no, por nombre (enlaza lo que ya había).
    let { data: hay } = await db.from('catalogo').select('id').eq('zoho_item_id', it.item_id).limit(1).maybeSingle()
    if (!hay) ({ data: hay } = await db.from('catalogo').select('id').eq('nombre', fila.nombre).limit(1).maybeSingle())
    const r = hay ? await db.from('catalogo').update(fila).eq('id', hay.id) : await db.from('catalogo').insert(fila)
    if (r.error) throw new Error(r.error.message)
    if (hay) updated++; else imported++
    await pausa(30)
  }
  return { imported, updated, hasMore: !!j.page_context?.has_more_page }
}

Deno.serve(async req => {
  const cors = makeCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405, cors)
  const b = await req.json().catch(() => ({})) as Record<string, unknown>
  const pdb = hubDb({ origen: 'zoho-sync' })

  // ── Quién llama ───────────────────────────────────────────────────────────
  const cabecera = req.headers.get('x-sync-token') ?? ''
  const tokenCron = !cabecera ? '' : Deno.env.get('HUB_SYNC_TOKEN') ?? ((await pdb.rpc('secreto', { p_nombre: 'hub_sync_token' }).catch(() => null)) as string | null) ?? ''
  const porCron = !!cabecera && mismoToken(cabecera, tokenCron)
  const user = porCron ? null : await getAuthedUser(req)
  if (!porCron) {
    if (!user?.email) return unauthorized(cors)
    if (!(await personaPorEmail(pdb, user.email))) return forbidden(cors, 'No estás dado de alta en el hub.')
  }
  const db = dbHub('zoho-sync', user?.email ?? null)
  const accion = String(b.accion ?? '')

  try {
    // ── Una página suelta (los botones de Clientes, Presupuestos y Catálogo) ──
    if (accion in TABLA) {
      if (!(await tablaDelHub(db, TABLA[accion]))) return json({ ok: true, omitido: true, motivo: 'El área es de la app: la app lo trae de Zoho y el hub lo copia.' }, 200, cors)
      const page = Math.max(1, Math.min(100, Number(b.page) || 1))
      const r = accion === 'clientes' ? await clientes(pdb, db, page, b.since, !!b.summaryOnly)
        : accion === 'presupuestos' ? await presupuestos(pdb, db, page, b.since, await tablaDelHub(db, 'clientes'))
        : await articulos(pdb, db, page)
      return json({ success: true, ...r, total: r.imported + r.updated }, 200, cors)
    }

    // ── La pasada automática (sync-auto.js de la app, cada 2 h) ─────────────
    if (accion === 'todo') {
      if (!porCron && !(await isAdminUser(user))) return forbidden(cors, 'Solo un admin.')
      const informe: Record<string, unknown> = {}
      const creaClientes = await tablaDelHub(db, 'clientes')
      for (const tipo of ['clientes', 'presupuestos'] as const) {
        if (!(await tablaDelHub(db, TABLA[tipo]))) { informe[tipo] = 'omitido'; continue }
        const [e] = await pdb.get(`sync_estado?select=corte_ts&clave=eq.${CLAVE[tipo]}`)
        const since = (e?.corte_ts as string | null) ?? null
        const arranque = new Date().toISOString()   // ANTES de empezar: lo que cambie mientras, entra en la siguiente
        try {
          let imported = 0, updated = 0
          for (let page = 1; page <= 20; page++) {
            const r = tipo === 'clientes' ? await clientes(pdb, db, page, since, false) : await presupuestos(pdb, db, page, since, creaClientes)
            imported += r.imported; updated += r.updated
            if (!r.hasMore) break
          }
          await pdb.upsert('sync_estado', 'clave', [{ clave: CLAVE[tipo], corte_ts: arranque, ultima_ok: new Date().toISOString() }])
          informe[tipo] = { imported, updated }
        } catch (err) {
          const msg = (err as Error).message ?? String(err)
          console.error(`[zoho-sync] ${tipo}:`, msg)
          await pdb.upsert('sync_estado', 'clave', [{ clave: CLAVE[tipo], ultimo_error: msg.slice(0, 1000), ultimo_error_at: new Date().toISOString() }])
          informe[tipo] = { error: msg }
        }
      }
      return json({ ok: true, ...informe }, 200, cors)
    }

    return json({ error: 'Acción desconocida' }, 400, cors)
  } catch (err) {
    // El llamador automático es silencioso: sin esta traza, un sync roto solo deja un 400.
    console.error('[zoho-sync]', (err as Error).message ?? err)
    return json({ error: (err as Error).message ?? 'Error desconocido' }, 400, cors)
  }
})
