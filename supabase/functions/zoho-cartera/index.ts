// zoho-cartera — la cartera vieja de Zoho Billing (paridad bloque 4, tanda 4).
// Junta en una las tres funciones de la app: `sync-zoho-subscription`
// (comprobar una sede), `sync-zoho-subscriptions-daily` (el repaso diario) y
// `list-zoho-subscriptions` (las suscripciones de un cliente, para vincular
// una a su sede). Hacia Zoho es SOLO LECTURA; lo que escribe es la sede del
// hub (estado, deuda, próxima cuota…), y solo con el corte: mientras las
// sedes y el mantenimiento se lleven en la app, ESO lo escribe la app (su
// cron de las 4:00) y aquí se consulta sin guardar nada (`guardado: false`).
//   { accion: 'comprobar', local_id, subscription_id? }  (persona del hub)
//   { accion: 'listar', zoho_customer_id }                (persona del hub)
//   { accion: 'vincular', local_id, subscription_id }     (admin, con el corte)
//   { accion: 'diario' }   (pg_cron con x-sync-token, o un admin)
// SIN_JWT: la autoriza el token del cron o la sesión de una persona del hub.
// Reglas de la app: «esa suscripción no existe» es una RESPUESTA (la sede se
// desvincula, la deuda NO se toca); la deuda se mira en las facturas, no en
// el estado; un aviso puesto a mano no se degrada; las sedes que ya cobra
// Stripe no se tocan; el importe de Zoho es BRUTO (importe_incluye_impuesto).
import { makeCorsHeaders, json, getAuthedUser, unauthorized, forbidden, isAdminUser, mismoToken } from '../_shared/http.ts'
import { hubDb } from '../_shared/hub-db.ts'
import { dbHub, tablaDelHub } from '../_shared/sb-hub.ts'
import { personaPorEmail } from '../_shared/personas.ts'
import { zohoCtx, zohoAccessToken, type ZohoCtx } from '../_shared/zoho-ctx.ts'
import {
  fetchZohoSubscription, fetchZohoDeuda, mapSubscriptionToLocalFields, esZohoNoExiste, camposZohoBorrada,
} from '../_shared/zoho-subscription.ts'

const ETIQUETAS: Record<string, string> = {
  live: 'Activa', active: 'Activa', trial: 'Prueba', future: 'Futura', paused: 'Pausada', cancelled: 'Cancelada', expired: 'Expirada', non_renewing: 'No renovable',
}
const esId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{3,40}$/.test(v)
const esUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)
export const urlSuscripcion = (id: string) => `https://billing.zoho.eu/app/${Deno.env.get('ZOHO_BILLING_ACC_ID') ?? Deno.env.get('ZOHO_ORG_ID') ?? '20107733530'}#/subscriptions/${id}`

// ¿Puede escribir el hub en la sede? Solo con las sedes Y el mantenimiento cortados.
// deno-lint-ignore no-explicit-any
const escribe = async (db: any) => await tablaDelHub(db, 'locales') && await tablaDelHub(db, 'mant_facturas')

// Lo que Zoho dice de una sede (sin guardar nada).
// deno-lint-ignore no-explicit-any
async function leer(ctx: ZohoCtx, token: string, subId: string, estadoActual: string | null): Promise<{ noExiste: true } | { noExiste: false; sub: any; fields: any; deuda: any }> {
  let sub
  try { sub = await fetchZohoSubscription(ctx, token, subId) } catch (e) { if (esZohoNoExiste(e)) return { noExiste: true }; throw e }
  const deuda = await fetchZohoDeuda(ctx, token, subId, sub.customer_id || sub.customer?.customer_id)
  return { noExiste: false, sub, deuda, fields: mapSubscriptionToLocalFields(sub, { deuda, estadoActual }) }
}

