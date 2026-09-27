// zoho-lectura — espejo de SOLO LECTURA de Zoho Books en el hub
// (hub.zoho_facturas, hub.zoho_cobros), para el puesto de mando, el bot y los
// informes. Nunca escribe en Zoho.
//
// Va en SIN_JWT: la llama pg_cron (hub.lanzar_funcion, cabecera x-sync-token =
// hub_sync_token) cada 30 min y entera cada noche. Desde el hub, un admin con
// su sesión: { accion: 'estado' | 'conectar' (con el código del Self Client) |
// 'sincronizar' }.
//
// Incremental: facturas modificadas desde el último corte (last_modified_time)
// y cobros de los últimos 45 días. Completo: 24 meses de las dos, y borra del
// espejo lo que ya no esté en Zoho. UN SYNC QUE FALLA NO MUEVE EL CORTE.
import { makeCorsHeaders, json, getAuthedUser, isAdminUser, unauthorized, mismoToken } from '../_shared/http.ts'
import { hubDb, type Db } from '../_shared/hub-db.ts'
import { clienteConfigurado, refreshToken, conectar, zohoGet, zohoTodo, zohoDesde, ORG } from '../_shared/zoho.ts'

const CLAVE = 'zoho'
const hoy = () => new Date().toISOString().slice(0, 10)
const haceMeses = (n: number) => { const d = new Date(); d.setMonth(d.getMonth() - n); d.setDate(1); return d.toISOString().slice(0, 10) }
const haceDias = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)
const num = (v: unknown) => (v == null || v === '' ? null : Number(v))
const fecha = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null)

// deno-lint-ignore no-explicit-any
const factura = (f: any) => ({
  invoice_id: String(f.invoice_id), numero: f.invoice_number ?? null, cliente_zoho_id: f.customer_id ? String(f.customer_id) : null,
  cliente_nombre: f.customer_name ?? null, fecha: fecha(f.date), vence: fecha(f.due_date), estado: f.status ?? null,
  total: num(f.total), saldo: num(f.balance), modificada_at: f.last_modified_time ?? null, sync_at: new Date().toISOString(),
})
// deno-lint-ignore no-explicit-any
const cobro = (p: any) => ({
  payment_id: String(p.payment_id), numero: p.payment_number ?? null, cliente_zoho_id: p.customer_id ? String(p.customer_id) : null,
  cliente_nombre: p.customer_name ?? null, fecha: fecha(p.date), importe: num(p.amount), forma: p.payment_mode ?? null,
  facturas: p.invoice_numbers ?? null, modificada_at: p.last_modified_time ?? null, sync_at: new Date().toISOString(),
})

async function estado(db: Db) {
  const [e] = await db.get(`sync_estado?select=*&clave=eq.${CLAVE}`)
  return { cliente: clienteConfigurado(), conectado: !!(await refreshToken(db).catch(() => '')), organizacion: ORG(), sync: e ?? null }
}

async function sincronizar(db: Db, completo: boolean) {
  const inicio = new Date()
  const [e] = await db.get(`sync_estado?select=corte_ts&clave=eq.${CLAVE}`)
  const corte = e?.corte_ts ? new Date(new Date(e.corte_ts as string).getTime() - 5 * 60000) : null
  const total = completo || !corte
  const desde = haceMeses(24)

  const facturas = total
    ? await zohoTodo(db, 'invoices', 'invoices', { date_start: desde, date_end: hoy(), sort_column: 'date' })
    : await zohoTodo(db, 'invoices', 'invoices', { last_modified_time: zohoDesde(corte!) })
  const cobros = await zohoTodo(db, 'customerpayments', 'customerpayments',
    { date_start: total ? desde : haceDias(45), date_end: hoy(), sort_column: 'date' })

  const filasF = facturas.map(factura).filter(f => f.fecha)
  const filasC = cobros.map(cobro).filter(c => c.fecha)
  await db.upsert('zoho_facturas', 'invoice_id', filasF)
  await db.upsert('zoho_cobros', 'payment_id', filasC)

  // Pasada completa: lo que ya no está en Zoho (borrado) sale del espejo.
  let borradas = 0
  if (total) {
    const idsF = new Set(filasF.map(f => f.invoice_id)), idsC = new Set(filasC.map(c => c.payment_id))
    const viejasF = (await db.get(`zoho_facturas?select=invoice_id&fecha=gte.${desde}`)).filter(f => !idsF.has(f.invoice_id as string))
    const viejosC = (await db.get(`zoho_cobros?select=payment_id&fecha=gte.${desde}`)).filter(c => !idsC.has(c.payment_id as string))
    for (let i = 0; i < viejasF.length; i += 100) await db.del(`zoho_facturas?invoice_id=in.(${viejasF.slice(i, i + 100).map(f => f.invoice_id).join(',')})`)
    for (let i = 0; i < viejosC.length; i += 100) await db.del(`zoho_cobros?payment_id=in.(${viejosC.slice(i, i + 100).map(c => c.payment_id).join(',')})`)
    borradas = viejasF.length + viejosC.length
  }
  const r = { facturas: filasF.length, cobros: filasC.length, borradas, completo: total }
  await db.upsert('sync_estado', 'clave', [{ clave: CLAVE, corte_ts: inicio.toISOString(), ultima_ok: new Date().toISOString(),
    filas: filasF.length + filasC.length, ultimo_error: null, detalle: r }])
  return r
}

Deno.serve(async req => {
  const cors = makeCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405, cors)

  const sistema = hubDb({ origen: 'zoho-lectura' })
  const cuerpo = await req.json().catch(() => ({}))
  const tokenCron = ((await sistema.rpc('secreto', { p_nombre: 'hub_sync_token' }).catch(() => '')) as string) || Deno.env.get('HUB_SYNC_TOKEN') || ''
  const porCron = mismoToken(req.headers.get('x-sync-token') ?? '', tokenCron)
  const user = porCron ? null : await getAuthedUser(req)
  if (!porCron && !(await isAdminUser(user))) return unauthorized(cors)
  const db = hubDb({ origen: 'zoho-lectura', email: user?.email, sync: true })

  try {
    switch (porCron ? 'sincronizar' : cuerpo.accion) {
      case 'estado':
        return json(await estado(db), 200, cors)
      case 'conectar': {
        if (typeof cuerpo.codigo !== 'string' || cuerpo.codigo.trim().length < 10) return json({ error: 'Pega el código que da Zoho' }, 400, cors)
        await conectar(hubDb({ origen: 'zoho-lectura', email: user?.email }), cuerpo.codigo)
        const org = await zohoGet(db, 'organizations/' + ORG())
        return json({ ok: true, organizacion: org.organization?.name ?? ORG(), sync: await sincronizar(db, true) }, 200, cors)
      }
      case 'sincronizar': {
        if (!clienteConfigurado() || !(await refreshToken(db).catch(() => ''))) {
          return json({ ok: false, motivo: 'Zoho no está conectado todavía' }, 200, cors)
        }
        return json({ ok: true, ...(await sincronizar(db, cuerpo.modo === 'completo')) }, 200, cors)
      }
      default:
        return json({ error: 'Acción desconocida (estado, conectar, sincronizar)' }, 400, cors)
    }
  } catch (e) {
    const msg = (e as Error).message
    console.error('[zoho-lectura]', msg)
    await db.upsert('sync_estado', 'clave', [{ clave: CLAVE, ultimo_error: msg.slice(0, 1000), ultimo_error_at: new Date().toISOString() }])
      .catch(err => console.error('[zoho-lectura] no se pudo apuntar el error:', err))
    return json({ ok: false, error: msg }, 500, cors)
  }
})