Deno.serve(async req => {
  const cors = makeCorsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405, cors)
  const b = await req.json().catch(() => ({})) as Record<string, unknown>
  const pdb = hubDb({ origen: 'zoho-cartera' })

  // ── Quién llama ───────────────────────────────────────────────────────────
  const cabecera = req.headers.get('x-sync-token') ?? ''
  const tokenCron = !cabecera ? '' : Deno.env.get('HUB_SYNC_TOKEN') ?? ((await pdb.rpc('secreto', { p_nombre: 'hub_sync_token' }).catch(() => null)) as string | null) ?? ''
  const porCron = !!cabecera && mismoToken(cabecera, tokenCron)
  const user = porCron ? null : await getAuthedUser(req)
  if (!porCron) {
    if (!user?.email) return unauthorized(cors)
    if (!(await personaPorEmail(pdb, user.email))) return forbidden(cors, 'No estás dado de alta en el hub.')
  }
  const admin = porCron || await isAdminUser(user)
  const db = dbHub('zoho-cartera', user?.email ?? null)

  try {
    const ctx = zohoCtx()

    // ── Las suscripciones de un cliente (para vincular una a su sede) ──────
    if (b.accion === 'listar') {
      if (!esId(b.zoho_customer_id)) return json({ error: 'Falta el id del cliente en Zoho (Zoho Books ID).' }, 400, cors)
      const token = await zohoAccessToken(ctx)
      const res = await fetch(`https://${ctx.apiDomain}/billing/v1/subscriptions?organization_id=${ctx.ZOHO_ORG_ID}&customer_id=${b.zoho_customer_id}`,
        { headers: { Authorization: `Zoho-oauthtoken ${token}` }, signal: AbortSignal.timeout(30000) })
      const d = await res.json().catch(() => ({}))
      if (d.code !== 0) throw new Error(`Zoho Billing: ${d.message || res.status}`)
      // deno-lint-ignore no-explicit-any
      const subs = (d.subscriptions || []).map((s: any) => ({
        subscription_id: s.subscription_id, plan_name: s.plan?.plan_name || s.plan?.name || s.plan_name || s.plan_code || '',
        status: s.status || '', status_label: ETIQUETAS[s.status] || s.status || '', amount: s.amount ?? s.plan?.price ?? null,
        next_billing_at: s.next_billing_at ? new Date(typeof s.next_billing_at === 'number' ? s.next_billing_at * 1000 : s.next_billing_at).toISOString().slice(0, 10) : null,
        url: urlSuscripcion(s.subscription_id),
      }))
      return json({ ok: true, subscriptions: subs, puede_vincular: admin && await escribe(db) }, 200, cors)
    }

    // ── Comprobar (y, con el corte, guardar) una sede; vincular = lo mismo con otro id ──
    if (b.accion === 'comprobar' || b.accion === 'vincular') {
      if (!esUuid(b.local_id)) return json({ error: 'Falta la sede.' }, 400, cors)
      const { data: sede } = await db.from('locales').select('id,nombre,zoho_subscription_id,stripe_subscription_id,estado_pago').eq('id', b.local_id).maybeSingle()
      if (!sede) return json({ error: 'Sede no encontrada.' }, 404, cors)
      const subId = (b.subscription_id as string | undefined) || sede.zoho_subscription_id
      if (!esId(subId)) return json({ error: 'Esta sede no tiene suscripción de Zoho apuntada.' }, 400, cors)
      const guarda = await escribe(db)
      if (b.accion === 'vincular') {
        if (!admin) return forbidden(cors)
        if (!guarda) return json({ error: 'Las sedes se siguen llevando en la app hasta el cambio: vincúlala allí.', no_activo: true }, 409, cors)
        if (sede.stripe_subscription_id) return json({ error: 'Esta sede ya la cobra Stripe: no se le vincula una suscripción de Zoho.' }, 409, cors)
      }
      const r = await leer(ctx, await zohoAccessToken(ctx), subId, sede.estado_pago)
      if (r.noExiste) {
        if (guarda) await db.from('locales').update(camposZohoBorrada()).eq('id', sede.id)
        return json({ ok: true, no_existe: true, guardado: guarda, mensaje: guarda
          ? 'Esa suscripción ya no existe en Zoho Billing. La sede queda desvinculada y se puede domiciliar.'
          : 'Esa suscripción ya no existe en Zoho Billing. (Se desvinculará en la app, que es la que lleva las sedes hasta el cambio.)' }, 200, cors)
      }
      if (guarda) {
        const { error } = await db.from('locales').update({
          zoho_subscription_id: subId, ...r.fields, zoho_sync_at: new Date().toISOString(), zoho_sync_error: null,
          zoho_deuda_error: r.deuda.comprobado ? null : (r.deuda.error || 'No se pudo comprobar la deuda en Zoho'),
        }).eq('id', sede.id)
        if (error) throw new Error(`No se pudo guardar en la sede: ${error.message}`)
      }
      return json({
        ok: true, guardado: guarda, status: r.sub.status || '', plan: r.fields.plan, estado_pago: r.fields.estado_pago, deuda: r.fields.zoho_deuda,
        facturas_impagadas: r.fields.zoho_facturas_impagadas, deuda_error: r.deuda.comprobado ? null : (r.deuda.error || null),
        importe: r.fields.importe_mantenimiento, forma_pago: r.fields.forma_pago, proxima_cuota: r.fields.proxima_cuota, url: urlSuscripcion(subId),
      }, 200, cors)
    }

    // ── El repaso diario de toda la cartera ────────────────────────────────
    if (b.accion === 'diario') {
      if (!admin) return forbidden(cors)
      if (!(await escribe(db))) return json({ ok: true, omitido: 'Las sedes y el mantenimiento se llevan en la app: el repaso lo hace ella.' }, 200, cors)
      // Las que ya cobra Stripe se quedan fuera: refrescarlas desde Zoho les pisaría plan, importe y estado.
      const { data: sedes, error } = await db.from('locales').select('id,nombre,zoho_subscription_id,estado_pago')
        .not('zoho_subscription_id', 'is', null).neq('zoho_subscription_id', '').is('stripe_subscription_id', null).eq('activo', true)
      if (error) throw new Error(error.message)
      const token = await zohoAccessToken(ctx)
      let actualizadas = 0, errores = 0, borradas = 0, conDeuda = 0
      const fallidos: { local_id: string; nombre: string; error: string }[] = []
      for (const s of sedes ?? []) {
        try {
          const r = await leer(ctx, token, s.zoho_subscription_id, s.estado_pago)
          if (r.noExiste) { borradas++; await db.from('locales').update(camposZohoBorrada()).eq('id', s.id) }
          else {
            if (r.deuda.comprobado && r.deuda.deuda > 0) conDeuda++
            const { error: e } = await db.from('locales').update({ ...r.fields, zoho_sync_at: new Date().toISOString(), zoho_sync_error: null,
              zoho_deuda_error: r.deuda.comprobado ? null : (r.deuda.error || 'No se pudo comprobar la deuda en Zoho') }).eq('id', s.id)
            if (e) throw new Error(e.message)
            actualizadas++
          }
        } catch (e) {
          // Una sincronización rota no puede parecerse a una sede que va bien: queda en la ficha.
          errores++
          const msg = (e as Error).message || 'Error desconocido'
          fallidos.push({ local_id: s.id, nombre: s.nombre, error: msg })
          await db.from('locales').update({ zoho_sync_at: new Date().toISOString(), zoho_sync_error: msg.slice(0, 500) }).eq('id', s.id)
        }
        await new Promise(r => setTimeout(r, 100))
      }
      return json({ ok: true, total: sedes?.length ?? 0, actualizadas, errores, borradas, con_deuda: conDeuda, fallidos }, 200, cors)
    }

    return json({ error: 'Acción desconocida (comprobar, listar, vincular, diario).' }, 400, cors)
  } catch (e) {
    console.error('[zoho-cartera]', (e as Error).message)
    return json({ error: (e as Error).message }, 400, cors)
  }
})
